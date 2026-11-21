"""Real loopback HTTP tests; no sensor or external receiver is contacted."""
import http.client
import json
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
        workspace = json.loads(body)['workspace']
        status, _, _ = self.request('POST', '/api/workspace', {**good, 'Content-Type': 'application/json'}, json.dumps(workspace))
        self.assertEqual(status, 200)
        for bad in ({'Origin': DASHBOARD_ORIGIN}, {**good, 'X-Tester-Token': 'wrong'},
                    {**good, 'Origin': 'https://evil.example'}, {**good, 'Host': 'evil.example'}):
            self.assertEqual(self.request(headers=bad)[0], 403)
        status, headers, _ = self.request(headers={**good, 'Origin': 'https://evil.example'})
        self.assertNotIn('Access-Control-Allow-Origin', headers)

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
