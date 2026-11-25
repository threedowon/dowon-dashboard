"""Bounded numeric sensor streams and edge-triggered rules, independent of the UI."""
from collections import deque
from copy import deepcopy
import json
import math
import re
import threading
import time

KEY_CODES = ([f'Key{c}' for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] + [f'Digit{i}' for i in range(10)]
             + [f'F{i}' for i in range(1, 13)] + ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                'Space', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown']
             + [f'Numpad{i}' for i in range(10)] + ['NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter'])


def shortcut(raw):
    if raw in (None, ''):
        return None
    if not isinstance(raw, str) or raw not in KEY_CODES:
        raise ValueError('Choose a supported keyboard key. Modifiers and Escape are reserved.')
    return raw


def finite(raw, name, low=-1e12, high=1e12):
    if type(raw) not in (int, float) or not math.isfinite(raw) or not low <= raw <= high:
        raise ValueError(f'{name} must be a finite number from {low} to {high}.')
    return raw


def validate_monitors(raw, targets, signals):
    if not isinstance(raw, list) or len(raw) > 32:
        raise ValueError('Use up to 32 sensor monitors.')
    def text(value, name):
        if not isinstance(value, str) or not value.strip() or len(value) > 80:
            raise ValueError(f'{name} must contain 1–80 characters.')
        return value.strip()
    result = []
    for m in raw:
        if not isinstance(m, dict):
            raise ValueError('Invalid sensor monitor.')
        parser = m.get('parser', 'number')
        field = m.get('field', '')
        if parser not in ('number', 'json') or not isinstance(field, str) or len(field) > 120:
            raise ValueError('Choose Number or JSON field as the sensor format.')
        if parser == 'json' and not re.fullmatch(r'[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*', field):
            raise ValueError('Enter a JSON field path, such as distance or sensor.distance.')
        source = text(m.get('sourceId'), 'Sensor source')
        # Keep dangling references visible after a connection or Signal is deleted.
        t = next((t for t in targets if t['id'] == source), None)
        if t and t.get('type', 'http') == 'http':
            raise ValueError('A sensor source must be a Serial or UDP connection.')
        unit = m.get('unit', '')
        if not isinstance(unit, str) or len(unit) > 16:
            raise ValueError('Sensor unit must contain at most 16 characters.')
        rules = m.get('rules', [])
        if not isinstance(rules, list) or len(rules) > 16:
            raise ValueError('Use up to 16 rules per sensor.')
        clean = []
        for r in rules:
            if not isinstance(r, dict) or r.get('op') not in ('lt', 'gt'):
                raise ValueError('Choose Below or Above for each sensor rule.')
            target_id = text(r.get('targetId'), 'Rule output target')
            target = next((t for t in targets if t['id'] == target_id), None)
            if target and target.get('type', 'http') != 'http':
                raise ValueError('Rules send Signals to HTTP Player targets only.')
            value_mode = r.get('valueMode', 'sensor')
            enabled = r.get('enabled', True)
            if value_mode not in ('sensor', 'saved') or type(enabled) is not bool:
                raise ValueError('Invalid rule value mode or enabled state.')
            clean.append({'id': text(r.get('id'), 'Rule ID'), 'signalId': text(r.get('signalId'), 'Rule Signal'),
                          'targetId': target_id, 'op': r['op'], 'threshold': finite(r.get('threshold'), 'Threshold'),
                          'hysteresis': finite(r.get('hysteresis', 0), 'Reset margin', 0, 1e12),
                          'hold': finite(r.get('hold', 0), 'Hold time', 0, 3600),
                          'valueMode': value_mode, 'enabled': enabled})
            if 'repeatSeconds' in r:
                interval = finite(r['repeatSeconds'], 'Repeat interval', 0, 3600)
                if 0 < interval < .1:
                    raise ValueError('Repeat interval must be 0 (once) or at least 0.1 seconds.')
                clean[-1]['repeatSeconds'] = interval
        if len({r['id'] for r in clean}) != len(clean):
            raise ValueError('Duplicate sensor rule IDs.')
        result.append({'id': text(m.get('id'), 'Monitor ID'), 'name': text(m.get('name'), 'Monitor name'),
                       'sourceId': source, 'parser': parser, 'field': field, 'unit': unit.strip(),
                       'staleSeconds': finite(m.get('staleSeconds', 2), 'Data timeout', .1, 60), 'rules': clean})
    if len({m['id'] for m in result}) != len(result):
        raise ValueError('Duplicate sensor monitor IDs.')
    return result


class Frames:
    """Serial is line framed (LF / CR / CRLF); UDP is one or more complete lines."""
    def __init__(self):
        self.buffer = bytearray()
        self.discard = False

    def read(self, data, datagram=False):
        frames = []
        for byte in data:
            if byte in (10, 13):
                if self.buffer:
                    frames.append(bytes(self.buffer))
                self.buffer.clear()
                self.discard = False
            elif not self.discard:
                self.buffer.append(byte)
                if len(self.buffer) > 4096:
                    frames.append(ValueError('Message exceeds 4096 bytes. Use one number or JSON object per line.'))
                    self.buffer.clear()
                    self.discard = True
        if datagram:
            if self.buffer:
                frames.append(bytes(self.buffer))
            self.buffer.clear()
            self.discard = False
        return frames


def parse_value(frame, config):
    if isinstance(frame, Exception):
        raise frame
    try:
        text = frame.decode('utf-8').strip()
        if config['parser'] == 'json':
            value = json.loads(text)
            for part in config['field'].split('.'):
                value = value[part] if isinstance(value, dict) else value[int(part)]
            if type(value) not in (int, float):
                raise ValueError('JSON field is not a number.')
        else:
            if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', text):
                raise ValueError('Expected a plain number, such as 120.5.')
            value = float(text)
        return finite(value, 'Sensor value')
    except (UnicodeError, KeyError, IndexError, TypeError, OverflowError, ValueError, RecursionError) as error:
        raise ValueError(f'Cannot parse sensor value: {error}') from None


class RuleState:
    def __init__(self):
        self.since = None
        self.latched = False
        self.last_fire = None
        self.status = 'Waiting for data'
        self.last_result = None
        self.last_ok = None
        self.retry_at = 0
        self.revision = 0
        self.sending = False

    def reset_input(self):
        self.since = None
        self.latched = False
        self.last_fire = None
        self.revision += 1

    def sample(self, value, now, rule):
        below = rule['op'] == 'lt'
        threshold, margin = rule['threshold'], rule['hysteresis']
        repeat = rule.get('repeatSeconds', 0)
        if repeat:
            # Repeats require a fresh, strictly matching sample, not a timer
            # replaying the last value. Hold applies once per continuous visit.
            matched = value < threshold if below else value > threshold
            if not matched:
                self.reset_input()
                self.status = 'Waiting for threshold'
                return False
            if self.since is None:
                self.since = now
            if now - self.since + 1e-9 < rule['hold']:
                self.status = f"Holding · {now-self.since:.1f} / {rule['hold']:g}s"
                return False
            if now < self.retry_at:
                self.status = 'Signal cooldown · waiting for fresh data'
                return False
            if self.last_fire is not None and now - self.last_fire + 1e-9 < repeat:
                self.status = 'Detected · waiting for next repeat'
                return False
            self.last_fire = now
            self.status = 'Queued'
            return True
        if self.latched:
            released = value >= threshold + margin if below else value <= threshold - margin
            if not released:
                self.status = 'Sent · waiting for reset'
                return False
            self.latched = False
        matched = value < threshold if below else value > threshold
        if not matched:
            self.since = None
            self.status = 'Waiting for threshold'
            return False
        if self.since is None:
            self.since = now
        if now - self.since + 1e-9 < rule['hold']:
            self.status = f"Holding · {now-self.since:.1f} / {rule['hold']:g}s"
            return False
        if now < self.retry_at:
            self.status = f"Signal cooldown · {self.retry_at-now:.1f}s"
            return False
        self.latched, self.last_fire, self.since = True, now, None
        self.status = 'Queued'
        return True


class SensorEngine:
    def __init__(self, emit, send, clock=time.monotonic):
        self.emit, self.send, self.clock = emit, send, clock
        self.lock = threading.RLock()
        self.wake = threading.Condition(self.lock)
        self.monitors = {}
        self.signature = None
        self.targets, self.signals = {}, {}
        self.online = set()
        self.armed = False
        self.generation = 0
        self.jobs = deque()
        self.stopped = False
        self.worker = threading.Thread(target=self._work, daemon=True, name='sensor-signals')
        self.worker.start()

    def configure(self, workspace):
        # Selection/name/keyboard changes must not reset a running sensor rule.
        targets = {t['id']: t for t in workspace['targets']}
        signals = {s['id']: s for s in workspace['signals']}
        configs = workspace.get('sensors', [])
        referenced_targets = {m['sourceId'] for m in configs} | {r['targetId'] for m in configs for r in m['rules']}
        referenced_signals = {r['signalId'] for m in configs for r in m['rules']}
        signature = [configs, [targets.get(i) for i in sorted(referenced_targets)],
                     [{k: signals[i].get(k) for k in ('id', 'key', 'value')} if i in signals else None for i in sorted(referenced_signals)]]
        with self.lock:
            self.targets, self.signals = deepcopy(targets), deepcopy(signals)
            if signature == self.signature:
                return
            self.signature = deepcopy(signature)
            self.armed = False
            self.generation += 1
            self.jobs.clear()
            self.monitors = {c['id']: {'config': deepcopy(c), 'frames': Frames(), 'points': deque(maxlen=600),
                'value': None, 'last': None, 'lastRaw': None, 'time': None, 'error': '', 'errors': 0, 'samples': 0, 'lastLog': -1e9,
                'rules': {r['id']: RuleState() for r in c['rules']}} for c in configs}

    def connection_event(self, event):
        if event.get('direction') != 'SYSTEM':
            return
        target = event['target']['id']
        with self.lock:
            if event.get('status') == 'open':
                self.online.add(target)
            elif event.get('status') in ('closed', 'error'):
                self.online.discard(target)
            else:
                return
            for m in self.monitors.values():
                if m['config']['sourceId'] == target:
                    m['frames'] = Frames()
                    m['last'] = None
                    m['lastRaw'] = None
                    for r in m['rules'].values():
                        r.reset_input()
            self.jobs = deque(j for j in self.jobs if j['sourceId'] != target)

    def arm(self, enabled):
        if type(enabled) is not bool:
            raise ValueError('Rules enabled must be true or false.')
        with self.lock:
            if enabled:
                rules = [(m, r) for m in self.monitors.values() for r in m['config']['rules'] if r['enabled']]
                if not rules:
                    raise ValueError('Add at least one enabled sensor rule first.')
                for m, r in rules:
                    if self.problem(m, r):
                        raise ValueError(self.problem(m, r))
                    if m['config']['sourceId'] not in self.online:
                        raise ValueError('Open each sensor source connection before enabling rules.')
            self.armed = enabled
            self.generation += 1
            self.jobs.clear()
            for m in self.monitors.values():
                m['rules'] = {r['id']: RuleState() for r in m['config']['rules']}

    def problem(self, m, rule=None):
        if m['config']['sourceId'] not in self.targets:
            return 'Source deleted · choose another connection'
        if rule and rule['signalId'] not in self.signals:
            return 'Signal deleted · choose another Signal'
        if rule and rule['targetId'] not in self.targets:
            return 'Player target deleted · choose another target'
        return ''

    def feed(self, profile, data):
        now, wall = self.clock(), time.time()*1000
        with self.lock:
            if profile['id'] not in self.online:
                return
            for m in self.monitors.values():
                config = m['config']
                if config['sourceId'] != profile['id']:
                    continue
                if m['lastRaw'] is not None and now-m['lastRaw'] > config['staleSeconds']:
                    # An old unterminated serial fragment must not prefix a new measurement.
                    m['frames'] = Frames()
                m['lastRaw'] = now
                for frame in m['frames'].read(data, profile['type'] == 'udp'):
                    try:
                        value = parse_value(frame, config)
                    except ValueError as error:
                        m['error'], m['errors'], m['last'] = str(error), m['errors']+1, None
                        self.jobs = deque(j for j in self.jobs if j['monitorId'] != config['id'])
                        for state in m['rules'].values():
                            state.reset_input()
                        if now - m['lastLog'] >= 2:
                            m['lastLog'] = now
                            self.emit({'target': profile, 'protocol': profile['type'], 'direction': 'SYSTEM', 'stage': 'parse',
                                       'ok': False, 'label': 'Sensor parse failed', 'detail': config['name']+': '+str(error)})
                        continue
                    if m['last'] is None or now-m['last'] > config['staleSeconds']:
                        for state in m['rules'].values():
                            state.reset_input()
                    m.update(value=value, last=now, time=wall, error='', samples=m['samples']+1)
                    # Only graph storage is downsampled; every measurement evaluates the rules.
                    if not m['points'] or wall-m['points'][-1][0] >= 100:
                        m['points'].append([wall, value])
                    else:
                        m['points'][-1][1] = value
                    for rule in config['rules']:
                        if not self.armed or not rule['enabled'] or self.problem(m, rule):
                            continue
                        state = m['rules'][rule['id']]
                        if rule.get('repeatSeconds', 0):
                            matches = value < rule['threshold'] if rule['op'] == 'lt' else value > rule['threshold']
                            if not matches:
                                state.sample(value, now, rule)
                                self.jobs = deque(j for j in self.jobs if not (
                                    j['monitorId'] == config['id'] and j['ruleId'] == rule['id']))
                                continue
                            if state.sending or any(j['monitorId'] == config['id'] and j['ruleId'] == rule['id'] for j in self.jobs):
                                continue
                        if state.sample(value, now, rule):
                            if len(self.jobs) >= 64:
                                state.status = 'Dropped · output queue full'
                                state.last_result = state.status
                                self.emit({'target': profile, 'protocol': profile['type'], 'direction': 'SYSTEM', 'stage': 'rule',
                                           'ok': False, 'label': 'Sensor output queue full', 'detail': 'Signal dropped. Slow down rules or check Player response time.'})
                                continue
                            sig = self.signals[rule['signalId']]
                            self.jobs.append({'generation': self.generation, 'monitorId': config['id'], 'ruleId': rule['id'],
                                'revision': state.revision,
                                'sourceId': profile['id'], 'created': now, 'payload': {'targetId': rule['targetId'], 'key': sig['key'],
                                'value': value if rule['valueMode'] == 'sensor' else sig['value'], 'origin': 'Sensor · '+config['name'],
                                '_target': deepcopy(self.targets[rule['targetId']])}})
                            self.wake.notify()

    def _work(self):
        while True:
            with self.wake:
                self.wake.wait_for(lambda: self.jobs or self.stopped)
                if self.stopped:
                    return
                job = self.jobs.popleft()
                m = self.monitors.get(job['monitorId'])
                if not m or not self.armed or job['generation'] != self.generation:
                    continue
                state = m['rules'][job['ruleId']]
                if (job['revision'] != state.revision or job['sourceId'] not in self.online or m['last'] is None or
                    self.clock()-job['created'] > m['config']['staleSeconds']):
                    state.last_result = state.status = 'Dropped · stale input'
                    continue
                state.status = 'Sending'
                state.sending = True
            # Never block receive threads on a Player network request. In-flight sends cannot be recalled.
            result = {}
            try:
                result = self.send(job['payload'])
                summary = result['label']
                ok = bool(result.get('received', result.get('ok', False)))
            except Exception as error:
                summary = 'Output failed: '+str(error)
                ok = False
                self.emit({'target': self.targets.get(job['payload']['targetId'], {'id':'deleted','name':'Deleted Player'}),
                           'protocol':'http','direction':'TX','stage':'rule','ok':False,'label':'Sensor output failed','detail':summary})
            with self.lock:
                state.sending = False
                if job['generation'] == self.generation and job['revision'] == state.revision:
                    state.last_result = summary
                    state.last_ok = ok
                    repeat = next(r for r in m['config']['rules'] if r['id'] == job['ruleId']).get('repeatSeconds', 0)
                    state.status = ('Sent' if ok else 'Output failed') + (' · waiting for fresh data' if repeat else ' · waiting for reset')
                    if result.get('stage') == 'cooldown':
                        state.latched = False
                        state.retry_at = self.clock() + result['remaining']
                        state.status = 'Signal cooldown · waiting for fresh data'

    def snapshot(self, selected=None, graph_ids=()):
        now = self.clock()
        with self.lock:
            result = []
            for index, (mid, m) in enumerate(self.monitors.items()):
                c = m['config']
                problem = self.problem(m)
                live = m['last'] is not None and now-m['last'] <= c['staleSeconds']
                status = problem or ('Source closed' if c['sourceId'] not in self.online else
                                    'Parse error' if m['error'] else 'Receiving' if live else
                                    'Waiting for line ending' if m['frames'].buffer else 'Waiting for data' if m['time'] is None else 'Data timeout')
                rules = []
                for rule in c['rules']:
                    s = m['rules'][rule['id']]
                    rules.append({'id': rule['id'], 'status': self.problem(m, rule) or ('Disabled' if not rule['enabled'] else
                        'Rules paused' if not self.armed else status if not live else s.status), 'lastResult': s.last_result, 'lastOK': s.last_ok})
                result.append({'id': mid, 'status': status, 'live': live, 'value': m['value'], 'time': m['time'],
                    'error': m['error'], 'errors': m['errors'], 'samples': m['samples'], 'rules': rules,
                    'points': list(m['points']) if mid in graph_ids or mid == selected or selected is None and index == 0 else []})
            return {'armed': self.armed, 'monitors': result, 'queued': len(self.jobs)}

    def close(self):
        with self.wake:
            self.stopped = True
            self.armed = False
            self.jobs.clear()
            self.wake.notify_all()
        self.worker.join(6)
