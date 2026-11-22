import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from signal_tester import Store, create_server, defaults
from tester_cloud import CloudSync, CloudError, fingerprint, protect


class FakeCloud:
    def __init__(self):
        self.files, self.devices = {}, {}
        self.fail = False
        self.writes = 0

    def __call__(self, route, body=None, credential=None):
        if self.fail:
            raise CloudError('Offline')
        if route == 'exchange':
            return {'credential': 'secret-'+body['code'], 'device': self.devices[body['code']], 'login': 'threedowon'}
        if route == 'disconnect':
            return {'ok': True}
        if route == 'backups':
            return {'backups': [entry['backup'] for entry in self.files.values()]}
        identity = route.split('/')[-1]
        previous = self.files.get(identity, {'sha': None, 'backup': None})
        if body is None:
            return previous
        if body['sha'] != previous['sha']:
            raise CloudError('Conflict', 409)
        self.writes += 1
        result = {'sha': str(self.writes), 'backup': {'id': identity, 'name': body['name'], 'data': body['data'], 'updatedAt': '2026-11-22T00:00:00Z'}}
        self.files[identity] = result
        return {'sha': result['sha'], 'updatedAt': result['backup']['updatedAt']}


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.remote = FakeCloud()
        self.clouds = []

    def tearDown(self):
        for cloud in self.clouds:
            cloud.close()
        self.temp.cleanup()

    def make(self, name):
        store = Store(self.root/(name+'.json'))
        if not store.file.exists():
            store.save(store.snapshot())
        cloud = CloudSync(store, self.root/'credentials', self.remote,
                          cipher=lambda data, decrypt=False: bytes(b ^ 77 for b in data), browser=lambda url: True)
        self.clouds.append(cloud)
        return cloud

    def connect(self, cloud):
        cloud.connect(1234, 'Test PC')
        code = cloud.meta['device']
        self.remote.devices[code] = code
        cloud.finish_login(code, cloud.pending['state'])

    def test_offline_changes_survive_restart_and_other_pc_restore_does_not_overwrite_source(self):
        first = self.make('A');self.connect(first);first.sync()
        self.assertFalse(first.status()['dirty'])
        data = first.store.snapshot();data['targets'][0]['port'] = 9876
        first.store.save(data);self.remote.fail = True;first.sync()
        self.assertTrue(first.status()['dirty']);self.assertIn('Offline', first.status()['error'])
        resumed = self.make('A');self.remote.fail = False;resumed.sync()
        self.assertFalse(resumed.status()['dirty'])
        second = self.make('B');self.connect(second)
        second.store.save(second.download(first.meta['device']));second.sync()
        self.assertEqual(second.store.snapshot(), resumed.store.snapshot())
        self.assertEqual(len(self.remote.files), 2)
        self.assertNotEqual(first.meta['device'], second.meta['device'])
        self.assertNotIn(first.credential, first.secret_file.read_text(errors='replace'))
        self.assertNotIn('credential', json.loads(first.file.read_text()))
        self.assertNotIn(first.credential, json.dumps(first.status()))

    def test_stale_backup_requires_explicit_resolution_and_lost_response_is_idempotent(self):
        cloud = self.make('A');self.connect(cloud);cloud.sync()
        data = cloud.store.snapshot();data['targets'][0]['port'] = 9876;cloud.store.save(data)
        remote = self.remote.files[cloud.meta['device']];remote['sha'] = 'external'
        cloud.sync();self.assertTrue(cloud.status()['conflict'])
        cloud.sync(force=True);self.assertFalse(cloud.status()['conflict'])
        cloud.meta.update(digest=None,sha='lost-response')
        before = self.remote.writes;cloud.sync()
        self.assertEqual(self.remote.writes,before);self.assertFalse(cloud.status()['dirty'])

    def test_callback_state_and_restore_id_validation(self):
        cloud = self.make('A');cloud.connect(1234,'Test')
        with self.assertRaises(ValueError):cloud.finish_login('code','bad-state')
        self.assertFalse(cloud.status()['connected'])
        for identity in ['../private', None, 'x'*32]:
            with self.assertRaises(ValueError):cloud.download(identity)

    def test_restore_api_preserves_recovery_rejects_stale_revision_and_closes_ports(self):
        cloud = self.make('A');self.connect(cloud);cloud.sync()
        data = cloud.store.snapshot();data['targets'].append({'id':'udp','name':'UDP','type':'udp','bindHost':'127.0.0.1','bindPort':0,'remoteHost':'127.0.0.1','remotePort':9001});cloud.store.save(data)
        server = create_server(cloud.store,cloud=cloud,desktop=True)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        def call(route,body=None):
            request=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/'+route,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Tester-Token':server.token})
            with urllib.request.urlopen(request,timeout=3) as r:return json.load(r)
        try:
            call('io/open',{'targetId':'udp'})
            self.assertEqual(call('state')['connections']['udp']['status'],'open')
            with self.assertRaises(urllib.error.HTTPError) as error:call('cloud/restore',{'id':cloud.meta['device'],'revision':'stale'})
            self.assertEqual(error.exception.code,409);error.exception.close()
            original=cloud.store.snapshot()
            result=call('cloud/restore',{'id':cloud.meta['device'],'revision':cloud.store.revision})
            self.assertEqual(json.loads(Path(result['recovery']).read_text()),original)
            self.assertEqual(server.hub.sessions,{})
            self.assertNotIn('credential',json.dumps(call('cloud/status')))
            self.assertEqual(cloud.store.snapshot(),self.remote.files[cloud.meta['device']]['backup']['data'])
        finally:server.shutdown();server.server_close()

    @unittest.skipUnless(os.name=='nt','Windows credential encryption')
    def test_windows_credential_is_encrypted_and_roundtrips(self):
        secret=b'private scoped test credential'
        encrypted=protect(secret)
        self.assertNotIn(secret,encrypted)
        self.assertEqual(protect(encrypted,decrypt=True),secret)


if __name__=='__main__':unittest.main()
