"""Preset merging and multi-source receiver integration; no hardware required."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request

from signal_tester import defaults, validate_workspace, Store, create_server
from tester_presets import add_sensor_preset
from tester_sensors import SensorEngine


class PresetTests(unittest.TestCase):
    def test_combined_is_valid_and_idempotent(self):
        before = defaults()
        original = deepcopy(before)
        merged, added = add_sensor_preset(before, 'all')
        self.assertEqual(added['sensors'], 16)
        self.assertEqual(len(validate_workspace(merged)['sensors']), 16)
        again, additions = add_sensor_preset(merged, 'all')
        self.assertEqual(again, merged)
        self.assertEqual(additions, dict(targets=0, signals=0, sensors=0))
        self.assertEqual(before, original)

    def test_preserves_custom_ports_rules_and_imported_fsr_workspace(self):
        path = Path(__file__).parent / 'presets' / 'fsr.json'
        source = json.loads(path.read_text(encoding='utf-8'))
        source['sensors'] = [m for m in source['sensors'] if not m['field'].startswith('raw')]
        for i, monitor in enumerate(source['sensors'][:4], 1):
            monitor['id'] = f'fsr{i}'  # Earlier standalone monitor IDs.
        source['targets'][0]['device'] = 'COM99'
        source['sensors'][0]['name'] = 'My edited rug sensor'
        source['sensors'][4]['rules'][0]['hold'] = 2.5
        original = deepcopy(source)
        merged, added = add_sensor_preset(source, 'all')
        self.assertEqual(len(merged['sensors']), 16)
        self.assertEqual(added['sensors'], 8)
        self.assertEqual(merged['targets'][0]['device'], 'COM99')
        self.assertEqual(merged['sensors'][:8], original['sensors'])
        self.assertEqual(source, original)
        validate_workspace(merged)

    def test_reuses_player_and_signal_by_key_without_changing_them(self):
        source = defaults()
        player = source['targets'][0]
        player['id'] = 'custom-player'
        player['host'], player['port'] = '127.0.0.1', 8420
        person = next(s for s in source['signals'] if s['key'] == 'person')
        person['id'], person['cooldown'] = 'custom-person', 7
        merged, _ = add_sensor_preset(source, 'all')
        self.assertEqual(len(merged['targets']), len(source['targets']) + 2)
        self.assertEqual(merged['signals'], source['signals'])
        for m in merged['sensors']:
            for r in m['rules']:
                self.assertEqual(r['targetId'], 'custom-player')
                self.assertEqual(r['signalId'], 'custom-person')

    def test_multiple_sources_do_not_mix_same_named_json_fields(self):
        merged, _ = add_sensor_preset(defaults(), 'all')
        engine = SensorEngine(lambda event: None, lambda body: self.fail('Rules are paused'))
        self.addCleanup(engine.close)
        engine.configure(validate_workspace(merged))
        radar = next(t for t in merged['targets'] if t['id'] == 'sen0610-serial')
        fsr = next(t for t in merged['targets'] if t['id'] == 'fsr-serial')
        for p in (radar, fsr):
            engine.connection_event(dict(direction='SYSTEM', target=p, status='open'))
        engine.feed(radar, b'{"distance":250,"near":0,"ready":1,"error":0}\n')
        data = dict(ready=0, calibrating=1, detected=0, error=2)
        for i in range(1, 5):
            data[f'raw{i}'], data[f'delta{i}'] = i*100, -i
        payload = (json.dumps(data)+'\n').encode()
        engine.feed(fsr, payload[:30])
        engine.feed(fsr, payload[30:])
        values = {m['id']: m['value'] for m in engine.snapshot()['monitors']}
        self.assertEqual(values['sen0610-ready'], 1)
        self.assertEqual(values['fsr-ready'], 0)
        self.assertEqual(values['fsr-raw4'], 400)
        self.assertEqual(values['fsr-delta1'], -1)
        self.assertFalse(engine.armed)

    def test_api_persists_presets_without_opening_ports_and_rejects_bad_input(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory)/'workspace.json')
            server = create_server(store, 0)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def call(body):
                req = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/sensors/preset',
                    data=json.dumps(body).encode(), headers={'Content-Type':'application/json','X-Tester-Token':server.token})
                with opener.open(req, timeout=5) as response:
                    return json.load(response)
            try:
                result = call({'preset':'all'})
                self.assertEqual(result['added']['sensors'], 16)
                self.assertFalse(result['sensors']['armed'])
                self.assertTrue(all(m['status']=='Source closed' for m in result['sensors']['monitors']))
                self.assertEqual(len(Store(store.file).snapshot()['sensors']), 16)
                before = store.snapshot()
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    call({'preset':'../../untrusted'})
                self.assertEqual(caught.exception.code, 400)
                self.assertEqual(before, store.snapshot())
                self.assertEqual(call({'preset':'all'})['added']['sensors'], 0)
            finally:
                server.shutdown(); server.server_close(); worker.join(5)


if __name__ == '__main__':
    unittest.main()
