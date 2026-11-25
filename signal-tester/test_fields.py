"""JSON discovery and real loopback isolation; no physical sensors or Players."""
import json
import socket
import unittest
from urllib.parse import urlencode
from tester_fields import JSONFields
from test_transports import udp_profile, wait_for
import test_dashboard_bridge


def key(*path):
    return json.dumps(path, ensure_ascii=False, separators=(',', ':'))


class JSONFieldTests(unittest.TestCase):
    def test_serial_chunks_nested_paths_types_and_utf8(self):
        fields = JSONFields()
        payload = json.dumps({'mmwave': {'distance': 0}, 'fsr': [12, 34], 'detected': True,
                              'label': '거리', 'empty': None}, ensure_ascii=False).encode()+b'\r\n'
        for byte in payload[:-1]:
            fields.receive(bytes([byte]), 1000)
        fields.receive(payload[-1:], 1001)
        rows = {r['key']: r for r in fields.snapshot()['items']}
        self.assertEqual(rows[key('mmwave', 'distance')]['value'], 0)
        self.assertTrue(rows[key('mmwave', 'distance')]['numeric'])
        self.assertEqual(rows[key('fsr', '1')]['value'], 34)
        self.assertEqual(rows[key('label')]['value'], '거리')
        self.assertFalse(rows[key('detected')]['numeric'])
        self.assertEqual(rows[key('empty')]['type'], 'null')
        self.assertEqual(fields.messages, 1)
        self.assertFalse(fields.snapshot()['partial'])

    def test_pretty_udp_and_multiple_serial_frames(self):
        fields = JSONFields()
        fields.receive(b'{\n "distance": 2.5\n}', 1000, True)
        fields.receive(b'{"distance":2}\n{"distance":1}\r', 1200)
        self.assertEqual(fields.messages, 3)
        self.assertEqual(fields.detail(key('distance'))['points'], [[1000, 2.5], [1200, 1]])

    def test_missing_invalid_and_changed_type_break_graph(self):
        fields = JSONFields()
        for stamp, payload in enumerate([b'{"x":1}', b'{"y":2}', b'{"x":2}', b'{"x":"bad"}',
                                         b'{"x":3}', b'{bad}', b'{"x":4}']):
            fields.receive(payload, stamp*1000, True)
        self.assertEqual([p[1] for p in fields.detail(key('x'))['points']], [1, None, 2, None, 3, None, 4])
        self.assertEqual(fields.errors, 1)
        self.assertEqual(fields.last_error, '')
        self.assertEqual(fields.detail(key('absent'))['points'], [])

    def test_bounded_frames_fields_history_and_safe_numbers(self):
        fields = JSONFields()
        fields.receive(b'{"huge":1e999}', 0, True)
        fields.receive(b'{"nan":NaN}', 0, True)
        fields.receive(b'{"tooLong":"'+b'x'*4096+b'"}\n', 0)
        self.assertEqual(fields.errors, 3)
        self.assertFalse(fields.items)
        fields.receive(json.dumps({'large': 2**60}).encode(), 0, True)
        self.assertEqual(fields.snapshot()['items'][0]['value'], str(2**60))
        for i in range(650):
            fields.receive(b'{"x":1}', i*100, True)
        self.assertEqual(len(fields.detail(key('x'))['points']), 600)
        fields.receive(json.dumps({str(i): i for i in range(140)}).encode(), 70000, True)
        self.assertEqual(len(fields.items), 128)
        self.assertTrue(fields.snapshot()['limited'])
        self.assertEqual(fields.detail(key('x'))['points'], [])

    def test_stale_fragments_and_osc_are_not_json(self):
        clock = [0]
        fields = JSONFields(clock=lambda: clock[0])
        fields.receive(b'{"x":1}\n{"unfinished":', 0)
        self.assertTrue(fields.snapshot()['partial'])
        clock[0] = 3
        self.assertFalse(fields.snapshot()['items'][0]['live'])
        fields.receive(b'{"x":2}\n', 3000)
        fields.receive(b'/osc'+b'x'*5000, 3100, True)
        self.assertEqual(fields.errors, 0)
        self.assertEqual(fields.messages, 2)
        self.assertEqual(fields.snapshot()['items'][0]['value'], 2)

    def test_literal_dot_and_nested_field_are_distinct(self):
        fields = JSONFields()
        fields.receive(b'{"a.b":1,"a":{"b":2}}', 1000, True)
        self.assertEqual(fields.detail(key('a.b'))['points'][0][1], 1)
        self.assertEqual(fields.detail(key('a', 'b'))['points'][0][1], 2)

    def test_invalid_unicode_is_rejected_before_api_serialization(self):
        fields = JSONFields()
        for payload in [b'{"label":"\\ud800"}', b'{"\\ud800":1}']:
            fields.receive(payload, 1000, True)
        self.assertEqual(fields.errors, 2)
        self.assertEqual(fields.snapshot()['items'], [])
        fields.receive(b'{"label":"\\ud83d\\udfe2"}', 2000, True)
        json.dumps(fields.snapshot(), ensure_ascii=False).encode('utf-8')


class JSONFieldAPITests(unittest.TestCase):
    setUp = test_dashboard_bridge.DashboardBridgeTests.setUp
    tearDown = test_dashboard_bridge.DashboardBridgeTests.tearDown
    request = test_dashboard_bridge.DashboardBridgeTests.request
    api = test_dashboard_bridge.DashboardBridgeTests.api

    def test_discovery_history_and_workspace_are_isolated(self):
        self.assertEqual(self.request(path='/api/fields')[0], 403)
        _, state = self.api()
        workspace = state['workspace']
        workspace['targets'] += [udp_profile(id='mmwave'), udp_profile(id='fsr')]
        workspace['sensors'] = [{'id': 'saved', 'name': 'Distance', 'sourceId': 'mmwave', 'parser': 'json',
                                 'field': 'distance', 'unit': 'm', 'staleSeconds': 3,
                                 'rules': [{'id': 'near', 'op': 'lt', 'threshold': 2.5, 'hysteresis': .1,
                                            'hold': 0, 'valueMode': 'saved', 'enabled': True,
                                            'signalId': workspace['signals'][0]['id'], 'targetId': workspace['targets'][0]['id']}]}]
        status, saved = self.api('workspace', {**workspace, 'revision': state['revision']})
        self.assertEqual(status, 200)
        for name, payload in [('mmwave', b'{"distance":1.84,"detected":true}'), ('fsr', b'{"distance":999,"pressure":512}')]:
            _, runtime = self.api('io/open', {'targetId': name})
            port = int(runtime['connections'][name]['local'].rsplit(':', 1)[1])
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as peer:
                peer.sendto(payload, ('127.0.0.1', port))
            wait_for(lambda: self.api()[1]['connections'][name]['rxCount'] == 1)
        _, runtime = self.api()
        self.assertEqual(runtime['workspace'], saved['workspace'])
        self.assertEqual(runtime['revision'], saved['revision'])
        self.assertEqual({r['key'] for r in runtime['connections']['mmwave']['fields']['items']}, {key('distance'), key('detected')})
        self.assertEqual({r['key'] for r in runtime['connections']['fsr']['fields']['items']}, {key('distance'), key('pressure')})
        for name, value in [('mmwave', 1.84), ('fsr', 999)]:
            status, history = self.api('fields?'+urlencode({'target': name, 'field': key('distance')}))
            self.assertEqual(status, 200)
            self.assertEqual(history['points'][0][1], value)
        self.assertEqual(self.api('fields?'+urlencode({'target':'missing', 'field':key('distance')}))[1]['points'], [])
        self.assertEqual(self.api('fields?field='+'x'*4097)[0], 400)
        self.assertEqual(self.request(path='/fields.js')[0], 200)
        self.api('io/close', {'targetId': 'mmwave'})
        self.api('io/open', {'targetId': 'mmwave'})
        self.assertEqual(self.api()[1]['connections']['mmwave']['fields']['items'], [])
        self.assertEqual(self.api()[1]['workspace'], saved['workspace'])


if __name__ == '__main__':
    unittest.main()
