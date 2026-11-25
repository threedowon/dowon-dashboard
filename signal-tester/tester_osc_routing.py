"""OSC/UDP input runs in the engine, independently of the browser UI."""
from collections import deque
from copy import deepcopy
import ipaddress
import math
import queue
import socket
import struct
import threading
import time


def decode_packet(data, depth=0):
    if depth > 8 or not data or len(data) > 65507 or len(data) % 4:
        raise ValueError('Invalid OSC packet size or nesting.')
    if data.startswith(b'#bundle\0'):
        if len(data) < 16 or data[8:16] != struct.pack('>Q', 1):
            raise ValueError('Only immediate OSC bundles are supported (timetag 1).')
        messages, pos = [], 16
        while pos < len(data):
            size = struct.unpack_from('>I', data, pos)[0]; pos += 4
            if not size or pos + size > len(data):
                raise ValueError('Invalid OSC bundle element.')
            messages.extend(decode_packet(data[pos:pos+size], depth+1)); pos += size
            if len(messages) > 128:
                raise ValueError('Too many OSC messages in one packet.')
        return messages
    def string(pos):
        end = data.find(b'\0', pos)
        if end < 0:
            raise ValueError('Unterminated OSC string.')
        next_pos = (end+4)//4*4
        if next_pos > len(data) or any(data[end:next_pos]):
            raise ValueError('Invalid OSC string padding.')
        return data[pos:end].decode('utf-8'), next_pos
    address, pos = string(0)
    tags, pos = string(pos)
    if not address.startswith('/') or not tags.startswith(','):
        raise ValueError('Expected OSC address and type tags.')
    args = []
    for tag in tags[1:]:
        if tag in 'ifsdh':
            if tag == 's':
                value, pos = string(pos)
            else:
                fmt = {'i': '>i', 'f': '>f', 'd': '>d', 'h': '>q'}[tag]
                size = struct.calcsize(fmt)
                if pos+size > len(data):
                    raise ValueError('Truncated OSC argument.')
                value = struct.unpack_from(fmt, data, pos)[0]; pos += size
                if isinstance(value, float) and not math.isfinite(value):
                    raise ValueError('OSC numbers must be finite.')
            args.append(value)
        elif tag in 'TFN':
            args.append({'T': True, 'F': False, 'N': None}[tag])
        else:
            raise ValueError('Unsupported OSC type: '+tag)
    if pos != len(data):
        raise ValueError('Unexpected OSC trailing data.')
    return [(address, args)]


def validate_osc(raw, targets, signals):
    if not isinstance(raw, dict) or type(raw.get('enabled', False)) is not bool:
        raise ValueError('Invalid OSC receiver settings.')
    host = str(ipaddress.IPv4Address(raw.get('host', '0.0.0.0')))
    port = raw.get('port', 9000)
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('OSC port must be 1–65535.')
    rules = raw.get('rules', [])
    if not isinstance(rules, list) or len(rules) > 100:
        raise ValueError('Use up to 100 OSC mappings.')
    valid_targets = {t['id'] for t in targets if t.get('type', 'http') == 'http'}
    valid_signals = {s['id'] for s in signals}
    result, ids = [], set()
    for r in rules:
        if not isinstance(r, dict) or not isinstance(r.get('id'), str) or not 0 < len(r['id']) <= 80 or r['id'] in ids:
            raise ValueError('OSC mapping IDs must be unique.')
        ids.add(r['id'])
        address = r.get('address', '')
        if not isinstance(address, str) or not address.startswith('/') or len(address) > 256 or any(c.isspace() or c in '*?[]{}\0' for c in address):
            raise ValueError('Use an exact OSC address, such as /sensor/person (no wildcards).')
        if r.get('targetId') not in valid_targets or r.get('signalId') not in valid_signals:
            raise ValueError('Choose an existing HTTP Player and Signal for each OSC mapping.')
        op, value = r.get('operator', 'any'), r.get('value', 1)
        if op not in ('any', 'eq', 'gte', 'lte') or type(value) not in (str, int, float, bool) or (type(value) in (int, float) and not math.isfinite(value)) or len(str(value)) > 512:
            raise ValueError('Invalid OSC match condition.')
        if op in ('gte', 'lte') and type(value) not in (int, float):
            raise ValueError('OSC thresholds must be numbers.')
        cooldown = r.get('cooldown', 1)
        if type(cooldown) not in (int, float) or not math.isfinite(cooldown) or not 0 <= cooldown <= 3600:
            raise ValueError('OSC cooldown must be 0–3600 seconds.')
        result.append(dict(id=r['id'], address=address, targetId=r['targetId'], signalId=r['signalId'], operator=op, value=value, cooldown=cooldown))
    return dict(enabled=raw.get('enabled', False), host=host, port=port, rules=result)


class OscBridge:
    def __init__(self, send):
        self.send = send
        self.lock = threading.RLock()
        self.logs = deque(maxlen=100)
        self.config = None
        self.stop = threading.Event()
        self.socket = None
        self.threads = []
        self.state = 'stopped'
        self.error = ''

    def log(self, stage, detail, **fields):
        with self.lock:
            self.logs.appendleft(dict(time=time.time()*1000, stage=stage, detail=detail, **fields))

    def snapshot(self):
        with self.lock:
            return dict(state=self.state, error=self.error, logs=list(self.logs))

    def configure(self, workspace):
        config = deepcopy((workspace.get('osc'), workspace['targets'], workspace['signals']))
        if config == self.config and self.state != 'error':
            return
        self.close(); self.config = config
        osc = config[0]
        if not osc or not osc['enabled']:
            return
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.bind((osc['host'], osc['port'])); sock.settimeout(.2)
        except OSError as error:
            sock.close(); self.state = 'error'; self.error = str(error)
            self.log('error', 'OSC receiver could not start: '+str(error)); return
        self.socket = sock; self.stop = threading.Event(); self.state = 'listening'; self.error = ''
        stop, jobs = self.stop, queue.Queue(maxsize=64)
        targets = {t['id']: t for t in config[1]}; signals = {s['id']: s for s in config[2]}
        last = {}
        def receive():
            while not stop.is_set():
                try:
                    packet, peer = sock.recvfrom(65535)
                except socket.timeout:
                    continue
                except OSError:
                    return
                try:
                    messages = decode_packet(packet)
                    for address, args in messages:
                        self.log('rx', address, args=args, peer=peer[0]+':'+str(peer[1]))
                        for r in osc['rules']:
                            if address != r['address']:
                                continue
                            v = args[0] if args else None; op = r['operator']; expected = r['value']
                            match = op == 'any' or (op == 'eq' and v == expected) or (type(v) in (int, float) and op in ('gte', 'lte') and (v >= expected if op == 'gte' else v <= expected))
                            if not match:
                                continue
                            now = time.monotonic()
                            if now-last.get(r['id'], float('-inf')) < r['cooldown']:
                                self.log('cooldown', address); continue
                            signal = signals[r['signalId']]
                            body = dict(targetId=r['targetId'], key=signal['key'], value=signal.get('value'), origin='OSC '+address)
                            try:
                                jobs.put_nowait((now, body, targets[r['targetId']]))
                                last[r['id']] = now
                            except queue.Full:
                                self.log('dropped', 'OSC send queue is full.')
                except (ValueError, UnicodeError, struct.error) as error:
                    self.log('invalid', str(error), peer=peer[0])
        def dispatch():
            while not stop.is_set():
                try:
                    received, body, target = jobs.get(timeout=.2)
                except queue.Empty:
                    continue
                if stop.is_set():
                    return
                if time.monotonic()-received > 2:
                    self.log('dropped', 'Stale OSC signal was not replayed.'); continue
                try:
                    result = self.send(body, target)
                    self.log('tx' if result.get('received') else 'failed', result.get('label', result.get('status', '')), key=body['key'], target=target['name'])
                except Exception as error:
                    self.log('failed', str(error))
        self.threads = [threading.Thread(target=receive, daemon=True), threading.Thread(target=dispatch, daemon=True)]
        for thread in self.threads:
            thread.start()
        self.log('listening', f"OSC UDP {osc['host']}:{osc['port']}")

    def close(self):
        self.stop.set()
        if self.socket:
            self.socket.close(); self.socket = None
        for thread in self.threads:
            thread.join(timeout=6)
        self.threads = []; self.state = 'stopped'; self.error = ''
