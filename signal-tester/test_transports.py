"""Isolated transport checks; never open physical COM ports or exhibition Players."""
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
import urllib.request

from signal_tester import Store, target, create_server
from tester_transports import TransportHub, encode_payload, packet_preview
try:
    import serial
except ImportError:
    serial = None


def port_info(device='COM901'):
    return SimpleNamespace(device=device,description='Virtual test sensor',manufacturer='Test',serial_number='LOOP',vid=1,pid=2)


def serial_profile(**overrides):
    return target({'id':'serial','name':'Virtual sensor','type':'serial','device':'COM901','baudrate':115200,**overrides})


def udp_profile(**overrides):
    return target({'id':'udp','name':'UDP test','type':'udp','bindHost':'127.0.0.1','bindPort':0,'remoteHost':'127.0.0.1','remotePort':9001,**overrides})


def wait_for(check, timeout=3):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if check():return
        time.sleep(.015)
    raise AssertionError('Timed out waiting for receive / state update')


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='tester-transport-')
        self.store=Store(Path(self.temp.name)/'workspace.json')
        self.hub=TransportHub(self.store.emit,port_provider=lambda:[])

    def tearDown(self):
        self.hub.close();self.temp.cleanup()

    def test_text_hex_and_line_endings_are_exact(self):
        self.assertEqual(encode_payload({'data':'거리','format':'text','ending':'crlf'}),'거리\r\n'.encode())
        self.assertEqual(encode_payload({'data':'00 ff\n0D 0a','format':'hex'}),b'\0\xff\r\n')
        for body in [{'data':'A','format':'hex'},{'data':'GG','format':'hex'},{'data':'AA','format':'hex','ending':'lf'},
                     {'data':''},{'data':'x'*8193},{'data':'가'*3000},{'data':'x','format':'bad'}]:
            with self.subTest(body=str(body)[:80]),self.assertRaises(ValueError):encode_payload(body)

    def test_profiles_validate_and_roundtrip(self):
        data=self.store.snapshot();data['targets'] += [serial_profile(),udp_profile()]
        self.store.save(data);saved=Store(self.store.file).snapshot()
        self.assertEqual(saved['targets'][1]['device'],'COM901')
        self.assertEqual(saved['targets'][2]['bindPort'],0)
        self.assertNotIn('type',saved['targets'][0],'Legacy HTTP profiles retain their shape')
        for changes in [{'device':'socket://host:23'},{'baudrate':0},{'dataBits':9},{'parity':'X'},{'stopBits':True}]:
            with self.assertRaises(ValueError):serial_profile(**changes)
        for changes in [{'bindHost':'other-pc'},{'bindPort':-1},{'remotePort':0},{'broadcast':1},{'remoteHost':'::1'}]:
            with self.assertRaises(ValueError):udp_profile(**changes)

    def test_udp_receives_and_sends_from_bound_port(self):
        peer=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);peer.bind(('127.0.0.1',0));peer.settimeout(2)
        try:
            profile=udp_profile(remotePort=peer.getsockname()[1]);self.hub.open(profile)
            state=self.hub.snapshot([profile])['udp'];local_port=int(state['local'].rsplit(':',1)[1])
            sent=self.hub.send(profile,{'data':'ping','ending':'lf'})
            self.assertEqual(sent['status'],'sent');self.assertIn('not confirmed',sent['detail'])
            data,sender=peer.recvfrom(8192);self.assertEqual(data,b'ping\n');self.assertEqual(sender[1],local_port)
            peer.sendto(b'\x00\xffhello',sender)
            wait_for(lambda:self.hub.snapshot([profile])['udp']['rxCount']==1)
            state=self.hub.snapshot([profile])['udp'];self.assertEqual(state['rxBytes'],7);self.assertEqual(state['txBytes'],5)
            self.assertEqual(state['lastPacket']['hex'],'00 FF 68 65 6C 6C 6F');self.assertFalse(state['lastPacket']['utf8'])
            peer.sendto(b'',sender);wait_for(lambda:self.hub.snapshot([profile])['udp']['rxCount']==2)
            self.hub.disconnect('udp');self.assertEqual(self.hub.snapshot([profile])['udp']['status'],'closed')
            self.assertFalse(self.hub.send(profile,{'data':'after close'})['ok'])
        finally:peer.close()

    def test_udp_conflict_is_logged_at_open_stage(self):
        first=udp_profile();self.hub.open(first)
        port=int(self.hub.snapshot([first])['udp']['local'].rsplit(':',1)[1])
        second=udp_profile(id='second',bindPort=port);self.hub.open(second)
        state=self.hub.snapshot([second])['second'];self.assertEqual(state['status'],'error');self.assertEqual(state['error']['stage'],'open')
        self.assertEqual(state['error']['label'],'Local port already in use')
        event=self.store.activity()['events'][0];self.assertEqual(event['severity'],'error');self.assertEqual(event['protocol'],'udp')

    def test_edit_delete_reconcile_releases_socket(self):
        profile=udp_profile();self.hub.open(profile);state=self.hub.snapshot([profile])['udp'];port=int(state['local'].rsplit(':',1)[1])
        self.hub.reconcile([profile]);self.assertEqual(self.hub.snapshot([profile])['udp']['status'],'open')
        self.hub.reconcile([{**profile,'remotePort':9002}]);self.assertEqual(self.hub.snapshot([profile])['udp']['status'],'closed')
        probe=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        try:probe.bind(('127.0.0.1',port))
        finally:probe.close()
        self.hub.open(profile);self.hub.reconcile([]);self.assertNotIn('udp',self.hub.sessions)

    @unittest.skipUnless(serial,'pyserial is required for the virtual serial test')
    def test_real_pyserial_loopback_and_device_removal(self):
        ports=[port_info()]
        opened=[]
        def factory(port,**kwargs):
            opened.append(port);return serial.serial_for_url('loop://',**kwargs)
        self.hub.close();self.hub=TransportHub(self.store.emit,serial_factory=factory,port_provider=lambda:ports)
        self.hub.scan();self.assertEqual(opened,[],'Discovery never opens a port')
        profile=serial_profile();self.hub.open(profile)
        self.assertEqual(opened,['COM901']);self.assertTrue(self.hub.snapshot([profile])['serial']['detected'])
        event=self.hub.send(profile,{'data':'120\n','format':'text'})
        self.assertTrue(event['ok']);wait_for(lambda:self.hub.snapshot([profile])['serial']['rxBytes']==4)
        raw=b''.join(bytes.fromhex(e['packet']['hex']) for e in reversed(self.store.activity()['events']) if e['direction']=='RX')
        self.assertEqual(raw,b'120\n')
        second=serial_profile(id='other');self.hub.open(second)
        self.assertEqual(self.hub.snapshot([second])['other']['status'],'error')
        ports.clear();self.hub.scan();state=self.hub.snapshot([profile])['serial']
        self.assertFalse(state['detected']);self.assertEqual(state['status'],'error');self.assertEqual(state['error']['stage'],'receive')
        ports.append(port_info());self.hub.scan();self.hub.open(profile)
        self.assertEqual(self.hub.snapshot([profile])['serial']['status'],'open')

    def test_write_failure_shows_send_stage_and_can_recover(self):
        class FakeSerial:
            in_waiting=0
            fail=True
            def read(self,n):time.sleep(.02);return b''
            def close(self):pass
            def write(self,data):
                if self.fail:raise TimeoutError('write timed out')
                return len(data)
        fake=FakeSerial();self.hub.serial_factory=lambda **kw:fake
        profile=serial_profile();self.hub.open(profile)
        event=self.hub.send(profile,{'data':'test'});self.assertFalse(event['ok']);self.assertEqual(event['stage'],'send')
        self.assertEqual(self.hub.snapshot([profile])['serial']['error']['label'],'Write timed out')
        fake.fail=False;self.assertTrue(self.hub.send(profile,{'data':'test'})['ok'])
        self.assertIsNone(self.hub.snapshot([profile])['serial']['error'])

    def test_bounded_previews_and_incremental_logs(self):
        packet=packet_preview(b'X'*5000);self.assertTrue(packet['truncated']);self.assertEqual(packet['bytes'],5000);self.assertEqual(len(packet['text']),2048)
        for i in range(550):self.store.emit({'protocol':'udp','direction':'RX','ok':True,'label':str(i)})
        live=self.store.activity(0);self.assertEqual(len(live['events']),200);self.assertEqual(live['skipped'],350)
        self.assertEqual(live['cursor'],550);self.assertEqual(self.store.activity(550)['events'],[])
        self.assertEqual(len(self.store.events),500)

    def test_live_api_open_send_clear_and_shutdown(self):
        data=self.store.snapshot();profile=udp_profile();data['targets'].append(profile);self.store.save(data)
        server=create_server(self.store);threading.Thread(target=server.serve_forever,daemon=True).start()
        base=f'http://127.0.0.1:{server.server_port}'
        def call(route,body=None):
            request=urllib.request.Request(base+'/api/'+route,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json','X-Tester-Token':server.token})
            with urllib.request.urlopen(request,timeout=3) as response:return json.load(response)
        try:
            state=call('state');self.assertIn('serial',state);self.assertEqual(state['connections']['udp']['status'],'closed')
            opened=call('io/open',{'targetId':'udp'});self.assertEqual(opened['connections']['udp']['status'],'open')
            live=call('live?after=0');self.assertEqual(live['events'][0]['stage'],'open')
            cleared=call('clear',{});self.assertEqual(call('live?after='+str(cleared['cursor']))['events'],[])
            self.assertEqual(cleared['generation'],1)
            closed=call('io/close',{'targetId':'udp'});self.assertEqual(closed['connections']['udp']['status'],'closed')
        finally:server.shutdown();server.server_close()


if __name__=='__main__':unittest.main()
