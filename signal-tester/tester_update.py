"""Opt-in Windows EXE updates. Settings and credentials are never moved or replaced."""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from tester_launcher import LaunchLock, installation_id, instance_file, read_instance
from tester_version import VERSION

REPOSITORY = 'https://github.com/threedowon/dowon-dashboard'
UPDATE_FEED = REPOSITORY+'/releases/latest/download/update.json'
MAX_EXE = 200 * 1024 * 1024
TAG = re.compile(r'^signal-tester-v(\d+)\.(\d+)\.(\d+)$')


def sha256(file):
    digest = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(128*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(file, data):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_name(file.name+'.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, file)


def update_root(executable):
    return Path(os.environ['LOCALAPPDATA'])/'SignalTester'/'updates'/installation_id(executable)


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urllib.parse.urlsplit(newurl)
        if (url.scheme != 'https' or url.username or url.password or url.port not in (None, 443)
                or url.hostname not in {'github.com', 'api.github.com', 'release-assets.githubusercontent.com',
                                        'objects.githubusercontent.com', 'github-releases.githubusercontent.com'}):
            raise ValueError('공식 업데이트 다운로드 주소를 확인하지 못했습니다.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_remote(url):
    return urllib.request.build_opener(SafeRedirect()).open(urllib.request.Request(url, headers={
        'User-Agent': 'SignalTester/'+VERSION, 'Accept': 'application/vnd.github+json'}), timeout=15)


def read_remote(url, limit, opener=open_remote):
    with opener(url) as response:
        data = response.read(limit+1)
    if len(data) > limit:
        raise ValueError('업데이트 정보가 허용 크기를 초과했습니다.')
    return data


def choose_release(releases, current=VERSION):
    if not isinstance(releases, list):
        raise ValueError('업데이트 정보를 확인하지 못했습니다.')
    candidates = []
    for release in releases:
        if not isinstance(release, dict) or release.get('draft') or release.get('prerelease'):
            continue
        match = TAG.fullmatch(release.get('tag_name', ''))
        if not match:
            continue
        version = tuple(map(int, match.groups()))
        if version <= tuple(map(int, current.split('.'))):
            continue
        assets = {a.get('name'): a for a in release.get('assets', []) if isinstance(a, dict)}
        exe, sums = assets.get('SignalTester.exe'), assets.get('SHA256SUMS.txt')
        prefix = REPOSITORY+'/releases/download/'+match[0]+'/'
        if (not exe or not sums or exe.get('browser_download_url') != prefix+'SignalTester.exe'
                or sums.get('browser_download_url') != prefix+'SHA256SUMS.txt'
                or type(exe.get('size')) is not int or not 0 < exe['size'] <= MAX_EXE):
            continue
        candidates.append((version, {'version': '.'.join(map(str, version)), 'url': exe['browser_download_url'],
            'size': exe['size'], 'checksums': sums['browser_download_url'], 'digest': exe.get('digest')}))
    return max(candidates, key=lambda item: item[0])[1] if candidates else None


def download_release(release, destination, stop, progress, opener=open_remote):
    sums = read_remote(release['checksums'], 16384, opener).decode('ascii')
    hashes = re.findall(r'^([a-fA-F0-9]{64})\s+\*?SignalTester\.exe\s*$', sums, re.M)
    if len(hashes) != 1:
        raise ValueError('업데이트 파일의 검증 정보를 찾지 못했습니다.')
    expected = hashes[0].lower()
    if release.get('digest') and release['digest'] != 'sha256:'+expected:
        raise ValueError('업데이트 검증 정보가 일치하지 않습니다.')
    received, digest, deadline = 0, hashlib.sha256(), time.monotonic()+300
    try:
        with opener(release['url']) as response, Path(destination).open('xb') as output:
            while True:
                if stop.is_set() or time.monotonic() > deadline:
                    raise ValueError('업데이트 다운로드가 중단되었습니다. 다시 시도하세요.')
                chunk = response.read(128*1024)
                if not chunk:
                    break
                received += len(chunk)
                if received > release['size'] or received > MAX_EXE:
                    raise ValueError('업데이트 파일 크기가 일치하지 않습니다.')
                output.write(chunk)
                digest.update(chunk)
                progress(round(received*100/release['size']))
            output.flush()
            os.fsync(output.fileno())
        if received != release['size'] or digest.hexdigest() != expected:
            raise ValueError('업데이트 파일 검증에 실패했습니다. 기존 프로그램을 유지합니다.')
        with Path(destination).open('rb') as stream:
            if stream.read(2) != b'MZ':
                raise ValueError('유효한 Windows 실행 파일이 아닙니다.')
        return expected
    except BaseException:
        Path(destination).unlink(missing_ok=True)
        raise


def independent_env():
    env = dict(os.environ, PYINSTALLER_RESET_ENVIRONMENT='1')
    for key in ('SIGNAL_TESTER_INSTANCE_FILE', 'SIGNAL_TESTER_INSTANCE_ID'):
        env.pop(key, None)
    return env


def spawn(command):
    return subprocess.Popen(command, env=independent_env(), cwd=Path(command[0]).parent,
                            creationflags=subprocess.CREATE_NO_WINDOW)


def wait_unlocked(file, timeout=60):
    """Running Windows images cannot be opened for exclusive writing, even if rename works."""
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                                  wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        handle = kernel.CreateFileW(str(file), 0xC0000000, 0, None, 3, 0, None)
        if handle != ctypes.c_void_p(-1).value:
            kernel.CloseHandle(handle)
            return
        time.sleep(.2)
    raise OSError('프로그램 파일이 사용 중이거나 쓰기 권한이 없습니다. 기존 EXE를 유지합니다.')


def wait_started(target, version, previous, process, timeout=45):
    deadline = time.monotonic()+timeout
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.monotonic() < deadline:
        record = read_instance(instance_file(target))
        if record.get('instance') and record['instance'] != previous and record.get('token'):
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{record['port']}/api/update/status",
                                             headers={'X-Tester-Token': record['token']})
                with opener.open(req, timeout=2) as response:
                    status = json.load(response)
                    if status.get('current') == version and status.get('ready'):
                        return True
            except (OSError, ValueError, KeyError):
                pass
        if process.poll() is not None:
            return False
        time.sleep(.2)
    return False


def replace_executable(job, unlock=wait_unlocked):
    """Called with the installation lock held. Leave the old EXE available on any failure."""
    target, staged, backup = (Path(job[k]) for k in ('target', 'staged', 'backup'))
    unlock(target)
    if job.get('cancel') and Path(job['cancel']).exists():
        raise ValueError('업데이트가 취소되었습니다.')
    if sha256(target) != job['originalHash'] or sha256(staged) != job['sha256']:
        raise ValueError('파일이 변경되어 업데이트를 중단했습니다. 다시 확인하세요.')
    os.replace(target, backup)
    try:
        os.replace(staged, target)
    except BaseException:
        os.replace(backup, target)
        raise
    # LaunchLock is released by the caller before the new launcher takes it.
    return backup


def apply_update(manifest):
    file = Path(manifest).resolve()
    job = json.loads(file.read_text(encoding='utf-8'))
    target = Path(job['target']).resolve()
    root = update_root(target).resolve()
    if (file.parent.parent != root or file.name != 'job.json' or target.suffix.lower() != '.exe'
            or Path(job['staged']).parent != target.parent or Path(job['backup']).parent != target.parent
            or Path(job['staged']).name != '.signal-update-'+file.parent.name+'.exe'
            or Path(job['backup']).name != '.signal-previous-'+file.parent.name+'.exe'
            or not re.fullmatch(r'\d+\.\d+\.\d+', job['version'])):
        raise ValueError('Invalid update job')
    result_file = root/'result.json'
    job['cancel'] = str(file.parent/'cancel.json')
    swapped, process = False, None
    try:
        with LaunchLock(target):
            write_json(file.parent/'ready.json', {'ready': True})
            replace_executable(job)
            swapped = True
        write_json(result_file, {'kind': 'pending', 'version': job['version']})
        process = spawn([str(target), *job['args']])
        if not wait_started(target, job['version'], job['instance'], process):
            raise RuntimeError('새 버전 시작을 확인하지 못해 이전 버전으로 복구했습니다.')
        Path(job['backup']).unlink(missing_ok=True)
        write_json(result_file, {'kind': 'success', 'version': job['version']})
    except Exception as error:
        if swapped:
            try:
                # Stop only this installation through the existing guarded shutdown path.
                from tester_launcher import discover_testers, TesterProcess
                for record in discover_testers(target, target):
                    TesterProcess(record).stop(read_instance(instance_file(target)))
                if process:
                    process.wait(timeout=20)
                with LaunchLock(target):
                    wait_unlocked(target)
                    os.replace(Path(job['backup']), target)
            except Exception:
                write_json(result_file, {'kind': 'error', 'message': '자동 복구를 완료하지 못했습니다. 이전 EXE: '+job['backup']})
                return 1
        write_json(result_file, {'kind': 'error', 'message': str(error)})
        if not Path(job['cancel']).exists() and not read_instance(instance_file(target)):
            spawn([str(target), *job['args']])
        return 1
    finally:
        Path(job['staged']).unlink(missing_ok=True)
        write_json(file.parent/'complete.json', {'complete': True})
    return 0


class Updater:
    def __init__(self, executable=None, restart_args=None, current=VERSION, opener=open_remote, launch=spawn):
        self.executable = Path(executable).resolve() if executable else None
        self.enabled = bool(self.executable)
        self.current, self.opener, self.launch = current, opener, launch
        self.restart_args = restart_args or []
        self.root = update_root(self.executable) if self.enabled else None
        self.phase, self.error, self.release, self.progress = 'idle', '', None, 0
        self.lock, self.stop = threading.RLock(), threading.Event()
        self.thread, self.shutdown, self.handoff = None, None, False

    def status(self):
        with self.lock:
            result = read_instance(self.root/'result.json') if self.root else {}
            return {'enabled': self.enabled, 'current': self.current, 'latest': self.release['version'] if self.release else None,
                    'phase': self.phase, 'progress': self.progress, 'error': self.error, 'result': result}

    def start_check(self):
        with self.lock:
            if not self.enabled or self.thread and self.thread.is_alive() or self.handoff:
                return self.status()
            self.phase, self.error = 'checking', ''
            def check():
                try:
                    manifest = json.loads(read_remote(UPDATE_FEED, 16384, self.opener))
                    if not isinstance(manifest, dict) or not TAG.fullmatch(manifest.get('tag_name', '')):
                        raise ValueError('Invalid release manifest')
                    self.release = choose_release([manifest], self.current)
                    self.phase = 'available' if self.release else 'current'
                except Exception:
                    self.phase, self.error = 'error', '새 버전을 확인하지 못했습니다. 인터넷 연결 후 다시 확인하세요.'
            self.thread = threading.Thread(target=check, daemon=True, name='update-check')
            self.thread.start()
        return self.status()

    def install(self, version):
        with self.lock:
            if (not self.enabled or not self.release or version != self.release['version']
                    or self.thread and self.thread.is_alive() or self.handoff or self.stop.is_set()):
                raise ValueError('새 버전을 다시 확인한 뒤 업데이트하세요.')
            self.phase, self.error, self.progress = 'downloading', '', 0
            release = dict(self.release)
            def run():
                directory = self.root/uuid.uuid4().hex
                staged = self.executable.parent/('.signal-update-'+directory.name+'.exe')
                try:
                    directory.mkdir(parents=True)
                    digest = download_release(release, staged, self.stop,
                        lambda value: setattr(self, 'progress', value), self.opener)
                    if self.stop.is_set():
                        raise ValueError('업데이트가 취소되었습니다.')
                    helper = directory/'updater.exe'
                    shutil.copy2(self.executable, helper)
                    job = {'target': str(self.executable), 'staged': str(staged),
                           'backup': str(self.executable.parent/('.signal-previous-'+directory.name+'.exe')),
                           'sha256': digest, 'originalHash': sha256(self.executable), 'version': release['version'],
                           'args': self.restart_args, 'instance': read_instance(instance_file(self.executable)).get('instance')}
                    write_json(directory/'job.json', job)
                    helper_process = self.launch([str(helper), '--apply-update', str(directory/'job.json')])
                    deadline = time.monotonic()+20
                    while not (directory/'ready.json').exists():
                        if helper_process.poll() is not None or time.monotonic() > deadline or self.stop.wait(.1):
                            raise ValueError('업데이트 도우미를 시작하지 못했습니다. 기존 프로그램을 유지합니다.')
                    self.handoff, self.phase = True, 'restarting'
                    self.shutdown()
                except Exception as error:
                    self.phase, self.error = 'error', str(error) if isinstance(error, ValueError) else '업데이트에 실패했습니다. 파일 권한과 인터넷 연결을 확인하세요. 기존 설정은 유지됩니다.'
                finally:
                    if not self.handoff:
                        write_json(directory/'cancel.json', {'cancelled': True})
                        staged.unlink(missing_ok=True)
            self.thread = threading.Thread(target=run, daemon=True, name='update-download')
            self.thread.start()
        return self.status()

    def close(self):
        self.stop.set()
        if self.thread and self.thread is not threading.current_thread():
            self.thread.join(timeout=16)

    def cleanup(self):
        if not self.root or not self.root.exists():
            return
        for folder in self.root.iterdir():
            if not folder.is_dir() or not re.fullmatch('[a-f0-9]{32}', folder.name) or not (folder/'complete.json').exists():
                continue
            try:
                for name in ('updater.exe', 'job.json', 'ready.json', 'cancel.json', 'complete.json'):
                    (folder/name).unlink(missing_ok=True)
                folder.rmdir()
            except OSError:
                pass
