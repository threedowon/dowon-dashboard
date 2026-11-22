import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from signal_tester import Store, create_server
import tester_update as update


def release(version='1.3.0', payload=b'MZverified test executable'):
    prefix=update.REPOSITORY+'/releases/download/signal-tester-v'+version+'/'
    return {'tag_name':'signal-tester-v'+version,'assets':[
        {'name':'SignalTester.exe','browser_download_url':prefix+'SignalTester.exe','size':len(payload),
         'digest':'sha256:'+hashlib.sha256(payload).hexdigest()},
        {'name':'SHA256SUMS.txt','browser_download_url':prefix+'SHA256SUMS.txt'}]}


class UpdateTests(unittest.TestCase):
    def test_version_order_ignores_prereleases_old_and_foreign_assets(self):
        bad=release('9.0.0');bad['assets'][0]['browser_download_url']='https://other.test/payload.exe'
        preview={**release('7.0.0'),'prerelease':True}
        chosen=update.choose_release([bad,preview,release('1.9.0'),release('1.10.0'),release('1.2.0')])
        self.assertEqual(chosen['version'],'1.10.0')
        self.assertIsNone(update.choose_release([release('1.1.0'),release('1.2.0')]))
        redirect=update.SafeRedirect()
        for url in ['http://github.com/a','https://evil.test/a','https://github.com.evil.test/a']:
            with self.assertRaises(ValueError):redirect.redirect_request(None,None,302,'',{},url)

    def test_download_checks_hash_size_and_cancellation_before_replacement(self):
        payload=b'MZverified payload';candidate=update.choose_release([release(payload=payload)])
        checksum=hashlib.sha256(payload).hexdigest().encode()+b'  SignalTester.exe\n'
        for body,stop,valid in [(payload,False,True),(payload[:-1]+b'x',False,False),(payload+b'extra',False,False),(payload,True,False)]:
            with self.subTest(valid=valid,body=body,stop=stop),tempfile.TemporaryDirectory() as root:
                file=Path(root)/'new.exe';cancel=threading.Event()
                if stop:cancel.set()
                opener=lambda url:io.BytesIO(checksum if url.endswith('.txt') else body)
                if valid:
                    update.download_release(candidate,file,cancel,lambda _:None,opener)
                    self.assertEqual(file.read_bytes(),payload)
                else:
                    with self.assertRaises(ValueError):update.download_release(candidate,file,cancel,lambda _:None,opener)
                    self.assertFalse(file.exists())

    def test_partial_replace_and_changed_executable_preserve_original(self):
        with tempfile.TemporaryDirectory() as root:
            target,staged,backup=[Path(root)/name for name in ('app.exe','new.exe','old.exe')]
            target.write_bytes(b'original');staged.write_bytes(b'new')
            job={'target':str(target),'staged':str(staged),'backup':str(backup),
                 'originalHash':update.sha256(target),'sha256':update.sha256(staged)}
            original_replace=os.replace
            def replace(a,b):
                if Path(a)==staged:raise OSError('Disk failure')
                original_replace(a,b)
            with patch.object(update.os,'replace',side_effect=replace):
                with self.assertRaises(OSError):update.replace_executable(job,unlock=lambda _:None)
            self.assertEqual(target.read_bytes(),b'original');self.assertFalse(backup.exists())
            cancel=Path(root)/'cancel.json';cancel.write_text('{}');job['cancel']=str(cancel)
            with self.assertRaises(ValueError):update.replace_executable(job,unlock=lambda _:None)
            self.assertEqual(target.read_bytes(),b'original');job.pop('cancel')
            target.write_bytes(b'changed by another update')
            with self.assertRaises(ValueError):update.replace_executable(job,unlock=lambda _:None)
            self.assertEqual(target.read_bytes(),b'changed by another update')

    def test_failed_start_rolls_back_exe_without_changing_settings_or_credentials(self):
        with tempfile.TemporaryDirectory() as directory,patch.dict(os.environ,{'LOCALAPPDATA':directory}):
            target=Path(directory)/'SignalTester.exe';target.write_bytes(b'original exe')
            root=update.update_root(target);folder=root/('a'*32);folder.mkdir(parents=True)
            staged=target.parent/('.signal-update-'+folder.name+'.exe');staged.write_bytes(b'new exe')
            backup=target.parent/('.signal-previous-'+folder.name+'.exe')
            settings=Path(directory)/'workspace.json';settings.write_bytes(b'original settings')
            credential=Path(directory)/'cloud.credential';credential.write_bytes(b'protected credential')
            job={'target':str(target),'staged':str(staged),'backup':str(backup),'originalHash':update.sha256(target),
                 'sha256':update.sha256(staged),'version':'1.3.0','instance':'old','args':['--config',str(settings)]}
            update.write_json(folder/'job.json',job)
            class Process:
                def wait(self,**kwargs):return 1
            with patch.object(update,'LaunchLock',side_effect=lambda _:contextlib.nullcontext()),\
                    patch.object(update,'wait_unlocked'),patch.object(update,'spawn',return_value=Process()) as launch,\
                    patch.object(update,'wait_started',return_value=False),patch('tester_launcher.discover_testers',return_value=[]):
                # Default arguments are bound at definition time; inject the unlocked file operation.
                actual_replace=update.replace_executable
                with patch.object(update,'replace_executable',side_effect=lambda j:actual_replace(j,unlock=lambda _:None)):
                    self.assertEqual(update.apply_update(folder/'job.json'),1)
            self.assertEqual(target.read_bytes(),b'original exe')
            self.assertEqual(settings.read_bytes(),b'original settings')
            self.assertEqual(credential.read_bytes(),b'protected credential')
            self.assertEqual(launch.call_count,2)
            self.assertEqual(json.loads((root/'result.json').read_text(encoding='utf-8'))['kind'],'error')

    def test_check_failure_is_nonfatal_and_install_requires_selected_version(self):
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'LOCALAPPDATA':root}):
            updater=update.Updater(Path(root)/'app.exe',opener=lambda _:(_ for _ in ()).throw(OSError('offline')))
            updater.start_check();updater.thread.join(2)
            self.assertEqual(updater.status()['phase'],'error')
            with self.assertRaises(ValueError):updater.install('1.3.0')
            updater.close()

    def test_startup_checks_public_manifest_without_github_api_or_login(self):
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'LOCALAPPDATA':root}):
            urls=[]
            def opener(url):urls.append(url);return io.BytesIO(json.dumps(release()).encode())
            updater=update.Updater(Path(root)/'app.exe',opener=opener)
            updater.start_check();updater.thread.join(2)
            self.assertEqual(urls,[update.UPDATE_FEED])
            self.assertEqual(updater.status()['latest'],'1.3.0')
            self.assertEqual(updater.status()['phase'],'available')
            updater.close()

    def test_api_requires_local_token_and_never_accepts_client_download_urls(self):
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'LOCALAPPDATA':root}):
            updater=update.Updater(Path(root)/'app.exe',opener=lambda _:io.BytesIO(b'[]'))
            server=create_server(Store(Path(root)/'workspace.json'),desktop=True,updater=updater)
            threading.Thread(target=server.serve_forever,daemon=True).start()
            def call(route,body=None,token=None):
                req=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/update/'+route,
                    data=None if body is None else json.dumps(body).encode(),
                    headers={'X-Tester-Token':token or server.token,'Content-Type':'application/json'})
                with urllib.request.urlopen(req,timeout=3) as response:return json.load(response)
            try:
                with self.assertRaises(urllib.error.HTTPError) as error:call('status',token='wrong')
                self.assertEqual(error.exception.code,403);error.exception.close()
                self.assertEqual(call('status')['current'],update.VERSION)
                with self.assertRaises(urllib.error.HTTPError) as error:call('install',{'version':'9.0.0','url':'https://evil.test/a'})
                self.assertEqual(error.exception.code,400);error.exception.close()
            finally:server.shutdown();server.server_close()


if __name__=='__main__':unittest.main()
