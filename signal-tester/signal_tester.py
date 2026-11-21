#!/usr/bin/env python3
"""Local HTTP, Serial and UDP tester. Serial support uses the optional pyserial package."""
import argparse
from collections import deque
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit, parse_qs
import uuid
import webbrowser
from tester_transports import TransportHub, validate_profile
from tester_sensors import SensorEngine, validate_monitors, shortcut
from tester_launcher import publish_instance, clear_instance
from tester_presets import add_sensor_preset

BASE = Path(__file__).resolve().parent
KEY = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$")
STATUS = {
    "transitioned": ("Scene changed", "The Player switched to the next scene."),
    "queued": ("Waiting for timeline point", "Received. The Player will switch at the next configured Timeline Branch point; no resend is needed."),
    "matched": ("Waiting for other triggers", "Received. Another AND condition still needs to fire."),
    "ignored": ("No matching condition", "Received. This scene does not use this Signal."),
    "cooldown": ("Cooldown", "Received. Wait for the Signal cooldown before sending again."),
    "unknown": ("Unknown Signal", "Add this key in Editor > Signals, then apply the .scene to the Player."),
    "stopped": ("Playback stopped", "Start playback and check Operating Hours in the Player."),
    "busy": ("Transition in progress", "The Player is switching scenes. Try again after the transition."),
    "unavailable": ("Player unavailable", "The receiver is running, but the Player did not respond."),
}


def uid():
    return uuid.uuid4().hex


def label(value, field, limit=80):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValueError(f"{field} must contain 1–{limit} characters.")
    return value.strip()


def normalize_host(raw):
    host = label(raw, "IP / hostname", 253).strip("[]")
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host):
            raise ValueError("Enter an IP or hostname only, without http://, a path or a port.")
        if any(not part or len(part) > 63 or part.startswith('-') or part.endswith('-') for part in host.split('.')):
            raise ValueError("Enter a valid IP or hostname.")
        return host.lower()


def signal_key(raw):
    if not isinstance(raw, str) or not KEY.fullmatch(raw.strip()):
        raise ValueError("Key: use letters, numbers, dots, underscores, colons or hyphens (max 120).")
    return raw.strip().lower()


def validate_value(value):
    if value is not None and type(value) not in (str, int, float, bool):
        raise ValueError("Value must be text, a finite number, true / false, or null.")
    if type(value) in (int, float) and (abs(value) > 1.7976931348623157e308 or not math.isfinite(value)):
        raise ValueError("Value must be a finite number.")
    if len(json.dumps(value, ensure_ascii=False).encode('utf-8')) > 7000:
        raise ValueError("Value is too long (maximum 7 KB).")
    return value


def target(raw):
    if not isinstance(raw, dict):
        raise ValueError("Invalid target.")
    base = {'id': label(raw.get('id'), 'Target ID'), 'name': label(raw.get('name'), 'Target name')}
    return validate_profile(raw, base, normalize_host)


def signal(raw):
    if not isinstance(raw, dict):
        raise ValueError("Invalid Signal.")
    result = {'id': label(raw.get('id'), 'Signal ID'), 'name': label(raw.get('name'), 'Signal name'),
              'key': signal_key(raw.get('key')), 'value': validate_value(raw.get('value'))}
    cooldown = raw.get('cooldown', 3)
    if isinstance(cooldown, bool) or not isinstance(cooldown, (int, float)) or not math.isfinite(cooldown) or not 0 <= cooldown <= 3600:
        raise ValueError('Signal cooldown must be between 0 and 3600 seconds.')
    result['cooldown'] = cooldown
    binding = shortcut(raw.get('shortcut'))
    if binding:
        result['shortcut'] = binding
    return result


def validate_workspace(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get('targets'), list) or not isinstance(raw.get('signals'), list):
        raise ValueError("Choose a Signal Tester workspace JSON file.")
    if len(raw['targets']) > 100 or len(raw['signals']) > 500:
        raise ValueError("A workspace supports up to 100 targets and 500 Signals.")
    if raw.get('version', 1) != 1:
        raise ValueError("This workspace version is not supported.")
    targets, signals = list(map(target, raw['targets'])), list(map(signal, raw['signals']))
    for items, key, name in [(targets, 'id', 'target IDs'), (signals, 'id', 'Signal IDs'), (signals, 'key', 'Signal keys')]:
        if len({item[key] for item in items}) != len(items):
            raise ValueError(f"Duplicate {name} are not allowed.")
    active = raw.get('activeTarget')
    if active not in {item['id'] for item in targets}:
        active = targets[0]['id'] if targets else None
    bindings = [s['shortcut'] for s in signals if s.get('shortcut')]
    if len(set(bindings)) != len(bindings):
        raise ValueError('This keyboard key is already assigned to another Signal.')
    result = {'version': 1, 'targets': targets, 'signals': signals, 'activeTarget': active}
    if 'sensors' in raw:
        result['sensors'] = validate_monitors(raw['sensors'], targets, signals)
    return result


def defaults():
    local = {'id': uid(), 'name': 'This PC', 'host': '127.0.0.1', 'port': 8420}
    return {'version': 1, 'targets': [local], 'activeTarget': local['id'], 'signals': [
        {'id': uid(), 'name': 'Person detected', 'key': 'person', 'value': None},
        {'id': uid(), 'name': 'Person left', 'key': 'person_far', 'value': None},
    ]}


def scene_signals(document):
    if not isinstance(document, dict):
        raise ValueError("Choose a valid .scene file.")
    project = document.get('project', document)
    if not isinstance(project, dict) or not isinstance(project.get('scenes'), list):
        raise ValueError("This file does not contain a scene project.")
    found = {}
    for item in project.get('signals', []):
        key = signal_key(item.get('key'))
        found[key] = {'id': uid(), 'name': label(item.get('name') or key, 'Signal name'), 'key': key, 'value': None}
    for scene in project['scenes']:
        for condition in scene.get('conditions', []):
            for trigger in condition.get('triggers', []):
                if trigger.get('type') == 'signal':
                    key = signal_key(trigger.get('key'))
                    found.setdefault(key, {'id': uid(), 'name': key, 'key': key, 'value': None})
    return list(found.values())


class Store:
    def __init__(self, file):
        self.file, self.lock, self.warning = Path(file), threading.RLock(), ''
        self.data = validate_workspace(defaults())
        if self.file.exists():
            try:
                self.data = validate_workspace(json.loads(self.file.read_text(encoding='utf-8-sig')))
            except (OSError, ValueError, TypeError, KeyError, OverflowError) as error:
                self.warning = f"Saved workspace could not be loaded: {error}. Back up and repair or rename {self.file}, then restart. The original file has not been changed."
                self.load_failed = True
        self.load_failed = getattr(self, 'load_failed', False)
        self.last_signal_sends = {}
        self.events = deque(maxlen=500)
        self.sequence = 0
        self.generation = 0

    def emit(self, event):
        with self.lock:
            self.sequence += 1
            event = {'id': uid(), 'time': time.time()*1000, **event, 'seq': self.sequence}
            event.setdefault('protocol', 'http')
            event.setdefault('direction', 'TX')
            event.setdefault('stage', 'response')
            event.setdefault('ok', event.get('received', False))
            event.setdefault('severity', 'error' if not event['ok'] else 'warning' if event['protocol']=='http' and event.get('status') not in ('transitioned', 'queued') else 'info')
            self.events.appendleft(event)
            return deepcopy(event)

    def activity(self, after=0):
        with self.lock:
            updates = [deepcopy(e) for e in self.events if e['seq'] > after]
            return {'events': updates[:200], 'cursor': self.sequence, 'generation': self.generation,
                    'skipped': max(0, self.sequence-after-len(updates[:200]))}

    def snapshot(self):
        with self.lock:
            return deepcopy(self.data)

    def save(self, raw):
        validated = validate_workspace(raw)
        with self.lock:
            if self.load_failed:
                raise ValueError(self.warning)
            self.file.parent.mkdir(parents=True, exist_ok=True)
            temp = self.file.with_suffix('.tmp')
            temp.write_text(json.dumps(validated, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
            os.replace(temp, self.file)
            self.data = validated
        return self.snapshot()

    def find_target(self, target_id):
        with self.lock:
            result = next((item for item in self.data['targets'] if item['id'] == target_id), None)
            if result is None:
                raise ValueError("Choose a saved target first.")
            return deepcopy(result)

    def import_scene(self, document):
        incoming = scene_signals(document)
        with self.lock:
            workspace = self.snapshot()
            known = {item['key'] for item in workspace['signals']}
            added = [item for item in incoming if item['key'] not in known]
            workspace['signals'].extend(added)
            self.save(workspace)
        return {'workspace': self.snapshot(), 'added': len(added), 'skipped': len(incoming)-len(added)}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def endpoint(item, route):
    host = f"[{item['host']}]" if ':' in item['host'] else item['host']
    return f"http://{host}:{item['port']}/{route}"


def request_receiver(item, route, payload=None):
    encoded = None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
    req = urllib.request.Request(endpoint(item, route), data=encoded, headers={'Content-Type': 'application/json'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=3 if route == 'health' else 5) as res:
        if res.headers.get_content_type() != 'application/json':
            raise ValueError("The target returned something other than a Signal receiver response.")
        body = res.read(65537)
        if len(body) > 65536:
            raise ValueError("Receiver response is too large.")
        data = json.loads(body)
        if not isinstance(data, dict) or data.get('ok') is not True:
            raise ValueError("The receiver did not acknowledge this request.")
        if route == 'health' and data.get('service') != 'SceneCast Signal':
            raise ValueError("This port is responding, but it is not a Player Signal receiver.")
        if route == 'signal' and (not isinstance(data.get('status'), str) or data['status'] not in STATUS):
            raise ValueError(f"The receiver returned an unrecognized Signal result: {str(data.get('status'))[:120]}. Check Player and Tester versions.")
        return data


def failure(error):
    if isinstance(error, urllib.error.HTTPError):
        try:
            detail = json.loads(error.read(8192)).get('error', '')
        except (ValueError, AttributeError):
            detail = str(error.reason)
        return 'http_error', f"HTTP {error.code}", str(detail)[:500]
    reason = getattr(error, 'reason', error)
    if isinstance(reason, TimeoutError):
        return 'timeout', 'Request timed out', 'Check the target address and receiver. No automatic retry was sent.'
    if isinstance(error, (urllib.error.URLError, OSError)):
        return 'connection_error', 'Cannot reach receiver', 'Open Player > Signals, enable the receiver and check the IP and port.'
    return 'invalid_response', 'Unexpected response', str(error)[:500]


def perform_send(store, body, target_snapshot=None):
    item = deepcopy(target_snapshot) if target_snapshot is not None else store.find_target(body.get('targetId'))
    if item.get('type', 'http') != 'http':
        raise ValueError('Select an HTTP Signal target, or use the Serial / UDP data sender.')
    key, value = signal_key(body.get('key')), validate_value(body.get('value'))
    started = time.monotonic()
    result = {'id': uid(), 'time': time.time()*1000, 'target': item, 'key': key, 'value': value, 'received': False}
    if body.get('origin'):
        result['origin'] = label(body['origin'], 'Send origin', 160)
    with store.lock:
        definition = next((s for s in store.data['signals'] if s['key'] == key), None)
        cooldown = definition.get('cooldown', 3) if definition else 3
        now = time.monotonic()
        remaining = cooldown - (now - store.last_signal_sends.get(key, float('-inf')))
        if remaining > 0:
            result.update(status='cooldown', label='Signal cooldown', detail=f'Not sent. Try again in {remaining:.1f}s.',
                          stage='cooldown', severity='warning', remaining=remaining, elapsed=0)
            return store.emit(result)
        # Reserve before network I/O so simultaneous sources share one limit.
        store.last_signal_sends[key] = now
    try:
        response = request_receiver(item, 'signal', {'key': key, 'value': value})
        result.update(status=response['status'], received=True, response=response)
        result['label'], result['detail'] = STATUS[response['status']]
    except (urllib.error.URLError, OSError, ValueError) as error:
        result['status'], result['label'], result['detail'] = failure(error)
    result['elapsed'] = round((time.monotonic()-started)*1000)
    return store.emit(result)


DASHBOARD_ORIGIN = 'https://dashboard.3dowon.com'


def create_server(store, port=0, io_factory=TransportHub, instance_id=None, dashboard=False):
    token = secrets.token_urlsafe(32)
    sensors = SensorEngine(store.emit, lambda body: perform_send(store, body, body.get('_target')))
    sensors.configure(store.snapshot())
    def io_event(event):
        sensors.connection_event(event)
        return store.emit(event)
    hub = io_factory(io_event)
    hub.on_data = sensors.feed
    operation_lock = threading.RLock()
    stopping = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(8)

        def log_message(self, *_):
            pass

        def reply(self, code, data, content_type='application/json; charset=utf-8'):
            payload = json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8') if not isinstance(data, bytes) else data
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if dashboard and self.headers.get('Origin') == DASHBOARD_ORIGIN:
                self.send_header('Access-Control-Allow-Origin', DASHBOARD_ORIGIN)
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Tester-Token')
                self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def allowed(self, api=False):
            host = self.headers.get('Host', '')
            allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
            origin = self.headers.get('Origin')
            trusted = not origin or origin == 'http://'+host or (api and dashboard and origin == DASHBOARD_ORIGIN)
            return (host in allowed and trusted
                    and (not api or secrets.compare_digest(self.headers.get('X-Tester-Token', ''), token)))

        def do_OPTIONS(self):
            host = self.headers.get('Host', '')
            headers = {h.strip().lower() for h in self.headers.get('Access-Control-Request-Headers', '').split(',') if h.strip()}
            if (not dashboard or self.headers.get('Origin') != DASHBOARD_ORIGIN
                    or host not in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
                    or not self.path.startswith('/api/')
                    or self.headers.get('Access-Control-Request-Method') not in ('GET', 'POST')
                    or not headers.issubset({'content-type', 'x-tester-token'})):
                return self.reply(403, {'error': 'Origin or request denied.'})
            self.reply(204, b'')

        def do_GET(self):
            if not self.allowed(self.path.startswith('/api/')):
                return self.reply(403, {'error': 'Open this tester from its local launch address.'})
            route = urlsplit(self.path)
            if route.path == '/api/state':
                with store.lock:
                    data = {'workspace': store.snapshot(), 'events': list(store.events), 'warning': store.warning,
                            'cursor': store.sequence, 'generation': store.generation}
                data.update(connections=hub.snapshot(data['workspace']['targets']), serial=hub.port_state(), sensors=sensors.snapshot())
                return self.reply(200, data)
            if route.path == '/api/live':
                try:
                    after = max(0, int(parse_qs(route.query).get('after', ['0'])[0]))
                except ValueError:
                    return self.reply(400, {'error': 'Invalid log cursor.'})
                data = store.activity(after)
                data.update(connections=hub.snapshot(store.snapshot()['targets']), serial=hub.port_state(), sensors=sensors.snapshot(parse_qs(route.query).get('monitor', [None])[0]))
                return self.reply(200, data)
            assets = {'/sensors.js': ('sensors.js', 'text/javascript; charset=utf-8'), '/keyboard.js': ('keyboard.js', 'text/javascript; charset=utf-8'), '/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/io.js': ('io.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
            if self.path not in assets:
                return self.reply(404, {'error': 'Not found.'})
            name, mime = assets[self.path]
            data = (BASE/'signal_tester_ui'/name).read_bytes()
            if name == 'index.html':
                data = data.replace(b'__TESTER_TOKEN__', token.encode('ascii'))
            self.reply(200, data, mime)

        def do_POST(self):
            if not self.allowed(True):
                return self.reply(403, {'error': 'Open this tester from its local launch address.'})
            if stopping.is_set():
                return self.reply(503, {'error': 'Tester is restarting. Use the newly opened page.'})
            try:
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Send JSON.')
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 5_000_000:
                    raise ValueError('Request must be smaller than 5 MB.')
                self.connection.settimeout(8)
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Expected a JSON object.')
                if stopping.is_set():
                    return self.reply(503, {'error': 'Tester is restarting. Use the newly opened page.'})
                if self.path == '/api/shutdown':
                    if not instance_id or body.get('instance') != instance_id:
                        return self.reply(403, {'error': 'Only this Tester launcher can request a restart.'})
                    with operation_lock:
                        stopping.set()
                        sensors.arm(False)
                    self.reply(200, {'ok': True})
                    threading.Thread(target=self.server.shutdown, daemon=True, name='tester-shutdown').start()
                    return
                if self.path == '/api/workspace':
                    with operation_lock:
                        saved = store.save(body)
                        sensors.configure(saved)
                        hub.reconcile(saved['targets'])
                    return self.reply(200, {'workspace': saved, 'connections': hub.snapshot(saved['targets']), 'sensors': sensors.snapshot()})
                if self.path == '/api/sensors/arm':
                    with operation_lock:
                        sensors.arm(body.get('enabled'))
                    return self.reply(200, {'sensors': sensors.snapshot()})
                if self.path == '/api/sensors/preset':
                    with operation_lock:
                        with store.lock:
                            merged, added = add_sensor_preset(store.snapshot(), body.get('preset'))
                            saved = store.save(merged)
                        # Even an idempotent preset action leaves automation paused.
                        sensors.arm(False)
                        sensors.configure(saved)
                        hub.reconcile(saved['targets'])
                    return self.reply(200, {'workspace': saved, 'added': added,
                        'connections': hub.snapshot(saved['targets']), 'sensors': sensors.snapshot()})
                if self.path == '/api/import-scene':
                    with operation_lock:
                        result = store.import_scene(body)
                        sensors.configure(result['workspace'])
                    return self.reply(200, result)
                if self.path == '/api/send':
                    return self.reply(200, perform_send(store, body))
                if self.path == '/api/ports':
                    return self.reply(200, hub.scan())
                if self.path in ('/api/io/open', '/api/io/close', '/api/io/send'):
                    with operation_lock:
                        item = store.find_target(body.get('targetId'))
                        if item.get('type', 'http') == 'http':
                            raise ValueError('Choose a Serial or UDP connection.')
                        if self.path == '/api/io/open':
                            hub.open(item)
                        elif self.path == '/api/io/close':
                            hub.disconnect(item['id'])
                        else:
                            return self.reply(200, hub.send(item, body))
                    return self.reply(200, {'connections': hub.snapshot(store.snapshot()['targets'])})
                if self.path == '/api/health':
                    item = store.find_target(body.get('targetId'))
                    if item.get('type', 'http') != 'http':
                        raise ValueError('Health checks apply to HTTP Signal receivers. Open Serial / UDP to check their local connection.')
                    started = time.monotonic()
                    try:
                        response = request_receiver(item, 'health')
                        return self.reply(200, {'targetId': item['id'], 'online': True, 'elapsed': round((time.monotonic()-started)*1000), 'detail': 'Signal receiver is ready.'})
                    except (urllib.error.URLError, OSError, ValueError) as error:
                        _, title, detail = failure(error)
                        return self.reply(200, {'targetId': item['id'], 'online': False, 'detail': title+'. '+detail})
                if self.path == '/api/clear':
                    with store.lock:
                        store.events.clear()
                        store.generation += 1
                        cleared = {'ok': True, 'generation': store.generation, 'cursor': store.sequence}
                    return self.reply(200, cleared)
                self.reply(404, {'error': 'Not found.'})
            except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as error:
                self.reply(400, {'error': str(error) or 'Invalid request.'})
            except OSError:
                self.reply(500, {'error': 'Could not save the workspace. Check file permissions and free disk space.'})

    class TesterServer(ThreadingHTTPServer):
        def server_close(self):
            stopping.set()
            sensors.arm(False)
            super().server_close()
            # An in-flight request may have opened a port or armed rules. Clean up
            # after all handlers finish so none can reopen them during shutdown.
            sensors.arm(False)
            hub.close()
            sensors.close()

    server = TesterServer(('127.0.0.1', port), Handler)
    # Wait for in-flight requests before releasing the instance to the next launcher.
    # Handler sockets time out, so an idle browser cannot hold restart indefinitely.
    server.daemon_threads = False
    server.token = token
    server.hub = hub
    server.sensors = sensors
    hub.start()
    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--dashboard', action='store_true', help='Allow the Dowon dashboard to connect with a per-run pairing code.')
    parser.add_argument('--ui-port', type=int, default=0, help='Local web UI port (0 chooses a free port).')
    parser.add_argument('--port', type=int, help='Add/select a receiver port.')
    parser.add_argument('--host', help='Add/select a receiver IP / hostname.')
    parser.add_argument('--key', help='Add a Signal key.')
    parser.add_argument('--scene', type=Path, help='Import Signals from this .scene.')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args(argv)
    config = args.config or Path(os.getenv('LOCALAPPDATA') or Path.home()/'.config')/'SignalTester'/('dashboard-workspace.json' if args.dashboard else 'workspace.json')
    store = Store(config)
    if args.host or args.port:
        data = store.snapshot()
        host, port = normalize_host(args.host or '127.0.0.1'), args.port or 8420
        item = next((t for t in data['targets'] if t.get('type', 'http')=='http' and t['host']==host and t['port']==port), None)
        if item is None:
            item = target({'id': uid(), 'name': 'Player '+str(port), 'host': host, 'port': port})
            data['targets'].append(item)
        data['activeTarget'] = item['id']; store.save(data)
    if args.key:
        data = store.snapshot(); key = signal_key(args.key)
        if not any(s['key'] == key for s in data['signals']):
            data['signals'].append({'id': uid(), 'name': key, 'key': key, 'value': None}); store.save(data)
    if args.scene:
        store.import_scene(json.loads(args.scene.read_text(encoding='utf-8-sig')))
    server = create_server(store, args.ui_port, instance_id=os.environ.get('SIGNAL_TESTER_INSTANCE_ID'), dashboard=args.dashboard)
    url = f'http://127.0.0.1:{server.server_port}/'
    try:
        publish_instance(server)
        print(f'Signal Tester: {url}\nWorkspace: {store.file}\nKeep this window open. Ctrl+C stops the tester.', flush=True)
        if args.dashboard:
            print(f'\nDashboard pairing code (paste into Signal Tester):\n{server.server_port}:{server.token}\n', flush=True)
        if not args.no_browser:
            webbrowser.open(DASHBOARD_ORIGIN+'/#signaltester' if args.dashboard else url)
        server.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        clear_instance()


if __name__ == '__main__':
    main()
