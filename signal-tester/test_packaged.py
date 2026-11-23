"""Exercise only the shipped EXE, outside the checkout and without Python on PATH."""
import json
import hashlib
import io
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.request

import tester_launcher as launcher
import test_launcher


@unittest.skipUnless(os.name == 'nt' and os.environ.get('SIGNAL_TESTER_EXE'), 'Set SIGNAL_TESTER_EXE to the built EXE')
class PackagedTests(unittest.TestCase):
    call = test_launcher.LauncherTests.call
    ready = test_launcher.LauncherTests.ready

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tester-exe-')
        self.base = Path(self.temp.name) / '한글 path with spaces'
        self.base.mkdir()
        self.exe = self.base / 'SignalTester.exe'
        shutil.copy2(os.environ['SIGNAL_TESTER_EXE'], self.exe)
        self.env = dict(os.environ, LOCALAPPDATA=self.temp.name,
                        PATH=str(Path(os.environ['SystemRoot']) / 'System32'), PYTHONUTF8='1')
        for key in ('SIGNAL_TESTER_INSTANCE_FILE', 'SIGNAL_TESTER_INSTANCE_ID', 'PYTHONHOME', 'PYTHONPATH'):
            self.env.pop(key, None)
        self.file = Path(self.temp.name) / 'SignalTester' / 'instances' / (launcher.installation_id(self.exe)+'.json')
        self.config = Path(self.temp.name) / 'SignalTester' / 'dashboard-workspace.json'
        self.processes, self.logs = [], []
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self):
        try:
            for record in launcher.discover_testers(self.exe, self.exe):
                launcher.TesterProcess(record).stop(launcher.read_instance(self.file))
        finally:
            for process in self.processes:
                try:
                    process.wait(15)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(5)
            for log in self.logs:
                log.close()
            if self.exe.exists():
                from tester_update import wait_unlocked
                wait_unlocked(self.exe, timeout=20)
            self.temp.cleanup()

    def start(self):
        log = open(Path(self.temp.name) / f'process-{len(self.processes)}.log', 'w+b')
        self.logs.append(log)
        process = subprocess.Popen([str(self.exe), '--no-browser'], cwd=self.base, env=self.env,
                                   stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        self.processes.append(process)
        return process

    def test_standalone_assets_presets_udp_auth_persistence_and_restart(self):
        self.assertIsNone(shutil.which('python', path=self.env['PATH']))
        self.assertIsNone(shutil.which('py', path=self.env['PATH']))
        first = self.start()
        previous = self.ready(timeout=40)
        base_url = f"http://127.0.0.1:{previous['port']}"
        with self.opener.open(base_url+'/', timeout=3) as response:
            html = response.read().decode()
        self.assertIn(previous['token'], html)
        self.assertNotIn('__TESTER_TOKEN__', html)
        for asset in ('app.js', 'io.js', 'keyboard.js', 'sensors.js', 'style.css', 'code-guide.js', 'debug.js', 'debug.css', 'debug-open.js'):
            with self.opener.open(base_url+'/'+asset, timeout=3) as response:
                self.assertGreater(len(response.read()), 100)
        with self.opener.open(base_url+'/code-guide.json', timeout=3) as response:
            guide = json.load(response)['pages']
        self.assertIn('Serial.println(value)', guide['code']['html'])
        self.assertIn('void setup()', guide['fsr-source']['html'])
        self.assertIn('GPIO9', guide['sen0610']['html'])
        with self.opener.open(base_url+'/debug.html', timeout=3) as response:
            self.assertIn(previous['token'], response.read().decode())
        self.assertEqual(self.call(previous, 'debug')['counts']['received'], 0)
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.call(previous, token='wrong')
        self.assertEqual(error.exception.code, 403)
        error.exception.close()
        initial = self.call(previous)
        self.assertTrue(initial['serial']['available'])
        self.assertEqual(self.call(previous, 'ports', {})['error'], '')
        preset = self.call(previous, 'sensors/preset', {'preset': 'all'})
        self.assertGreaterEqual(len(preset['workspace']['sensors']), 16)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as peer:
            peer.bind(('127.0.0.1', 0))
            peer.settimeout(3)
            data = preset['workspace']
            data['targets'].append({'id': 'udp-test', 'name': 'Packaged UDP', 'type': 'udp',
                                    'bindHost': '127.0.0.1', 'bindPort': 0,
                                    'remoteHost': '127.0.0.1', 'remotePort': peer.getsockname()[1]})
            saved = self.call(previous, 'workspace', {**data, 'revision': preset['revision']})['workspace']
            opened = self.call(previous, 'io/open', {'targetId': 'udp-test'})['connections']['udp-test']
            self.assertEqual(opened['status'], 'open')
            udp_port = int(opened['local'].rsplit(':', 1)[1])
            self.call(previous, 'io/send', {'targetId': 'udp-test', 'data': 'packaged ping', 'ending': 'lf'})
            payload, sender = peer.recvfrom(8192)
            self.assertEqual(payload, b'packaged ping\n')
            peer.sendto(b'123\n', sender)
            deadline = time.monotonic()+3
            while time.monotonic() < deadline:
                if self.call(previous)['connections']['udp-test']['rxCount']:
                    break
                time.sleep(.05)
            self.assertGreater(self.call(previous)['connections']['udp-test']['rxCount'], 0)
            second = self.start()
            current = self.ready(previous['pid'], timeout=40)
            self.assertEqual(first.wait(20), 0)
            self.assertIsNone(second.poll())
            self.assertNotEqual(current['token'], previous['token'])
            self.assertEqual(self.call(current)['workspace'], saved)
            self.assertEqual(json.loads(self.config.read_text(encoding='utf-8')), saved)
            self.assertEqual(self.call(current)['connections']['udp-test']['status'], 'closed')
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.bind(('127.0.0.1', udp_port))
        result = subprocess.run([str(self.exe), '--help'], env=self.env, capture_output=True,
                                timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0)
        self.assertIsNone(second.poll())
        self.assertEqual([r['pid'] for r in launcher.discover_testers(self.exe, self.exe)], [current['pid']])
        self.call(current, 'shutdown', {'instance': current['instance']})
        self.assertEqual(second.wait(20), 0)
        self.assertFalse(self.file.exists())
        self.logs[0].seek(0)
        self.assertNotIn(b'pairing code', self.logs[0].read())

    def test_simultaneous_launches_leave_one_engine(self):
        first, second = self.start(), self.start()
        deadline = time.monotonic()+45
        while time.monotonic() < deadline and first.poll() is None and second.poll() is None:
            time.sleep(.1)
        self.assertEqual(sum(p.poll() is None for p in (first, second)), 1)
        self.assertIn(0, [first.poll(), second.poll()])
        state = self.ready(timeout=10)
        self.assertEqual([r['pid'] for r in launcher.discover_testers(self.exe, self.exe)], [state['pid']])

    def test_verified_update_replaces_running_exe_and_preserves_workspace_and_cloud_identity(self):
        import tester_update as update
        from test_update import release
        first=self.start();previous=self.ready(timeout=40)
        initial=self.call(previous)
        data=initial['workspace'];data['targets'][0]['port']=9876
        saved=self.call(previous,'workspace',{**data,'revision':initial['revision']})['workspace']
        identity=self.call(previous,'cloud/status')['cloud']['device']
        # Change the shipped binary bytes while keeping its real embedded version.
        payload=self.exe.read_bytes()+b'\nverified-updater-roundtrip-fixture\n'
        digest=hashlib.sha256(payload).hexdigest()
        checksums=(digest+'  SignalTester.exe\n').encode()
        opener=lambda url:io.BytesIO(checksums if url.endswith('.txt') else payload)
        def launch(command):
            process=update.spawn(command);self.processes.append(process);return process
        with patch.dict(os.environ,self.env):
            updater=update.Updater(self.exe,['--config',str(self.config),'--no-browser'],current='1.1.0',opener=opener,launch=launch)
            updater.release=update.choose_release([release(update.VERSION,payload)],current='1.1.0')
            updater.shutdown=lambda:self.call(previous,'shutdown',{'instance':previous['instance']})
            updater.install(update.VERSION)
            updater.thread.join(35)
            self.assertTrue(updater.handoff,updater.status())
            self.assertEqual(first.wait(30),0)
            current=self.ready(previous['pid'],timeout=60)
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                result=launcher.read_instance(updater.root/'result.json')
                if result.get('kind') in ('success','error'):break
                time.sleep(.1)
            self.assertEqual(result.get('kind'),'success',result)
            self.assertEqual(update.sha256(self.exe),digest)
            self.assertEqual(self.call(current)['workspace'],saved)
            self.assertEqual(self.call(current,'cloud/status')['cloud']['device'],identity)
            self.assertEqual(self.call(current,'update/status')['current'],update.VERSION)
            self.call(current,'shutdown',{'instance':current['instance']})
            deadline=time.monotonic()+20
            while self.file.exists() and time.monotonic()<deadline:time.sleep(.1)
            updater.close()


if __name__ == '__main__':
    unittest.main()
