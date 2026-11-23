"""Windows restart regressions. Only copies in temporary folders are stopped."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

import tester_launcher as launcher


@unittest.skipUnless(os.name == 'nt', 'Windows CMD launcher')
class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tester-launch-test-')
        self.base = Path(self.temp.name)/'isolated tester'
        self.base.mkdir()
        for filename in ('signal_tester.py', 'tester_launcher.py', 'tester_transports.py',
                         'tester_sensors.py', 'tester_presets.py', 'tester_debug.py', 'tester_cloud.py',
                         'tester_web_dev.py', 'tester_version.py', 'build_guide.py', 'requirements-dev.txt',
                         'README.md', 'LOCAL-TESTER.md', 'Start-Signal-Tester.cmd'):
            shutil.copy2(launcher.BASE/filename, self.base/filename)
        shutil.copytree(launcher.BASE/'signal_tester_ui', self.base/'signal_tester_ui')
        shutil.copytree(launcher.BASE/'presets', self.base/'presets')
        shutil.copytree(launcher.BASE/'devices', self.base/'devices', ignore=shutil.ignore_patterns('.pio', '__pycache__'))
        self.config = Path(self.temp.name)/'workspace.json'
        self.env = dict(os.environ, LOCALAPPDATA=self.temp.name, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
        self.env['PATH'] = str(Path(sys.executable).parent)+os.pathsep+self.env.get('PATH', '')
        self.env.pop('SIGNAL_TESTER_INSTANCE_FILE', None)
        self.env.pop('SIGNAL_TESTER_INSTANCE_ID', None)
        self.file = Path(self.temp.name)/'SignalTester'/'instances'/(launcher.installation_id(self.base)+'.json')
        self.processes, self.logs = [], []
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self):
        try:
            state = launcher.read_instance(self.file)
            for record in launcher.discover_testers(self.base):
                launcher.TesterProcess(record).stop(state)
        finally:
            for process in self.processes:
                try:
                    process.wait(8)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(5)
            for log in self.logs:
                log.close()
            # A restart launched from HTTP has independent bootstrap/launcher
            # parents; let them observe the engine exit and release their cwd.
            for attempt in range(50):
                try:
                    self.temp.cleanup()
                    break
                except PermissionError:
                    if attempt == 49:
                        raise
                    time.sleep(.1)

    def start(self, managed=True, cmd=False):
        args = ['--no-browser', '--ui-port', '0', '--config', str(self.config)]
        if cmd:
            command = [os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/c',
                       str(self.base/'Start-Signal-Tester.cmd'), *args]
        else:
            command = [sys.executable, '-u', str(self.base/('tester_launcher.py' if managed else 'signal_tester.py')), *args]
        log = open(Path(self.temp.name)/f'process-{len(self.processes)}.log', 'w+b')
        self.logs.append(log)
        process = subprocess.Popen(command, cwd=self.base, env=self.env, stdout=log, stderr=log,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        self.processes.append(process)
        return process

    def call(self, state, route='state', body=None, token=None):
        request = urllib.request.Request(f"http://127.0.0.1:{state['port']}/api/{route}",
            data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', 'X-Tester-Token': state['token'] if token is None else token})
        with self.opener.open(request, timeout=3) as response:
            return json.load(response)

    def ready(self, old=None, timeout=25):
        deadline = time.monotonic()+timeout
        while time.monotonic() < deadline:
            state = launcher.read_instance(self.file)
            if state.get('pid') and state.get('pid') != old:
                try:
                    self.call(state)
                    return state
                except (OSError, ValueError):
                    pass
            time.sleep(.05)
        logs = []
        for log in self.logs:
            log.seek(0)
            logs.append(log.read().decode('utf-8', 'replace'))
        self.fail('Tester never became ready: '+repr(logs))

    def test_command_match_is_scoped_to_entry_script_and_mode(self):
        python = str(Path(sys.executable))
        main = str(self.base/'signal_tester.py')
        bridge = str(self.base/'scenecast_tester.py')
        for args in ([python, main], [python, '-u', main], [python, '-X', 'utf8', main],
                     [python, main.upper()], [python, bridge], [python, bridge, 'panel']):
            with self.subTest(args=args):
                self.assertTrue(launcher.tester_command(args, self.base))
                self.assertEqual(launcher.split_command(subprocess.list2cmdline(args)), args)
        for args in ([python, 'signal_tester.py'], [python, '-c', main],
                     [python, '-m', 'other', main], [python, str(self.base/'other.py'), main],
                     [python, str(self.base.parent/'other'/'signal_tester.py')],
                     [python, bridge, 'sensor'], [python, bridge, 'keys']):
            with self.subTest(args=args):
                self.assertFalse(launcher.tester_command(args, self.base))

    def test_managed_restart_preserves_workspace_and_releases_udp(self):
        first = self.start(cmd=True)
        previous = self.ready()
        initial = self.call(previous)
        data = initial['workspace']
        data['signals'][0].update(name='Saved person', key='saved_person')
        data['targets'].append({'id':'udp', 'name':'Restart socket', 'type':'udp', 'bindHost':'127.0.0.1',
                                'bindPort':0, 'remoteHost':'127.0.0.1', 'remotePort':9001})
        committed = self.call(previous, 'workspace', {**data, 'revision': initial['revision']})
        saved = committed['workspace']
        opened = self.call(previous, 'io/open', {'targetId':'udp'})['connections']['udp']
        self.assertEqual(opened['status'], 'open')
        udp_port = int(opened['local'].rsplit(':', 1)[1])
        second = self.start(cmd=True)
        current = self.ready(previous['pid'])
        self.assertEqual(first.wait(20), 0)
        self.assertIsNone(second.poll())
        state = self.call(current)
        self.assertEqual(state['workspace'], saved)
        self.assertNotEqual(state['revision'], committed['revision'])
        self.assertEqual(state['connections']['udp']['status'], 'closed')
        self.assertEqual(json.loads(self.config.read_text(encoding='utf-8')), saved)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.bind(('127.0.0.1', udp_port))
        self.assertEqual([r['pid'] for r in launcher.discover_testers(self.base)], [current['pid']])
        self.logs[1].seek(0)
        self.assertIn(b'Previous Tester closed its connections.', self.logs[1].read())

    def test_virtualenv_redirector_is_not_a_second_engine(self):
        script = str(self.base/'signal_tester.py')
        def record(pid, parent, executable, args):
            return dict(pid=pid, parent=parent, command=subprocess.list2cmdline([executable, *args]))
        wrapper = record(101, 100, r'C:\venv\Scripts\python.exe', ['-u', script])
        engine = record(102, 101, r'C:\Python\python.exe', ['-u', script])
        other = record(103, 100, r'C:\Python\python.exe', ['-u', script])
        unrelated = record(104, 100, r'C:\Python\python.exe', ['-c', 'pass', script])
        self.assertEqual(launcher.engine_processes([wrapper, engine, other, unrelated], self.base), [engine, other])
        self.assertEqual(launcher.engine_processes([wrapper, other], self.base), [wrapper, other])

    def test_web_button_restarts_on_same_port_preserving_settings_and_closing_connections(self):
        first = self.start(cmd=True)
        previous = self.ready()
        initial = self.call(previous)
        data = initial['workspace']
        data['signals'][0]['name'] = 'Saved before web restart'
        data['targets'].append({'id':'udp', 'name':'Restart socket', 'type':'udp', 'bindHost':'127.0.0.1',
                                'bindPort':0, 'remoteHost':'127.0.0.1', 'remotePort':9001})
        saved = self.call(previous, 'workspace', {**data, 'revision':initial['revision']})['workspace']
        opened = self.call(previous, 'io/open', {'targetId':'udp'})['connections']['udp']
        udp_port = int(opened['local'].rsplit(':', 1)[1])
        self.assertTrue(self.call(previous, 'cloud/status')['webRestart'])
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call(previous, 'web/restart', {}, token='wrong')
        self.assertEqual(error.exception.code, 403)
        error.exception.close()
        self.assertTrue(self.call(previous, 'web/restart', {})['ok'])
        current = self.ready(previous['pid'], timeout=40)
        self.assertEqual(first.wait(20), 0)
        self.assertEqual(current['port'], previous['port'])
        self.assertNotEqual(current['token'], previous['token'])
        state = self.call(current)
        self.assertEqual(state['workspace'], saved)
        self.assertEqual(state['connections']['udp']['status'], 'closed')
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.bind(('127.0.0.1', udp_port))

    def test_exe_matching_requires_exact_path_and_internal_engine_flag(self):
        exe = self.base / 'SignalTester.exe'
        self.assertTrue(launcher.tester_command([str(exe), '--tester-engine'], exe, exe))
        for args in ([str(exe)], [str(exe), '--no-browser'],
                     [str(exe), '--config', '--tester-engine'],
                     [str(self.base.parent / 'SignalTester.exe'), '--tester-engine'],
                     ['SignalTester.exe', '--tester-engine']):
            with self.subTest(args=args):
                self.assertFalse(launcher.tester_command(args, exe, exe))
        def record(pid, parent, args):
            return dict(pid=pid, parent=parent, command=subprocess.list2cmdline(args))
        outer = record(101, 100, [str(exe)])
        bootloader = record(102, 101, [str(exe), '--tester-engine'])
        engine = record(103, 102, [str(exe), '--tester-engine'])
        self.assertEqual(launcher.engine_processes([outer, bootloader, engine], exe, exe), [engine])

    def test_legacy_process_replaced_without_stopping_unrelated_python(self):
        unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(90)',
                                      str(self.base/'signal_tester.py')], env=self.env,
                                      creationflags=subprocess.CREATE_NO_WINDOW)
        self.processes.append(unrelated)
        legacy = self.start(managed=False)
        deadline = time.monotonic()+10
        while time.monotonic() < deadline:
            self.logs[-1].seek(0)
            if b'Signal Tester: http' in self.logs[-1].read():
                break
            time.sleep(.05)
        else:
            self.fail('Legacy test process did not start')
        new = self.start()
        current = self.ready()
        self.assertEqual(legacy.wait(10), 0)
        self.assertIsNone(new.poll())
        self.assertIsNone(unrelated.poll(), 'A script path passed as data must not match')
        self.assertEqual([r['pid'] for r in launcher.discover_testers(self.base)], [current['pid']])
        unrelated.terminate()
        unrelated.wait(5)

    def test_simultaneous_launchers_leave_one_engine(self):
        first, second = self.start(), self.start()
        deadline = time.monotonic()+35
        while time.monotonic() < deadline and first.poll() is None and second.poll() is None:
            time.sleep(.1)
        self.assertEqual(sum(p.poll() is None for p in (first, second)), 1)
        self.assertIn(0, [first.poll(), second.poll()])
        current = self.ready()
        self.assertEqual([r['pid'] for r in launcher.discover_testers(self.base)], [current['pid']])

    def test_shutdown_requires_token_and_matching_instance_and_help_is_read_only(self):
        process = self.start()
        current = self.ready()
        for identity, token in [('wrong', current['token']), (current['instance'], 'wrong')]:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.call(current, 'shutdown', {'instance': identity}, token=token)
            self.assertEqual(error.exception.code, 403)
            error.exception.close()
        result = subprocess.run([sys.executable, str(self.base/'tester_launcher.py'), '--help'],
                                env=self.env, capture_output=True, timeout=10,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0)
        self.assertIsNone(process.poll())
        self.assertTrue(self.call(current, 'shutdown', {'instance': current['instance']})['ok'])
        self.assertEqual(process.wait(20), 0)
        self.assertFalse(self.file.exists())


if __name__ == '__main__':
    unittest.main()
