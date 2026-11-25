import json
from pathlib import Path
import socket
import struct
import tempfile
import threading
import time
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from signal_tester import Store, create_server, validate_workspace
from tester_osc_routing import decode_packet, validate_osc, OscBridge


def string(value):
    data = value.encode()+b'\0'
    return data+b'\0'*((-len(data)) % 4)


def packet(value=1):
    return string('/sensor/person')+string(',i')+struct.pack('>i', value)


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]


def wait_for(predicate):
    for _ in range(100):
        if predicate():
            return
        time.sleep(.03)
    raise AssertionError('Timed out waiting for OSC delivery')


class OscTests(unittest.TestCase):
    def test_parser(self):
        self.assertEqual(decode_packet(packet()), [('/sensor/person', [1])])
        data = string('/mixed')+string(',ifsTFN')+struct.pack('>if', 2, 1.5)+string('hello')
        self.assertEqual(decode_packet(data), [('/mixed', [2, 1.5, 'hello', True, False, None])])
        bundle = b'#bundle\0'+struct.pack('>Q', 1)+struct.pack('>I', len(data))+data
        self.assertEqual(decode_packet(bundle), decode_packet(data))
        for invalid in [b'garbage', packet()[:-1], b'#bundle\0'+struct.pack('>Q', 1234), string('/bad')+string(',b')]:
            with self.assertRaises(ValueError):
                decode_packet(invalid)

    def test_end_to_end_saved_background_delivery(self):
        received = []
        class Receiver(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                data = b'{"ok":true,"status":"transitioned","from":"idle","to":"next"}'
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        player = ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
        thread = threading.Thread(target=player.serve_forever, daemon=True); thread.start()
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder)/'workspace.json')
            work = store.snapshot(); work['targets'][0]['port'] = player.server_port
            work['signals'][0].update(cooldown=0, value='detected')
            port = free_port()
            work['osc'] = dict(enabled=True, host='127.0.0.1', port=port, rules=[dict(id='r', address='/sensor/person', operator='eq', value=1, cooldown=.3, targetId=work['targets'][0]['id'], signalId=work['signals'][0]['id'])])
            store.save(work)
            server = create_server(store)
            server_thread=threading.Thread(target=server.serve_forever,daemon=True);server_thread.start()
            def enable():
                self.assertEqual(server.osc.snapshot()['state'], 'stopped')
                payload={'config':work['osc'],'revision':store.revision}
                request=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/osc-routing',data=json.dumps(payload).encode(),headers={'X-Tester-Token':server.token,'Content-Type':'application/json'})
                with urllib.request.urlopen(request) as response:self.assertEqual(response.status,200)
                # A stale tab must not overwrite newer workspace changes.
                with self.assertRaises(urllib.error.HTTPError) as conflict:
                    urllib.request.urlopen(request)
                self.assertEqual(conflict.exception.code, 409)
                conflict.exception.close()
            try:
                enable()
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
                    sender.sendto(packet(0), ('127.0.0.1', port)); time.sleep(.1); self.assertFalse(received)
                    sender.sendto(b'invalid', ('127.0.0.1', port))
                    sender.sendto(packet(), ('127.0.0.1', port)); wait_for(lambda: len(received)==1)
                    self.assertEqual(received[0], {'key': 'person', 'value': 'detected'})
                    sender.sendto(packet(), ('127.0.0.1', port)); time.sleep(.1); self.assertEqual(len(received), 1)
                    wait_for(lambda: any(e['stage']=='tx' for e in server.osc.snapshot()['logs']))
                    self.assertTrue(any(e['stage']=='invalid' for e in server.osc.snapshot()['logs']))
                # Restart preserves mappings but waits for explicit enable.
                server.shutdown();server.server_close();server_thread.join(); store = Store(store.file); server = create_server(store)
                server_thread=threading.Thread(target=server.serve_forever,daemon=True);server_thread.start();enable()
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
                    sender.sendto(packet(), ('127.0.0.1', port)); wait_for(lambda: len(received)==2)
                stopped=store.snapshot(); stopped['osc']['enabled']=False;server.osc.configure(stopped)
                self.assertEqual(server.osc.snapshot()['state'], 'stopped')
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.bind(('127.0.0.1', port))
            finally:
                server.shutdown();server.server_close();server_thread.join(); player.shutdown(); player.server_close(); thread.join()

    def test_bad_mappings_and_port_conflict(self):
        with tempfile.TemporaryDirectory() as folder:
            work=Store(Path(folder)/'config.json').snapshot()
            work['osc']={'enabled':True,'host':'127.0.0.1','port':free_port(),'rules':[]}
            with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as occupied:
                occupied.bind(('127.0.0.1',work['osc']['port']))
                bridge=OscBridge(lambda *_: None)
                try:
                    bridge.configure(work);self.assertEqual(bridge.snapshot()['state'],'error')
                finally:
                    bridge.close()
            work['osc']['rules']=[{'id':'r','address':'/person','targetId':'missing','signalId':'missing'}]
            with self.assertRaises(ValueError):
                validate_workspace(work)


if __name__ == '__main__':
    unittest.main()
