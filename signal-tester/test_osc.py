import json
import math
import socket
import struct
import time
import unittest
from tester_osc import decode_packet, OSCMonitor
import test_transports
from test_transports import udp_profile, wait_for
import test_dashboard_bridge


def string(value):
    raw=value.encode()+b'\0'
    return raw+b'\0'*((-len(raw))%4)


def message(address='/sensor/distance', value=1.84):
    return string(address)+string(',f')+struct.pack('>f',value)


def bundle(*packets):
    return b'#bundle\0'+struct.pack('>Q',1)+b''.join(struct.pack('>i',len(p))+p for p in packets)


class OSCParserTests(unittest.TestCase):
    def test_types_arrays_and_safe_json(self):
        packet=string('/test')+string(',ifsbTFNI[hd]')+struct.pack('>if',42,1.25)+string('hello')+struct.pack('>i',3)+b'abc\0'+struct.pack('>qd',2**60,2.5)
        row=decode_packet(packet)[0]
        self.assertEqual(row['types'],',ifsbTFNI[hd]')
        self.assertEqual([a['value'] for a in row['arguments'][:3]],[42,1.25,'hello'])
        self.assertEqual(row['arguments'][3]['value']['hex'],'61 62 63')
        self.assertEqual([a['value'] for a in row['arguments'][4:8]],[True,False,None,'Infinitum'])
        self.assertEqual(row['arguments'][8]['value'][0]['value'],str(2**60))
        self.assertIsInstance(json.dumps(decode_packet(message(value=math.inf)),allow_nan=False),str)

    def test_nested_bundle_and_atomic_rejection(self):
        rows=decode_packet(bundle(message('/a'),bundle(message('/b'))))
        self.assertEqual([r['address'] for r in rows],['/a','/b'])
        self.assertEqual(rows[1]['timetag'],'0000000000000001')
        monitor=OSCMonitor()
        result=monitor.receive(bundle(message('/a'),string('/bad')+string(',z')),1,'peer')
        self.assertIn('error',result)
        self.assertEqual(monitor.snapshot()['addresses'],[])

    def test_rejects_malformed_and_unsupported_packets(self):
        invalid=[b'/abc',message()[:-1],message()+b'junk',string('/a')+string(',x'),
                 string('/a')+string(',i'),string('/a')+string(',b')+struct.pack('>i',-1),
                 string('/a')+string(',['),string('/a')+string(',]'),
                 b'#bundle\0'+struct.pack('>Q',1)+struct.pack('>i',0)]
        packet=message()
        for _ in range(10):packet=bundle(packet)
        invalid.append(packet)
        for packet in invalid:
            with self.subTest(packet=packet[:20]),self.assertRaises(ValueError):decode_packet(packet)

    def test_history_limits_and_latest_value(self):
        monitor=OSCMonitor()
        self.assertIsNone(monitor.receive(b'plain UDP',1,'peer'))
        for i in range(140):monitor.receive(message('/x',i),i,'peer')
        snapshot=monitor.snapshot()['addresses'][0]
        self.assertEqual(snapshot['count'],140)
        self.assertEqual(snapshot['arguments'][0]['value'],139)
        self.assertNotIn('history',snapshot)
        self.assertEqual(len(monitor.detail('/x',0)['points']),120)
        self.assertEqual(monitor.detail('/x',1)['points'][-1][1],None)
        for i in range(140):monitor.receive(message('/addr/'+str(i)),i,'peer')
        self.assertEqual(len(monitor.snapshot()['addresses']),128)
        self.assertEqual(monitor.detail('/x',0)['points'],[])


class OSCTransportTests(unittest.TestCase):
    setUp = test_transports.TransportTests.setUp
    tearDown = test_transports.TransportTests.tearDown
    def test_udp_osc_and_raw_coexist_after_error(self):
        profile=udp_profile();self.hub.open(profile)
        port=int(self.hub.snapshot([profile])['udp']['local'].rsplit(':',1)[1])
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as peer:
            for packet in [message('/distance',2.5),b'plain text',string('/bad')+string(',z'),bundle(message('/near',1),message('/far',0))]:
                peer.sendto(packet,('127.0.0.1',port))
            wait_for(lambda:self.hub.snapshot([profile])['udp']['rxCount']==4)
        state=self.hub.snapshot([profile])['udp']
        self.assertEqual(state['status'],'open')
        self.assertEqual(state['osc']['errors'],1)
        self.assertEqual({r['address'] for r in state['osc']['addresses']},{'/distance','/near','/far'})
        self.assertEqual(self.hub.osc_detail('udp','/distance',0)['points'][0][1],2.5)
        rx=[e for e in self.store.activity()['events'] if e['direction']=='RX']
        self.assertTrue(any(e['packet'].get('osc',{}).get('error') for e in rx))
        self.assertTrue(any(e['packet']['text']=='plain text' for e in rx))


class OSCAPITests(unittest.TestCase):
    setUp = test_dashboard_bridge.DashboardBridgeTests.setUp
    tearDown = test_dashboard_bridge.DashboardBridgeTests.tearDown
    request = test_dashboard_bridge.DashboardBridgeTests.request
    api = test_dashboard_bridge.DashboardBridgeTests.api
    def test_osc_api_auth_assets_and_values(self):
        self.assertEqual(self.request(path='/api/osc')[0],403)
        self.assertEqual(self.api('osc?argument=-1')[0],400)
        _,state=self.api()
        settings=state['workspace'];settings['targets'].append(udp_profile())
        self.assertEqual(self.api('workspace',{**settings,'revision':state['revision']})[0],200)
        _,runtime=self.api('io/open',{'targetId':'udp'})
        port=int(runtime['connections']['udp']['local'].rsplit(':',1)[1])
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as peer:peer.sendto(message(value=2.5),('127.0.0.1',port))
        wait_for(lambda:self.api()[1]['connections']['udp']['rxCount']==1)
        status,data=self.api('osc?target=udp&address=%2Fsensor%2Fdistance&argument=0')
        self.assertEqual(status,200);self.assertEqual(data['points'][0][1],2.5)
        for path in ['/workbench.js','/workbench.css']:
            self.assertEqual(self.request(path=path)[0],200)


if __name__=='__main__':unittest.main()
