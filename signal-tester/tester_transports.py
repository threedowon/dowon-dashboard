"""Local Serial/UDP sessions. UI state never owns a device or its receive loop."""
from copy import deepcopy
import errno
import ipaddress
import re
import socket
import threading
import time
from tester_osc import OSCMonitor
from tester_fields import JSONFields

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    serial = None
    list_ports = None

MAX_SEND = 8192
PREVIEW_BYTES = 2048


def number(raw, name, low, high):
    if type(raw) is not int or not low <= raw <= high:
        raise ValueError(f'{name} must be a whole number from {low} to {high}.')
    return raw


def validate_profile(raw, base, host_validator):
    kind = raw.get('type', 'http')
    if kind == 'http':
        return {**base, 'host': host_validator(raw.get('host')), 'port': number(raw.get('port'), 'Port', 1, 65535)}
    if kind == 'serial':
        device = raw.get('device', '')
        if not isinstance(device, str) or not re.fullmatch(r'(?:COM[1-9][0-9]*|/dev/[A-Za-z0-9_./-]+)', device.strip(), re.I):
            raise ValueError('Choose a COM port, such as COM3, or a /dev/ serial device.')
        device = device.strip()
        if device.upper().startswith('COM'):
            device = device.upper()
        baud = number(raw.get('baudrate', 115200), 'Baud rate', 50, 4_000_000)
        bits = number(raw.get('dataBits', 8), 'Data bits', 5, 8)
        parity, stop = raw.get('parity', 'N'), raw.get('stopBits', 1)
        if parity not in ('N', 'E', 'O', 'M', 'S') or type(stop) not in (int, float) or stop not in (1, 1.5, 2):
            raise ValueError('Choose valid parity and stop bits.')
        return {**base, 'type': kind, 'device': device, 'baudrate': baud, 'dataBits': bits, 'parity': parity, 'stopBits': stop}
    if kind == 'udp':
        try:
            bind = str(ipaddress.IPv4Address(raw.get('bindHost', '127.0.0.1')))
        except (ValueError, TypeError):
            raise ValueError('Local bind address must be an IPv4 address. Use 0.0.0.0 to receive on all interfaces.')
        host = host_validator(raw.get('remoteHost', '127.0.0.1'))
        if ':' in host:
            raise ValueError('UDP currently supports IPv4 addresses or IPv4 hostnames.')
        broadcast = raw.get('broadcast', False)
        if type(broadcast) is not bool:
            raise ValueError('Broadcast must be on or off.')
        return {**base, 'type': kind, 'bindHost': bind, 'bindPort': number(raw.get('bindPort', 9000), 'Local port', 0, 65535),
                'remoteHost': host, 'remotePort': number(raw.get('remotePort', 9001), 'Remote port', 1, 65535), 'broadcast': broadcast}
    raise ValueError('Choose HTTP Signal, Serial or UDP.')


def encode_payload(body):
    data, fmt, ending = body.get('data', ''), body.get('format', 'text'), body.get('ending', 'none')
    if not isinstance(data, str) or len(data) > MAX_SEND*3:
        raise ValueError('Payload is too large (maximum 8 KB).')
    if ending not in ('none', 'lf', 'crlf', 'cr'):
        raise ValueError('Choose a valid line ending.')
    if fmt == 'hex':
        compact = re.sub(r'\s+', '', data)
        if not re.fullmatch(r'(?:[0-9a-fA-F]{2})+', compact):
            raise ValueError('HEX needs complete byte pairs, for example: AA 01 0D 0A.')
        if ending != 'none':
            raise ValueError('HEX sends exact bytes. Set the line ending to None.')
        packet = bytes.fromhex(compact)
    elif fmt == 'text':
        packet = data.encode('utf-8') + {'none': b'', 'lf': b'\n', 'crlf': b'\r\n', 'cr': b'\r'}[ending]
    else:
        raise ValueError('Choose Text or HEX.')
    if not packet or len(packet) > MAX_SEND:
        raise ValueError('Send between 1 and 8192 bytes, including the line ending.')
    return packet


def packet_preview(data):
    sample = data[:PREVIEW_BYTES]
    try:
        sample.decode('utf-8')
        utf8 = True
    except UnicodeDecodeError:
        utf8 = False
    return {'bytes': len(data), 'text': sample.decode('utf-8', 'replace'), 'hex': sample.hex(' ').upper(),
            'utf8': utf8, 'truncated': len(data) > len(sample)}


def diagnose(error, stage, kind):
    code = getattr(error, 'winerror', None) or getattr(error, 'errno', None)
    message = str(error)
    lower = message.lower()
    if isinstance(error, socket.gaierror):
        return 'Host lookup failed', 'The remote hostname could not be resolved. Check its spelling or use an IPv4 address.'
    if code in (errno.EADDRINUSE, 10048):
        return 'Local port already in use', 'Another receiver owns this local UDP port. Close it or choose a different local port.'
    if code in (errno.EADDRNOTAVAIL, 10049):
        return 'Local address unavailable', 'The bind IP must belong to this PC. Use 0.0.0.0 to listen on all local IPv4 interfaces.'
    if code in (errno.EACCES, errno.EPERM, 5, 13, 10013) or 'permission' in lower or 'access is denied' in lower:
        if kind == 'udp':
            return 'UDP access denied', 'Check Windows Firewall and port restrictions. For broadcast destinations, enable Allow broadcast sends in this connection.'
        return 'Port busy or access denied', 'Close other apps using this port, then reconnect. Check device permissions and the selected port.'
    if code in (errno.ENOENT, 2, 3) or 'cannot find' in lower or 'no such file' in lower or 'filenotfound' in lower:
        return 'Device not found', 'The selected port is no longer available. Check the USB cable and refresh the COM port list.'
    if isinstance(error, TimeoutError) or 'timeout' in lower or 'timed out' in lower:
        return 'Write timed out', 'The device did not accept all bytes in time. Check the connection and serial settings; some bytes may already have been sent.'
    if kind == 'serial':
        return ('Serial connection lost' if stage != 'open' else 'Could not open serial port'), 'Check the USB cable, port owner and baud / framing settings. Reconnect after fixing the issue.'
    return 'UDP '+stage+' failed', 'Check local and remote IPs, ports and firewall rules. UDP does not guarantee a reply or delivery.'


class Session:
    def __init__(self, profile):
        self.profile = deepcopy(profile)
        self.osc = OSCMonitor()
        self.fields = JSONFields()
        self.lock = threading.RLock()
        self.write_lock = threading.Lock()
        self.stop = threading.Event()
        self.handle = None
        self.thread = None
        self.state = {'status': 'closed', 'stage': 'open', 'detail': 'Not connected.', 'error': None,
                      'rxBytes': 0, 'txBytes': 0, 'rxCount': 0, 'txCount': 0, 'lastRx': None, 'lastTx': None,
                      'lastPacket': None, 'local': None, 'openedAt': None}


class TransportHub:
    def __init__(self, emit, serial_factory=None, port_provider=None):
        self.emit = emit
        self.on_data = None
        self.lock = threading.RLock()
        self.sessions = {}
        self.serial_factory = serial_factory or (serial.Serial if serial else None)
        self.port_provider = port_provider or (list_ports.comports if list_ports else None)
        self.ports = []
        self.scan_error = ''
        self.stop = threading.Event()
        self.scanner = None

    def scan(self):
        if not self.port_provider:
            with self.lock:
                self.scan_error = 'Serial support is not installed. Run Python -m pip install pyserial using the same Python as this tester.'
            return self.port_state()
        try:
            ports = [{'device': p.device, 'description': p.description or p.device, 'manufacturer': p.manufacturer or '',
                      'serialNumber': p.serial_number or '', 'vid': p.vid, 'pid': p.pid} for p in self.port_provider()]
            ports.sort(key=lambda p: [int(n) if n.isdigit() else n.lower() for n in re.split(r'(\d+)', p['device'])])
            with self.lock:
                previous = {p['device'].casefold() for p in self.ports}
                current = {p['device'].casefold() for p in ports}
                self.ports, self.scan_error = ports, ''
                sessions = list(self.sessions.values())
            for session in sessions:
                device = session.profile.get('device', '').casefold()
                if device in previous and device not in current:
                    with session.lock:
                        is_open = session.state['status'] == 'open'
                    if is_open:
                        self._failed(session, OSError(errno.ENOENT, 'USB device disconnected'), 'receive')
        except Exception as error:
            with self.lock:
                self.scan_error = f'COM port scan failed: {error}'
        return self.port_state()

    def start(self):
        self.scan()
        def watch():
            while not self.stop.wait(2):
                self.scan()
        self.scanner = threading.Thread(target=watch, daemon=True, name='com-discovery')
        self.scanner.start()

    def port_state(self):
        with self.lock:
            return {'available': self.serial_factory is not None, 'ports': deepcopy(self.ports), 'error': self.scan_error}

    def snapshot(self, profiles):
        with self.lock:
            found = {p['device'].casefold() for p in self.ports}
            states = {}
            for profile in profiles:
                if profile.get('type', 'http') == 'http':
                    continue
                session = self.sessions.get(profile['id'])
                if session:
                    with session.lock:
                        state = deepcopy(session.state)
                        state['fields'] = session.fields.snapshot()
                        if profile['type'] == 'udp':
                            state['osc'] = session.osc.snapshot()
                else:
                    state = deepcopy(Session(profile).state)
                state['detected'] = profile.get('device', '').casefold() in found if profile['type'] == 'serial' else None
                states[profile['id']] = state
            return states

    def field_detail(self, target_id, key):
        with self.lock:
            session = self.sessions.get(target_id)
            if not session:
                return {'key': key, 'points': []}
            with session.lock:
                return session.fields.detail(key)

    def osc_detail(self, target_id, address, argument):
        with self.lock:
            session = self.sessions.get(target_id)
            if not session:
                return {'address': address, 'argument': argument, 'points': []}
            with session.lock:
                return session.osc.detail(address, argument)

    def _event(self, session, direction, stage, status, label, detail, **extra):
        return self.emit({'protocol': session.profile['type'], 'direction': direction, 'stage': stage,
                          'status': status, 'label': label, 'detail': detail, 'target': deepcopy(session.profile),
                          'ok': status != 'error', **extra})

    def _failed(self, session, error, stage):
        with session.lock:
            if session.stop.is_set():
                return None
            label, detail = diagnose(error, stage, session.profile['type'])
            session.state.update(status='error', stage=stage, detail=detail, error={'label': label, 'detail': detail, 'raw': str(error)[:500], 'stage': stage})
            session.stop.set()
            handle = session.handle
        if handle:
            try:
                handle.close()
            except OSError:
                pass
        return self._event(session, 'SYSTEM', stage, 'error', label, detail, error=str(error)[:500])

    def open(self, profile):
        with self.lock:
            existing = self.sessions.get(profile['id'])
            if existing and existing.state['status'] == 'open' and existing.profile == profile:
                return
            if sum(s.state['status'] == 'open' for s in self.sessions.values()) >= 16:
                raise ValueError('Up to 16 connections can be open at once. Close another connection first.')
            if existing:
                self._close(existing, announce=False)
            session = Session(profile)
            self.sessions[profile['id']] = session
            try:
                if profile['type'] == 'serial':
                    if not self.serial_factory:
                        raise ValueError('Serial support is not installed. Install pyserial using this tester\'s Python and restart.')
                    if any(s is not session and s.state['status'] == 'open' and s.profile.get('device', '').casefold() == profile['device'].casefold() for s in self.sessions.values()):
                        raise PermissionError('This serial port is already open in another tester connection.')
                    session.handle = self.serial_factory(port=profile['device'], baudrate=profile['baudrate'], bytesize=profile['dataBits'],
                                                         parity=profile['parity'], stopbits=profile['stopBits'], timeout=.15, write_timeout=1)
                    local = profile['device']
                    label, detail = 'Serial port open', 'Port opened. Waiting for bytes; an open port alone does not prove the sensor is sending valid data.'
                elif profile['type'] == 'udp':
                    handle = session.handle = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
                        handle.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                    if profile['broadcast']:
                        handle.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                    handle.settimeout(.2)
                    handle.bind((profile['bindHost'], profile['bindPort']))
                    local = '%s:%s' % handle.getsockname()
                    label, detail = 'UDP listening', 'Local socket is ready for send / receive. Remote availability is not confirmed.'
                else:
                    raise ValueError('Only Serial and UDP connections need to be opened.')
                with session.lock:
                    session.state.update(status='open', stage='receive', detail=detail, local=local, openedAt=time.time()*1000)
                self._event(session, 'SYSTEM', 'open', 'open', label, detail, local=local)
                session.thread = threading.Thread(target=self._read, args=(session,), daemon=True, name=profile['type']+'-receive')
                session.thread.start()
            except Exception as error:
                if session.profile['type'] == 'serial' and self.serial_factory is None:
                    with session.lock:
                        session.state.update(status='error', stage='open', detail=str(error), error={'label':'Serial support missing','detail':str(error),'raw':str(error),'stage':'open'})
                    self._event(session,'SYSTEM','open','error','Serial support missing',str(error))
                    return
                self._failed(session, error, 'open')

    def _read(self, session):
        while not session.stop.is_set():
            try:
                if session.profile['type'] == 'serial':
                    data = session.handle.read(min(max(session.handle.in_waiting, 1), 4096))
                    peer = session.profile['device']
                    if not data:
                        continue
                else:
                    data, sender = session.handle.recvfrom(65535)
                    peer = '%s:%s' % sender
                packet = packet_preview(data)
                stamp = time.time()*1000
                with session.lock:
                    if session.stop.is_set():
                        return
                    session.state['rxBytes'] += len(data)
                    session.state['rxCount'] += 1
                    session.fields.receive(data, stamp, session.profile['type'] == 'udp')
                    osc = session.osc.receive(data, stamp, peer) if session.profile['type'] == 'udp' else None
                    if osc is not None:
                        packet['osc'] = osc
                    session.state.update(lastRx=stamp, lastPacket={**packet, 'peer': peer}, detail='Bytes received. Inspect Text / HEX below.')
                if self.on_data:
                    self.on_data(session.profile, data)
                detail = ('Raw serial chunks; one read may contain part of a message or several messages.' if session.profile['type'] == 'serial' else 'A datagram arrived at this local socket. This is not an acknowledgment of a specific send.')
                self._event(session, 'RX', 'receive', 'error' if osc and 'error' in osc else 'received',
                            'OSC parse error' if osc and 'error' in osc else 'OSC received' if osc else 'Bytes received',
                            osc['error'] if osc and 'error' in osc else detail, packet=packet, peer=peer)
            except socket.timeout:
                continue
            except Exception as error:
                self._failed(session, error, 'receive')
                return

    def send(self, profile, body):
        packet = encode_payload(body)
        with self.lock:
            session = self.sessions.get(profile['id'])
            if not session or session.profile != profile or session.state['status'] != 'open':
                session = session or Session(profile)
                return self._event(session, 'TX', 'send', 'error', 'Connection is not open', 'Open this connection before sending data.')
            with session.write_lock:
                started = time.monotonic()
                try:
                    if profile['type'] == 'serial':
                        size = session.handle.write(packet)
                        peer = profile['device']
                        if size != len(packet):
                            raise TimeoutError(f'Partial write: {size} of {len(packet)} bytes. Do not retry blindly.')
                        detail = 'Bytes accepted by the local serial driver. Device acknowledgment is not confirmed.'
                    else:
                        # IPv4 resolution is explicit; receive always stays bound to the selected local port.
                        remote = socket.getaddrinfo(profile['remoteHost'], profile['remotePort'], socket.AF_INET, socket.SOCK_DGRAM)[0][4]
                        size = session.handle.sendto(packet, remote)
                        peer = '%s:%s' % remote
                        detail = 'Datagram accepted by the local socket. Remote receipt is not confirmed; UDP has no delivery acknowledgment.'
                    with session.lock:
                        session.state['txBytes'] += size
                        session.state['txCount'] += 1
                        session.state['lastTx'] = time.time()*1000
                        if session.state['error'] and session.state['error']['stage'] == 'send':
                            session.state.update(error=None, stage='receive', detail='Send completed. Waiting for received data.')
                    return self._event(session, 'TX', 'send', 'sent', 'Bytes sent' if profile['type']=='serial' else 'Datagram sent', detail,
                                       packet=packet_preview(packet), peer=peer, elapsed=round((time.monotonic()-started)*1000))
                except Exception as error:
                    label, detail = diagnose(error, 'send', profile['type'])
                    with session.lock:
                        session.state['error'] = {'label': label, 'detail': detail, 'raw': str(error)[:500], 'stage': 'send'}
                        session.state.update(stage='send', detail=detail)
                    return self._event(session, 'TX', 'send', 'error', label, detail, packet=packet_preview(packet), error=str(error)[:500])

    def _close(self, session, announce=True):
        with session.lock:
            was_open = session.state['status'] == 'open'
            session.stop.set()
            session.state.update(status='closed', stage='open', detail='Closed. Open this connection to resume receiving.', error=None)
        if session.handle:
            try:
                session.handle.close()
            except OSError:
                pass
        if session.thread and session.thread is not threading.current_thread():
            session.thread.join(timeout=.6)
        if was_open and announce:
            self._event(session, 'SYSTEM', 'close', 'closed', 'Connection closed', 'This connection no longer sends or receives data.')

    def disconnect(self, target_id):
        with self.lock:
            if target_id in self.sessions:
                self._close(self.sessions[target_id])

    def reconcile(self, profiles):
        next_profiles = {p['id']: p for p in profiles}
        with self.lock:
            for key, session in list(self.sessions.items()):
                if next_profiles.get(key) != session.profile:
                    self._close(session)
                    del self.sessions[key]

    def close(self):
        self.stop.set()
        if self.scanner:
            self.scanner.join(timeout=1)
        with self.lock:
            for session in self.sessions.values():
                self._close(session, announce=False)
