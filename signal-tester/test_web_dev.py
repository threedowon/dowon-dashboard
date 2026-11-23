import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import urllib.request

import signal_tester as tester
from tester_cloud import CloudSync, protect
from tester_web_dev import check_workspace_in_use


@unittest.skipUnless(os.name == 'nt', 'Windows EXE workspace and DPAPI backup')
class WebDevTests(unittest.TestCase):
    def test_browser_mode_reuses_exe_settings_and_credentials_without_native_window_or_updater(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'LOCALAPPDATA': directory}):
            config=Path(directory)/'SignalTester/dashboard-workspace.json'
            store=tester.Store(config);saved=store.snapshot();saved['signals'][0]['name']='기존 설정';store.save(saved)
            cloud=CloudSync(store);cloud.meta['login']='test-account';cloud.persist()
            cloud.secret_file.write_bytes(protect(b'test-credential'))
            credential=cloud.secret_file.read_bytes();device=cloud.meta['device']
            url=[];opened=threading.Event();errors=[]
            def browser(value):url.append(value);opened.set();return True
            def run():
                try:tester.main(['--web-dev'])
                except Exception as error:errors.append(error);opened.set()
            with patch('signal_tester.webbrowser.open',browser),patch.object(CloudSync,'start'),patch.object(CloudSync,'close'),patch('tester_window.run_window') as native,patch('tester_update.Updater') as updater:
                thread=threading.Thread(target=run);thread.start();self.assertTrue(opened.wait(5));self.assertFalse(errors)
                def call(route,body=None):
                    with urllib.request.urlopen(url[0],timeout=3) as response:
                        html=response.read().decode()
                    import re
                    token=re.search(r'name="tester-token" content="([^"]+)"',html)[1]
                    req=urllib.request.Request(url[0]+'api/'+route,data=None if body is None else json.dumps(body).encode(),headers={'X-Tester-Token':token,'Content-Type':'application/json'})
                    with urllib.request.urlopen(req,timeout=3) as response:return json.load(response)
                try:
                    state=call('state');self.assertEqual(state['workspace'],saved)
                    status=call('cloud/status');self.assertTrue(status['webDev']);self.assertTrue(status['desktop'])
                    self.assertTrue(status['cloud']['connected']);self.assertEqual(status['cloud']['device'],device)
                    self.assertFalse(call('update/status')['enabled'])
                    self.assertEqual(call('debug')['counts']['received'],0)
                    native.assert_not_called();updater.assert_not_called()
                finally:call('exit',{});thread.join(5)
                self.assertFalse(thread.is_alive());self.assertFalse(errors)
            self.assertEqual(json.loads(config.read_text(encoding='utf-8')),saved)
            self.assertEqual(cloud.secret_file.read_bytes(),credential)
            self.assertEqual(json.loads(cloud.file.read_text(encoding='utf-8'))['device'],device)

    def test_ui_reads_changed_source_on_refresh_without_restarting_or_rewriting_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);ui=root/'signal_tester_ui';ui.mkdir();asset=ui/'app.js';asset.write_text('first version')
            store=tester.Store(root/'workspace.json');store.save(store.snapshot());before=store.file.read_bytes()
            server=tester.create_server(store,desktop=True,web_dev=True)
            worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
            try:
                with patch.object(tester,'BASE',root):
                    for content in ('first version','edited version'):
                        asset.write_text(content)
                        with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/app.js',timeout=3) as response:
                            self.assertEqual(response.read().decode(),content)
                            self.assertEqual(response.headers['Cache-Control'],'no-store')
                self.assertEqual(store.file.read_bytes(),before)
            finally:server.shutdown();server.server_close();worker.join(3)

    def test_existing_exe_with_same_backup_identity_blocks_second_writer(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'LOCALAPPDATA':directory}):
            root=Path(directory)/'SignalTester';config=root/'dashboard-workspace.json'
            key=hashlib.sha256(os.path.normcase(str(config.resolve())).encode()).hexdigest()[:24]
            meta=root/'cloud'/(key+'.json');meta.parent.mkdir(parents=True);meta.write_text(json.dumps({'device':'same-device'}))
            server=tester.create_server(tester.Store(config),cloud=SimpleNamespace(status=lambda:{'device':'same-device'},close=lambda:None))
            worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
            instance=root/'instances/legacy.json';instance.parent.mkdir();instance.write_text(json.dumps({'pid':-1,'port':server.server_port,'token':server.token}))
            try:
                with self.assertRaisesRegex(RuntimeError,'already open'):check_workspace_in_use(config)
                check_workspace_in_use(root/'another-workspace.json')
            finally:server.shutdown();server.server_close();worker.join(3)
