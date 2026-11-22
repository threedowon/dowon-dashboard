"""Local-first settings backup. Never uploads activity or opens restored device ports."""
import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser

API = 'https://api.3dowon.com'


def open_login_browser(url):
    # External browsers must not inherit PyInstaller's bundled DLL search path.
    if os.name == 'nt' and getattr(sys, 'frozen', False):
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.SetDllDirectoryW.argtypes = [wintypes.LPCWSTR]
        kernel.SetDllDirectoryW(None)
        try:
            return webbrowser.open(url)
        finally:
            kernel.SetDllDirectoryW(sys._MEIPASS)
    return webbrowser.open(url)


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def protect(data, decrypt=False):
    """DPAPI binds the credential to the current Windows user, never to exported settings."""
    if os.name != 'nt':
        raise OSError('Automatic backup credentials require Windows.')
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_byte))]
    source = ctypes.create_string_buffer(data)
    incoming, outgoing = Blob(len(data), ctypes.cast(source, ctypes.POINTER(ctypes.c_byte))), Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise ctypes.WinError(ctypes.get_last_error())
    kernel = ctypes.WinDLL('kernel32')
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        kernel.LocalFree(outgoing.data)


def atomic(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(file.name+'.'+uuid.uuid4().hex+'.tmp')
    temporary.write_bytes(data)
    os.replace(temporary, file)


class CloudError(ValueError):
    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


class CloudSync:
    def __init__(self, store, root=None, transport=None, cipher=protect, browser=open_login_browser):
        self.store, self.cipher, self.browser = store, cipher, browser
        root = Path(root or Path(os.environ['LOCALAPPDATA'])/'SignalTester'/'cloud')
        key = hashlib.sha256(os.path.normcase(str(store.file.resolve())).encode()).hexdigest()[:24]
        self.file, self.secret_file = root/(key+'.json'), root/(key+'.credential')
        self.meta = {'version': 1, 'device': uuid.uuid4().hex, 'name': socket.gethostname()[:80], 'sha': None, 'digest': None, 'updatedAt': None}
        self.credential, self.error, self.login, self.auth_expired, self.pending = '', '', '', False, None
        try:
            data = json.loads(self.file.read_text(encoding='utf-8'))
            if data.get('version') == 1 and len(data.get('device', '')) == 32:
                self.meta.update(data)
                self.credential = self.cipher(self.secret_file.read_bytes(), decrypt=True).decode()
                self.login = self.meta.get('login', '')
        except (OSError, ValueError, UnicodeError):
            pass
        self.transport = transport or self._http
        self.lock = threading.RLock()
        self.operation = threading.Lock()
        self.stop = threading.Event()
        self.thread = None
        self.busy = False
        self.conflict = False
        self.observed, self.changed_at = fingerprint(store.snapshot()), time.monotonic()

    def persist(self):
        atomic(self.file, json.dumps(self.meta, ensure_ascii=False).encode('utf-8'))

    def _http(self, route, body=None, credential=None):
        request = urllib.request.Request(API+'/native/signal-tester/'+route,
            data=None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8'),
            headers={'Accept': 'application/json', 'User-Agent': 'SignalTester/1.1 (+https://github.com/threedowon/dowon-dashboard)', **({'Content-Type': 'application/json'} if body is not None else {}),
                     **({'Authorization': 'Bearer '+credential} if credential else {})})
        try:
            with urllib.request.urlopen(request, timeout=4 if self.stop.is_set() else 12) as response:
                raw = response.read(1100000)
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read(8192)).get('error', '백업 요청에 실패했습니다.')
            except (ValueError, OSError):
                message = '백업 요청에 실패했습니다.'
            finally:
                error.close()
            raise CloudError(message, error.code) from None
        except OSError:
            raise CloudError('인터넷 연결 후 자동으로 다시 백업합니다.') from None
        return json.loads(raw)

    def request(self, route, body=None):
        if not self.credential or self.auth_expired:
            raise CloudError('대시보드 계정을 연결하세요.', 401)
        try:
            return self.transport(route, body, self.credential)
        except CloudError as error:
            if error.status == 401:
                self.auth_expired = True
            raise

    def status(self):
        with self.lock:
            dirty = fingerprint(self.store.snapshot()) != self.meta.get('digest')
            return {'connected': bool(self.credential) and not self.auth_expired, 'login': self.login,
                    'name': self.meta['name'], 'device': self.meta['device'], 'dirty': dirty,
                    'busy': self.busy, 'conflict': self.conflict, 'error': self.error,
                    'updatedAt': self.meta.get('updatedAt'), 'pendingLogin': bool(self.pending)}

    def connect(self, port, name):
        name = str(name).strip()
        if not name or len(name) > 80:
            raise ValueError('PC 이름은 1~80자로 입력하세요.')
        with self.operation, self.lock:
            verifier, state = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            self.meta['name'] = name
            self.persist()
            self.pending = {'verifier': verifier, 'state': state, 'expires': time.monotonic()+600}
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
            url = API+'/auth/login?'+urllib.parse.urlencode({'app': 'signal-tester', 'port': port,
                'state': state, 'challenge': challenge, 'device': self.meta['device'], 'name': name})
            if not self.browser(url):
                self.pending = None
                raise ValueError('기본 브라우저를 열지 못했습니다. 브라우저 설정을 확인하세요.')
            self.error = ''
        return self.status()

    def finish_login(self, code, state):
        with self.operation:
            with self.lock:
                pending = self.pending
                if not pending or pending['expires'] < time.monotonic() or not secrets.compare_digest(pending['state'], state):
                    raise ValueError('로그인 요청이 만료되었거나 일치하지 않습니다. 프로그램에서 다시 연결하세요.')
                self.pending = None
            result = self.transport('exchange', {'code': code, 'verifier': pending['verifier']}, None)
            if result.get('device') != self.meta['device'] or not isinstance(result.get('credential'), str):
                raise ValueError('로그인 응답이 일치하지 않습니다.')
            encoded = self.cipher(result['credential'].encode())
            atomic(self.secret_file, encoded)
            with self.lock:
                self.credential, self.login = result['credential'], result['login']
                self.meta['login'] = self.login
                self.auth_expired, self.error, self.conflict = False, '', False
                self.persist()
        return self.status()

    def sync(self, force=False):
        if not self.operation.acquire(blocking=False):
            return self.status()
        try:
            if not self.credential or self.auth_expired or self.store.load_failed or (self.conflict and not force):
                return self.status()
            data = self.store.snapshot()
            digest = fingerprint(data)
            if digest == self.meta.get('digest') and not force:
                return self.status()
            self.busy = True
            route = 'backups/'+self.meta['device']
            remote = self.request(route)
            # A lost HTTP response after a successful write must not create a conflict.
            if remote.get('backup') and fingerprint(remote['backup']['data']) == digest and remote['backup'].get('name') == self.meta['name']:
                self.meta.update(sha=remote['sha'], digest=digest, updatedAt=remote['backup']['updatedAt'])
            else:
                if remote['sha'] != self.meta.get('sha') and not force:
                    raise CloudError('기존 백업과 다른 변경이 있습니다. 백업을 확인하거나 이 PC 설정으로 백업하세요.', 409)
                saved = self.request(route, {'name': self.meta['name'], 'data': data, 'sha': remote['sha']})
                self.meta.update(sha=saved['sha'], digest=digest, updatedAt=saved['updatedAt'])
            self.persist()
            self.error, self.conflict = '', False
        except (OSError, ValueError) as error:
            self.error = str(error)
            if getattr(error, 'status', 0) == 409:
                self.conflict = True
        finally:
            self.busy = False
            self.operation.release()
        return self.status()

    def backups(self):
        with self.operation:
            return self.request('backups')

    def download(self, identity):
        if not isinstance(identity, str) or len(identity) != 32 or any(c not in '0123456789abcdef' for c in identity):
            raise ValueError('백업을 선택하세요.')
        with self.operation:
            result = self.request('backups/'+identity)
            if not result.get('backup'):
                raise ValueError('백업을 찾을 수 없습니다.')
            return result['backup']['data']

    def disconnect(self):
        with self.operation:
            # If offline, preserve the credential so revocation can be retried explicitly.
            if self.credential:
                self.transport('disconnect', {}, self.credential)
            self.secret_file.unlink(missing_ok=True)
            self.credential, self.login, self.pending = '', '', None
            self.meta['login'] = ''
            self.error, self.conflict, self.auth_expired = '', False, False
            self.persist()
        return self.status()

    def start(self):
        def run():
            retry_at = 0
            while not self.stop.wait(1):
                current = fingerprint(self.store.snapshot())
                if current != self.observed:
                    self.observed, self.changed_at = current, time.monotonic()
                if time.monotonic()-self.changed_at >= 3 and time.monotonic() >= retry_at:
                    self.sync()
                    retry_at = time.monotonic()+(30 if self.error else 3)
        self.thread = threading.Thread(target=run, daemon=True, name='settings-backup')
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=13)
        # A final bounded attempt covers closing the window during the debounce.
        # Offline changes remain in the workspace and retry on the next launch.
        self.sync()
