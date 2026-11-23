"""Windows launcher: replace this installation's Tester, then wait for its exit."""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import uuid

BASE = Path(__file__).resolve().parent


def installation_id(base):
    return hashlib.sha256(os.path.normcase(str(Path(base).resolve())).encode('utf-8')).hexdigest()[:24]


def instance_file(base):
    return Path(os.environ['LOCALAPPDATA'])/'SignalTester'/'instances'/(installation_id(base)+'.json')


def read_instance(file):
    try:
        data = json.loads(Path(file).read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def publish_instance(server):
    """Publish only after the socket is bound and the server can accept shutdown."""
    filename = os.environ.get('SIGNAL_TESTER_INSTANCE_FILE')
    identity = os.environ.get('SIGNAL_TESTER_INSTANCE_ID')
    if not filename or not identity:
        return
    file = Path(filename)
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_name(file.name+'.'+identity+'.tmp')
    temp.write_text(json.dumps({'pid': os.getpid(), 'instance': identity,
                               'port': server.server_port, 'token': server.token,
                               'config': getattr(server, 'config', None)}), encoding='utf-8')
    os.replace(temp, file)


def clear_instance():
    filename = os.environ.get('SIGNAL_TESTER_INSTANCE_FILE')
    identity = os.environ.get('SIGNAL_TESTER_INSTANCE_ID')
    if filename and read_instance(filename).get('instance') == identity:
        Path(filename).unlink(missing_ok=True)


def tester_command(argv, base=BASE, executable=None):
    """Match an absolute entry script, never a substring or a script passed as data."""
    if len(argv) < 2:
        return False
    if executable is not None:
        return (Path(argv[0]).is_absolute()
                and os.path.normcase(str(Path(argv[0]).resolve())) == os.path.normcase(str(executable.resolve()))
                and argv[1] == '--tester-engine')
    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg in ('-W', '-X', '--check-hash-based-pycs'):
            i += 2
        elif arg in ('-u', '-B', '-E', '-I', '-O', '-OO', '-s', '-S', '-q', '-v', '-x') or arg.startswith(('-W', '-X')):
            i += 1
        else:
            break
    if i >= len(argv) or not Path(argv[i]).is_absolute():
        return False
    script = os.path.normcase(str(Path(argv[i]).resolve()))
    if script == os.path.normcase(str(Path(base, 'signal_tester.py').resolve())):
        return True
    # The old command-line bridge also has sensor/key modes; only its web panel is ours.
    if script == os.path.normcase(str(Path(base, 'scenecast_tester.py').resolve())):
        rest = argv[i+1:]
        return not rest or rest[0] == 'panel'
    return False


def split_command(command):
    shell = ctypes.WinDLL('shell32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    shell.CommandLineToArgvW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    shell.CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)
    kernel.LocalFree.argtypes = [wintypes.HLOCAL]
    count = ctypes.c_int()
    args = shell.CommandLineToArgvW(command, ctypes.byref(count))
    if not args:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return [args[i] for i in range(count.value)]
    finally:
        kernel.LocalFree(ctypes.cast(args, wintypes.HLOCAL))


def discover_testers(base=BASE, executable=None):
    # Query metadata only. Process handles below recheck creation time against PID reuse.
    command = """$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python(w|[0-9.]+)?\\.exe$' -and $_.CommandLine } | ForEach-Object {
  @{pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId; command=$_.CommandLine; created=$_.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString()}
}) | ConvertTo-Json -Compress"""
    if executable is not None:
        name = executable.name.replace("'", "''")
        command = command.replace("$_.Name -match '^python(w|[0-9.]+)?\\.exe$'", f"$_.Name -eq '{name}'")
    powershell = Path(os.environ['SystemRoot'])/'System32'/'WindowsPowerShell'/'v1.0'/'powershell.exe'
    result = subprocess.run([str(powershell), '-NoProfile', '-NonInteractive', '-Command', command],
                            capture_output=True, encoding='utf-8', errors='replace', timeout=15,
                            creationflags=subprocess.CREATE_NO_WINDOW, check=True)
    records = json.loads(result.stdout.lstrip('\ufeff').strip() or '[]')
    if isinstance(records, dict):
        records = [records]
    return engine_processes(records, base, executable)


def engine_processes(records, base=BASE, executable=None):
    """Exclude Windows venv redirectors waiting on the real interpreter."""
    matches, arguments = {}, {}
    for record in records:
        argv = split_command(record['command'])
        if record['pid'] != os.getpid() and tester_command(argv, base, executable):
            matches[record['pid']] = record
            arguments[record['pid']] = argv[1:]
    redirectors = set()
    for record in matches.values():
        parent = record.get('parent')
        if parent in matches and arguments[parent] == arguments[record['pid']]:
            redirectors.add(parent)
    return [r for pid, r in matches.items() if pid not in redirectors]


class WindowsHandles:
    def __init__(self):
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        for name, args, result in [
            ('CreateMutexW', [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE),
            ('OpenProcess', [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
            ('WaitForSingleObject', [wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
            ('ReleaseMutex', [wintypes.HANDLE], wintypes.BOOL),
            ('CloseHandle', [wintypes.HANDLE], wintypes.BOOL),
            ('TerminateProcess', [wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
            ('GetProcessTimes', [wintypes.HANDLE]+[ctypes.POINTER(wintypes.FILETIME)]*4, wintypes.BOOL),
        ]:
            function = getattr(self.kernel, name)
            function.argtypes, function.restype = args, result


class LaunchLock(WindowsHandles):
    def __init__(self, base=BASE):
        super().__init__()
        self.handle = self.kernel.CreateMutexW(None, False, 'Local\\SignalTester-'+installation_id(base))
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())

    def __enter__(self):
        result = self.kernel.WaitForSingleObject(self.handle, 30000)
        if result not in (0, 0x80):  # Also recover a mutex abandoned by a crashed launcher.
            self.kernel.CloseHandle(self.handle)
            raise RuntimeError('Another Tester restart is still running. Try again shortly.')
        return self

    def __exit__(self, *_):
        self.kernel.ReleaseMutex(self.handle)
        self.kernel.CloseHandle(self.handle)


class TesterProcess(WindowsHandles):
    def __init__(self, record):
        super().__init__()
        self.pid, self.handle = record['pid'], None
        handle = self.kernel.OpenProcess(0x1000 | 0x100000 | 0x0001, False, self.pid)
        if not handle:
            if ctypes.get_last_error() == 87:  # It already exited.
                return
            raise ctypes.WinError(ctypes.get_last_error())
        times = [wintypes.FILETIME() for _ in range(4)]
        if not self.kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
            self.kernel.CloseHandle(handle)
            raise ctypes.WinError(ctypes.get_last_error())
        created = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        # WMI timestamps have microsecond precision; FILETIME has 100 ns precision.
        if created // 10 != int(record['created']) // 10:
            self.kernel.CloseHandle(handle)
            return
        self.handle = handle

    def wait(self, seconds=0):
        return not self.handle or self.kernel.WaitForSingleObject(self.handle, int(seconds*1000)) == 0

    def stop(self, state):
        try:
            if self.wait():
                return
            if state.get('pid') == self.pid and isinstance(state.get('port'), int) and 1 <= state['port'] <= 65535:
                try:
                    request = urllib.request.Request(f"http://127.0.0.1:{state['port']}/api/shutdown",
                        data=json.dumps({'instance': state.get('instance')}).encode(),
                        headers={'Content-Type': 'application/json', 'X-Tester-Token': state.get('token', '')})
                    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=3) as response:
                        accepted = json.load(response).get('ok') is True
                    if accepted and self.wait(15):
                        print('Previous Tester closed its connections.', flush=True)
                        return
                except (OSError, ValueError, TypeError):
                    pass
            print(f'Stopping older or unresponsive Tester (PID {self.pid})...', flush=True)
            # Exit code 0 lets its old CMD window finish instead of stopping at "pause".
            if not self.kernel.TerminateProcess(self.handle, 0) and not self.wait():
                raise ctypes.WinError(ctypes.get_last_error())
            if not self.wait(5):
                raise RuntimeError('Previous Tester has not exited. No second instance was started.')
        finally:
            if self.handle:
                self.kernel.CloseHandle(self.handle)
                self.handle = None


def launch(argv, base=BASE, executable=None):
    if os.name != 'nt':
        raise RuntimeError('Use python signal_tester.py directly on this operating system.')
    command = ([str(executable), '--tester-engine', *argv] if executable is not None
               else [sys.executable, '-u', str(base/'signal_tester.py'), *argv])
    if '-h' in argv or '--help' in argv:
        return subprocess.call(command)
    file, identity, child = instance_file(base), uuid.uuid4().hex, None
    with LaunchLock(base):
        previous = read_instance(file)
        for record in discover_testers(base, executable):
            TesterProcess(record).stop(previous)
        env = dict(os.environ, SIGNAL_TESTER_INSTANCE_FILE=str(file), SIGNAL_TESTER_INSTANCE_ID=identity)
        child = subprocess.Popen(command, cwd=executable.parent if executable is not None else base, env=env)
        deadline = time.monotonic()+20
        try:
            while read_instance(file).get('instance') != identity:
                if child.poll() is not None:
                    return child.returncode
                if time.monotonic() >= deadline:
                    raise RuntimeError('Tester did not finish starting. Check the error above and try again.')
                time.sleep(.05)
        except BaseException:
            if child.poll() is None:
                child.terminate()
                child.wait(5)
            raise
    try:
        return child.wait()
    except KeyboardInterrupt:
        # Ctrl+C normally also reaches the child; give its finally block time to run.
        try:
            return child.wait(15)
        except subprocess.TimeoutExpired:
            child.terminate()
            child.wait(5)
            return 0


def main():
    try:
        return launch(sys.argv[1:])
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'Could not restart Signal Tester: {error}', file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
