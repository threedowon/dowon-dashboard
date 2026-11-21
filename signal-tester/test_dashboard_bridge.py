"""Real loopback HTTP tests; no sensor or external receiver is contacted."""
import http.client
import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
import tempfile
import threading
import unittest

from signal_tester import create_server, Store, DASHBOARD_ORIGIN


class DashboardBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = create_server(Store(Path(self.temp.name)/'workspace.json'), dashboard=True)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.temp.cleanup()

    def request(self, method='GET', path='/api/state', headers=None, body=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            conn.close()

    def test_only_allowed_origin_and_token_can_read_and_write(self):
        good = {'Origin': DASHBOARD_ORIGIN, 'X-Tester-Token': self.server.token}
        status, headers, body = self.request(headers=good)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], DASHBOARD_ORIGIN)
        state = json.loads(body)
        status, _, _ = self.request('POST', '/api/workspace', {**good, 'Content-Type': 'application/json'},
                                    json.dumps({**state['workspace'], 'revision': state['revision']}))
        self.assertEqual(status, 200)
        for bad in ({'Origin': DASHBOARD_ORIGIN}, {**good, 'X-Tester-Token': 'wrong'},
                    {**good, 'Origin': 'https://evil.example'}, {**good, 'Host': 'evil.example'}):
            self.assertEqual(self.request(headers=bad)[0], 403)
        status, headers, _ = self.request(headers={**good, 'Origin': 'https://evil.example'})
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def api(self, path='state', body=None):
        status, _, payload = self.request('GET' if body is None else 'POST', '/api/'+path,
            {'X-Tester-Token': self.server.token, 'Content-Type': 'application/json'},
            None if body is None else json.dumps(body))
        return status, json.loads(payload)

    def test_stale_window_cannot_overwrite_new_signal_when_selecting_target(self):
        _, initial = self.api()
        workspace = initial['workspace']
        workspace['targets'].append({'id': 'second', 'name': 'Second Player', 'host': '127.0.0.1', 'port': 8421})
        self.assertEqual(self.api('workspace', {**workspace, 'revision': initial['revision']})[0], 200)
        _, first = self.api()
        _, second = self.api()
        first['workspace']['signals'].append({'id': 'new', 'name': 'New signal', 'key': 'new_signal', 'value': None})
        status, saved = self.api('workspace', {**first['workspace'], 'revision': first['revision']})
        self.assertEqual(status, 200)
        self.assertNotEqual(saved['revision'], first['revision'])
        second['workspace']['activeTarget'] = 'second'
        self.assertEqual(self.api('workspace', {**second['workspace'], 'revision': second['revision']})[0], 409)
        _, latest = self.api()
        self.assertEqual(latest['workspace'], saved['workspace'])
        self.assertEqual(latest['revision'], saved['revision'])
        latest['workspace']['activeTarget'] = 'second'
        status, retried = self.api('workspace', {**latest['workspace'], 'revision': latest['revision']})
        self.assertEqual(status, 200)
        self.assertEqual(retried['workspace']['activeTarget'], 'second')
        self.assertIn('new_signal', [s['key'] for s in retried['workspace']['signals']])
        self.assertEqual(Store(Path(self.temp.name)/'workspace.json').snapshot(), retried['workspace'])

    def test_concurrent_writers_with_same_revision_only_save_once(self):
        _, state = self.api()
        proposals = []
        for name in ('First edit', 'Second edit'):
            proposal = deepcopy(state['workspace'])
            proposal['targets'][0]['name'] = name
            proposals.append({**proposal, 'revision': state['revision']})
        barrier = threading.Barrier(2)
        def save(proposal):
            barrier.wait(timeout=5)
            return self.api('workspace', proposal)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(save, proposals))
        self.assertEqual(sorted(status for status, _ in results), [200, 409])
        winner = next(data for status, data in results if status == 200)
        self.assertEqual(self.api()[1]['workspace'], winner['workspace'])

    def test_missing_revision_and_old_revision_after_import_are_rejected(self):
        _, original = self.api()
        self.assertEqual(self.api('workspace', original['workspace'])[0], 409)
        status, imported = self.api('import-scene', {'scenes': [], 'signals': [{'key': 'imported'}]})
        self.assertEqual(status, 200)
        self.assertNotEqual(original['revision'], imported['revision'])
        self.assertEqual(self.api('workspace', {**original['workspace'], 'revision': original['revision']})[0], 409)
        self.assertEqual(self.api()[1]['workspace'], imported['workspace'])
        status, preset = self.api('sensors/preset', {'preset': 'sen0610'})
        self.assertEqual(status, 200)
        self.assertNotEqual(imported['revision'], preset['revision'])
        self.assertEqual(self.api('workspace', {**imported['workspace'], 'revision': imported['revision']})[0], 409)
        self.assertEqual(self.api()[1]['workspace'], preset['workspace'])

    def test_preflight_validates_host_origin_method_and_headers(self):
        good = {'Origin': DASHBOARD_ORIGIN, 'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type, x-tester-token',
                'Access-Control-Request-Private-Network': 'true'}
        status, headers, body = self.request('OPTIONS', headers=good)
        self.assertEqual(status, 204)
        self.assertEqual(body, b'')
        self.assertEqual(headers['Access-Control-Allow-Private-Network'], 'true')
        for patch in ({'Origin': 'null'}, {'Host': 'evil.example'},
                      {'Access-Control-Request-Method': 'DELETE'}, {'Access-Control-Request-Headers': 'authorization'}):
            self.assertEqual(self.request('OPTIONS', headers={**good, **patch})[0], 403)
        self.assertEqual(self.request('OPTIONS', '/', good)[0], 403)

    def test_token_cannot_be_read_cross_origin_but_local_ui_still_works(self):
        self.assertEqual(self.request(path='/', headers={'Origin': DASHBOARD_ORIGIN})[0], 403)
        status, _, body = self.request(path='/')
        self.assertEqual(status, 200)
        self.assertIn(self.server.token.encode(), body)
        self.assertNotIn(b'__TESTER_TOKEN__', body)
        self.assertEqual(self.request(path='/app.js')[0], 200)

    def test_dashboard_access_is_opt_in(self):
        other = create_server(Store(Path(self.temp.name)/'other.json'))
        thread = threading.Thread(target=other.serve_forever)
        thread.start()
        original, self.server = self.server, other
        try:
            self.assertEqual(self.request(headers={'Origin': DASHBOARD_ORIGIN, 'X-Tester-Token': other.token})[0], 403)
            self.assertEqual(self.request(headers={'X-Tester-Token': other.token})[0], 200)
            self.assertNotEqual(original.token, other.token)
        finally:
            self.server = original
            other.shutdown(); thread.join(); other.server_close()
