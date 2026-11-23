"""Development bootstrap and protection against two writers using one workspace."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import venv

ROOT = Path(__file__).resolve().parent


def restart_web(config, port):
    """Run the fixed source launcher; never execute a command supplied by the UI."""
    if os.name != 'nt':
        raise RuntimeError('Web restart currently requires Windows.')
    log = Path(os.environ['LOCALAPPDATA'])/'SignalTester/logs/web-dev.log'
    log.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    for key in ('SIGNAL_TESTER_INSTANCE_FILE', 'SIGNAL_TESTER_INSTANCE_ID'):
        env.pop(key, None)
    with log.open('ab') as output:
        subprocess.Popen([sys.executable, str(ROOT/'tester_web_dev.py'), '--no-browser',
                          '--config', str(Path(config).resolve()), '--ui-port', str(port)],
                         cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                         creationflags=subprocess.CREATE_NO_WINDOW)


def check_workspace_in_use(config):
    """Older EXEs expose a stable cloud device ID; newer engines publish the path."""
    if os.name != 'nt':
        return
    root = Path(os.environ['LOCALAPPDATA'])/'SignalTester'
    config = os.path.normcase(str(Path(config).resolve()))
    key = hashlib.sha256(config.encode()).hexdigest()[:24]
    try:
        device = json.loads((root/'cloud'/(key+'.json')).read_text(encoding='utf-8')).get('device')
    except (OSError, ValueError):
        device = None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for file in (root/'instances').glob('*.json'):
        try:
            record = json.loads(file.read_text(encoding='utf-8'))
            if record.get('pid') == os.getpid():
                continue
            req = urllib.request.Request(f"http://127.0.0.1:{int(record['port'])}/api/cloud/status",
                                          headers={'X-Tester-Token': record['token']})
            with opener.open(req, timeout=1) as response:
                status = json.load(response)
            same_path = record.get('config') and os.path.normcase(str(Path(record['config']).resolve())) == config
            same_device = device and (status.get('cloud') or {}).get('device') == device
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if same_path or same_device:
            raise RuntimeError('This workspace is already open in Signal Tester. Use its Exit button first, then start web development again. Settings are kept.')


def bootstrap():
    if sys.version_info < (3, 10):
        raise SystemExit('Python 3.10 or newer is required.')
    environment = ROOT/'.dev-venv'
    python = environment/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    probe = "import importlib.metadata as m; assert m.version('pyserial')=='3.5'; assert m.version('Markdown')=='3.7'"
    def ready(executable):
        return subprocess.run([str(executable), '-c', probe], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if sys.prefix != sys.base_prefix and ready(sys.executable):
        python = Path(sys.executable)
    elif not python.exists():
        print('Preparing the web development environment...', flush=True)
        venv.EnvBuilder(with_pip=True).create(environment)
    if not ready(python):
        subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT/'requirements-dev.txt')], check=True)
    subprocess.run([str(python), str(ROOT/'build_guide.py')], check=True)
    entry = 'tester_launcher.py' if os.name == 'nt' else 'signal_tester.py'
    return subprocess.call([str(python), str(ROOT/entry), '--web-dev', *sys.argv[1:]], cwd=ROOT)


if __name__ == '__main__':
    raise SystemExit(bootstrap())
