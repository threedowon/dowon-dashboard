import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from signal_tester import Store, create_server, perform_send


class DebugTests(unittest.TestCase):
    def test_signal_results_survive_sensor_bursts_and_distinguish_local_from_player_cooldown(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(Path(directory)/'workspace.json')
            target=store.snapshot()['targets'][0]
            with patch('signal_tester.request_receiver',return_value={'ok':True,'status':'cooldown'}) as receiver:
                acknowledged=perform_send(store,{'targetId':target['id'],'key':'person','value':1,'origin':'Sensor · FSR'})
                blocked=perform_send(store,{'targetId':target['id'],'key':'person','value':1})
                self.assertEqual(receiver.call_count,1)
            with patch('signal_tester.request_receiver',side_effect=TimeoutError()):
                failed=perform_send(store,{'targetId':target['id'],'key':'person_far','value':0})
            for i in range(700):
                store.emit({'protocol':'serial','direction':'RX','stage':'receive','ok':True,
                            'target':{'id':'sensor','name':'FSR'},'packet':{'text':str(i)}})
            data=store.debug.snapshot()
            self.assertEqual(len(data['events']),203)
            self.assertEqual(data['counts']['received'],700)
            self.assertEqual(data['counts']['acknowledged'],1)
            self.assertEqual(data['counts']['blocked'],1)
            self.assertEqual(data['counts']['unconfirmed'],1)
            self.assertTrue({acknowledged['id'],blocked['id'],failed['id']}.issubset({e['id'] for e in data['events']}))
            self.assertEqual(data['watched']['person_far']['last']['status'],'timeout')
            data['watched']['person']['last']['key']='mutated'
            self.assertEqual(store.debug.snapshot()['watched']['person']['last']['key'],'person')
            store.debug.clear();self.assertEqual(store.debug.snapshot()['counts']['received'],0)

    def test_debug_http_is_authenticated_and_does_not_send_or_open_connections(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(Path(directory)/'workspace.json');server=create_server(store)
            worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
            def get(path,token=None):
                return urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{server.server_port}'+path,
                    headers={'X-Tester-Token':token or ''}),timeout=3)
            try:
                for token in (None,'wrong'):
                    with self.assertRaises(urllib.error.HTTPError) as caught:get('/api/debug',token)
                    self.assertEqual(caught.exception.code,403);caught.exception.close()
                with patch('signal_tester.request_receiver') as send,patch.object(server.hub,'open') as opened:
                    with get('/api/debug',server.token) as response:data=json.load(response)
                    self.assertEqual(data['events'],[]);self.assertEqual(data['sensors'],[])
                    self.assertFalse(data['runtime']['armed']);send.assert_not_called();opened.assert_not_called()
                with get('/debug.html') as response:
                    self.assertIn(server.token,response.read().decode())
                with get('/debug.js') as response:self.assertIn(b'/api/debug',response.read())
            finally:
                server.shutdown();server.server_close();worker.join(3)
