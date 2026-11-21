"""No physical hardware: fragmented streams, deterministic rules and localhost routing."""
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
import urllib.request
from tester_sensors import Frames, parse_value, RuleState, SensorEngine
from signal_tester import Store, create_server, validate_workspace


def workspace():
    return {'version':1,'activeTarget':'player','targets':[
        {'id':'udp','name':'Distance','type':'udp','bindHost':'127.0.0.1','bindPort':0,'remoteHost':'127.0.0.1','remotePort':9000,'broadcast':False},
        {'id':'player','name':'Player','host':'127.0.0.1','port':8420}],
        'signals':[{'id':'near','name':'Near','key':'person','value':None,'cooldown':3,'shortcut':'KeyP'},
                   {'id':'far','name':'Far','key':'person_far','value':'gone','cooldown':3}],
        'sensors':[{'id':'distance','name':'Distance','sourceId':'udp','parser':'number','field':'','unit':'cm','staleSeconds':2,
            'rules':[{'id':'r1','op':'lt','threshold':100,'hysteresis':10,'hold':.2,'targetId':'player','signalId':'near','valueMode':'sensor','enabled':True}]}]}


def until(check):
    for _ in range(100):
        if check(): return
        time.sleep(.02)
    raise AssertionError('Timed out waiting for background output')


class SensorTests(unittest.TestCase):
    def test_repeat_hold_stop_and_reentry(self):
        r={**workspace()['sensors'][0]['rules'][0], 'hold':.5, 'repeatSeconds':1}
        s=RuleState()
        for value,now,expected in [(50,0,False),(50,.5,True),(50,1,False),
                                   (50,1.5,True),(101,2,False),(50,2.1,False),
                                   (50,2.6,True),(50,3,False),(50,3.6,True)]:
            self.assertEqual(s.sample(value,now,r),expected)
        s.reset_input()
        self.assertFalse(s.sample(50,8,r))
        self.assertTrue(s.sample(50,8.5,r))

    def test_repeat_validation(self):
        for bad in [-1,.01,True,float('nan'),3601,'1']:
            w=workspace();w['sensors'][0]['rules'][0]['repeatSeconds']=bad
            with self.assertRaises(ValueError):validate_workspace(w)
        w=workspace();w['sensors'][0]['rules'][0]['repeatSeconds']=1
        self.assertEqual(validate_workspace(w)['sensors'][0]['rules'][0]['repeatSeconds'],1)

    def test_repeat_engine_needs_fresh_data_and_stops_on_loss(self):
        engine,now,sent,logs,p=self.engine()
        w=workspace();w['sensors'][0]['rules'][0].update(hold=.2,repeatSeconds=1)
        engine.configure(w);engine.arm(True)
        engine.feed(p,b'50');now[0]=.2;engine.feed(p,b'50');until(lambda:len(sent)==1)
        now[0]=1.2;engine.feed(p,b'50');until(lambda:len(sent)==2)
        now[0]=2.2;engine.feed(p,b'101');time.sleep(.03);self.assertEqual(len(sent),2)
        now[0]=3;engine.feed(p,b'50');now[0]=3.2;engine.feed(p,b'50');until(lambda:len(sent)==3)
        now[0]=7;time.sleep(.03);self.assertEqual(len(sent),3)
        engine.feed(p,b'50');self.assertEqual(len(sent),3)
        now[0]=7.2;engine.feed(p,b'50');until(lambda:len(sent)==4)
        now[0]=8.2;engine.feed(p,b'invalid');time.sleep(.03);self.assertEqual(len(sent),4)
        engine.connection_event({'direction':'SYSTEM','target':p,'status':'closed'})
        now[0]=9.2;engine.feed(p,b'50');self.assertEqual(len(sent),4)

    def test_repeat_discards_waiting_job_after_detection_ends(self):
        started=threading.Event();release=threading.Event();sent=[]
        def output(payload):
            sent.append(payload);started.set();release.wait(2)
            return {'label':'OK','received':True}
        engine,now,_,logs,p=self.engine(output);self.addCleanup(release.set)
        w=workspace();r=w['sensors'][0]['rules'][0];r.update(hold=0,repeatSeconds=1)
        w['sensors'][0]['rules'].append({**r,'id':'r2'})
        engine.configure(w);engine.arm(True);engine.feed(p,b'50');self.assertTrue(started.wait(1))
        now[0]=1;engine.feed(p,b'50')
        self.assertLessEqual(len(engine.jobs),1)
        now[0]=1.1;engine.feed(p,b'110');release.set()
        time.sleep(.05);self.assertEqual(len(sent),1)
        self.assertEqual(len(engine.jobs),0)

    def test_default_rule_sends_immediately_without_rule_cooldown(self):
        w=workspace();rule=w['sensors'][0]['rules'][0]
        rule.pop('hold');rule['cooldown']=99
        rule=validate_workspace(w)['sensors'][0]['rules'][0]
        self.assertEqual(rule['hold'],0)
        self.assertNotIn('cooldown',rule)
        state=RuleState()
        self.assertTrue(state.sample(90,0,rule))
        self.assertFalse(state.sample(110,1,rule))
        self.assertTrue(state.sample(90,2.99,rule))
        self.assertFalse(state.sample(90,3,rule))
        self.assertFalse(state.sample(90,6,rule))

    def test_framing_fragmentation_overflow_and_json(self):
        f=Frames()
        self.assertEqual(f.read(b'12'),[])
        self.assertEqual(f.read(b'0\r\n13\n14\r'),[b'120',b'13',b'14'])
        self.assertEqual(f.read(b'5',True),[b'5'])
        bad=f.read(b'9'*5000+b'\n42\n')
        self.assertIsInstance(bad[0],ValueError);self.assertEqual(bad[1],b'42')
        self.assertEqual(parse_value(b'{"sensor":{"distance":12.5}}',{'parser':'json','field':'sensor.distance'}),12.5)
        for value in [b'NaN',b'Infinity',b'100cm',b'1 2',b'\xff',b'1e999']:
            with self.assertRaises(ValueError):parse_value(value,{'parser':'number'})
        for value in [b'{"d":true}',b'{"d":"10"}',b'{}',b'{"d":null}']:
            with self.assertRaises(ValueError):parse_value(value,{'parser':'json','field':'d'})

    def test_deep_json_is_a_parse_error_for_both_stream_and_datagram(self):
        nested = b'['*1100+b'0'+b']'*1100
        self.assertLess(len(nested), 4096)
        for datagram in (False, True):
            frames = Frames()
            if datagram:
                packets = frames.read(nested, True) + frames.read(b'{"value":42}', True)
            else:
                packets = frames.read(nested[:500]) + frames.read(nested[500:]+b'\n{"value":42}\n')
            with self.subTest(datagram=datagram):
                with self.assertRaises(ValueError):
                    parse_value(packets[0], {'parser':'json', 'field':'value'})
                self.assertEqual(parse_value(packets[1], {'parser':'json', 'field':'value'}), 42)

    def test_udp_keeps_receiving_after_deep_json(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory)/'workspace.json')
            config = workspace()
            config['sensors'][0].update(parser='json', field='value')
            store.save(config)
            server = create_server(store)
            try:
                profile = store.find_target('udp')
                server.hub.open(profile)
                port = int(server.hub.snapshot([profile])['udp']['local'].rsplit(':', 1)[1])
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
                    sender.sendto(b'{"value":42}', ('127.0.0.1', port))
                    until(lambda: server.sensors.snapshot()['monitors'][0]['samples'] == 1)
                    sender.sendto(b'['*1100+b'0'+b']'*1100, ('127.0.0.1', port))
                    until(lambda: server.sensors.snapshot()['monitors'][0]['errors'] == 1)
                    self.assertEqual(server.hub.snapshot([profile])['udp']['status'], 'open')
                    sender.sendto(b'{"value":43}', ('127.0.0.1', port))
                    until(lambda: server.sensors.snapshot()['monitors'][0]['samples'] == 2)
                monitor = server.sensors.snapshot()['monitors'][0]
                self.assertEqual(monitor['value'], 43)
                self.assertEqual(monitor['error'], '')
                self.assertTrue(monitor['live'])
            finally:
                server.server_close()

    def test_hold_hysteresis_and_edge_latch(self):
        r=workspace()['sensors'][0]['rules'][0];s=RuleState()
        self.assertFalse(s.sample(99,0,r));self.assertFalse(s.sample(101,.1,r))
        self.assertFalse(s.sample(90,.2,r));self.assertTrue(s.sample(95,.4,r))
        for t,v in [(1,95),(2,101),(3,109)]:self.assertFalse(s.sample(v,t,r))
        self.assertFalse(s.sample(110,3.1,r));self.assertFalse(s.sample(90,3.2,r));self.assertTrue(s.sample(90,3.4,r))
        s.sample(110,3.5,r);s.sample(90,3.6,r);self.assertTrue(s.sample(90,3.9,r));self.assertFalse(s.sample(90,4.5,r))
        above={**r,'op':'gt','threshold':150,'hold':0};s=RuleState()
        self.assertTrue(s.sample(151,0,above));self.assertFalse(s.sample(145,1,above));s.sample(140,2,above);self.assertTrue(s.sample(151,3,above))

    def test_workspace_compatibility_and_binding_validation(self):
        w=workspace();self.assertEqual(validate_workspace(w),w)
        w['signals'][1]['shortcut']='KeyP'
        with self.assertRaisesRegex(ValueError,'already assigned'):validate_workspace(w)
        w['signals'][1]['shortcut']='ControlLeft'
        with self.assertRaisesRegex(ValueError,'supported'):validate_workspace(w)
        w=workspace();w['sensors'][0]['rules'][0]['threshold']=float('nan')
        with self.assertRaises(ValueError):validate_workspace(w)
        w=workspace();w['sensors'][0]['rules'][0]['targetId']='udp'
        with self.assertRaisesRegex(ValueError,'HTTP'):validate_workspace(w)
        w=workspace();w.pop('sensors');[s.pop('shortcut',None) for s in w['signals']]
        self.assertEqual(validate_workspace(w),w)
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d)/'workspace.json');store.save(workspace());self.assertEqual(Store(store.file).snapshot(),workspace())

    def engine(self,send=None):
        now=[0.];sent=[];logs=[]
        def output(p):sent.append(p);return {'label':'Scene changed','received':True}
        engine=SensorEngine(logs.append,send or output,clock=lambda:now[0]);engine.configure(workspace())
        profile=workspace()['targets'][0]
        engine.connection_event({'direction':'SYSTEM','target':profile,'status':'open'})
        self.addCleanup(engine.close)
        return engine,now,sent,logs,profile

    def test_preview_then_armed_output_and_config_changes(self):
        engine,now,sent,logs,p=self.engine()
        engine.feed(p,b'50');now[0]=.3;engine.feed(p,b'50');self.assertEqual(sent,[])
        engine.arm(True);now[0]=1;engine.feed(p,b'50');now[0]=1.3;engine.feed(p,b'51')
        until(lambda:len(sent)==1);self.assertEqual((sent[0]['key'],sent[0]['value']),('person',51))
        w=workspace();w['activeTarget']='udp';engine.configure(w);self.assertTrue(engine.armed)
        w['sensors'][0]['rules'][0]['threshold']=80;engine.configure(w);self.assertFalse(engine.armed)
        self.assertEqual(engine.snapshot()['monitors'][0]['samples'],0)

    def test_signal_cooldown_retries_only_on_fresh_matching_data(self):
        attempts=[]
        def output(payload):
            attempts.append(payload)
            if len(attempts)==1:
                return {'label':'Signal cooldown','received':False,'stage':'cooldown','remaining':3}
            return {'label':'Scene changed','received':True}
        engine,now,_,logs,p=self.engine(output)
        w=workspace();w['sensors'][0]['rules'][0]['hold']=0
        engine.configure(w);engine.arm(True);engine.feed(p,b'50')
        until(lambda:engine.snapshot()['monitors'][0]['rules'][0]['status'].startswith('Signal cooldown'))
        for t in [1,2,2.99]:
            now[0]=t;engine.feed(p,b'50')
        self.assertEqual(len(attempts),1)
        now[0]=3
        self.assertEqual(len(attempts),1)
        engine.feed(p,b'50');until(lambda:len(attempts)==2)
        now[0]=4;engine.feed(p,b'50')
        self.assertEqual(len(attempts),2)

    def test_stale_data_parse_error_disconnect_and_deleted_refs(self):
        engine,now,sent,logs,p=self.engine();engine.arm(True)
        engine.feed(p,b'50');now[0]=3;self.assertEqual(engine.snapshot()['monitors'][0]['status'],'Data timeout')
        engine.feed(p,b'50');self.assertEqual(sent,[])
        now[0]=3.1;engine.feed(p,b'invalid');now[0]=3.2;engine.feed(p,b'50');self.assertEqual(sent,[])
        now[0]=3.5;engine.feed(p,b'50');until(lambda:len(sent)==1)
        engine.connection_event({'direction':'SYSTEM','target':p,'status':'closed'})
        self.assertEqual(engine.snapshot()['monitors'][0]['status'],'Source closed')
        engine.feed(p,b'50');self.assertEqual(len(sent),1)
        self.assertTrue(any(e['stage']=='parse' for e in logs))
        w=workspace();w['signals']=[];engine.configure(w)
        with self.assertRaisesRegex(ValueError,'Signal deleted'):engine.arm(True)

    def test_stale_serial_fragment_does_not_prefix_next_measurement(self):
        engine,now,sent,logs,p=self.engine()
        p={**p,'type':'serial'}
        engine.feed(p,b'1')
        self.assertEqual(engine.snapshot()['monitors'][0]['status'],'Waiting for line ending')
        now[0]=3
        engine.feed(p,b'50\n')
        self.assertEqual(engine.snapshot()['monitors'][0]['value'],50)

    def test_pause_discards_queued_outputs_and_does_not_retry_failure(self):
        started=threading.Event();release=threading.Event();sent=[]
        def output(p):sent.append(p);started.set();release.wait(2);return {'label':'Connection refused','received':False}
        engine,now,_,logs,p=self.engine(output)
        self.addCleanup(release.set)
        w=workspace();r=w['sensors'][0]['rules'][0];r['hold']=0
        w['sensors'][0]['rules'].append({**r,'id':'r2','signalId':'far'})
        engine.configure(w);engine.arm(True);engine.feed(p,b'50');self.assertTrue(started.wait(1))
        engine.arm(False);release.set();time.sleep(.05);self.assertEqual(len(sent),1)
        engine.arm(True);engine.feed(p,b'50');until(lambda:len(sent)==3)
        for _ in range(100):engine.feed(p,b'50')
        time.sleep(.05);self.assertEqual(len(sent),3)
        self.assertFalse(engine.snapshot()['monitors'][0]['rules'][0]['lastOK'])

    def test_udp_to_real_http_routing_and_saved_value(self):
        received=[]
        class Receiver(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                body=b'{"ok":true,"status":"transitioned"}'
                self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        receiver=ThreadingHTTPServer(('127.0.0.1',0),Receiver);threading.Thread(target=receiver.serve_forever,daemon=True).start()
        self.addCleanup(receiver.server_close);self.addCleanup(receiver.shutdown)
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d)/'workspace.json');w=workspace();w['targets'][1]['port']=receiver.server_port
            r=w['sensors'][0]['rules'][0];r.update(hold=0,signalId='far',valueMode='saved');store.save(w)
            server=create_server(store);threading.Thread(target=server.serve_forever,daemon=True).start()
            try:
                def call(route,body=None):
                    req=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/'+route,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Tester-Token':server.token})
                    with urllib.request.urlopen(req) as response:return json.load(response)
                state=call('io/open',{'targetId':'udp'});port=int(state['connections']['udp']['local'].split(':')[-1]);call('sensors/arm',{'enabled':True})
                with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sock:sock.sendto(b'70',('127.0.0.1',port))
                until(lambda:bool(received));self.assertEqual(received,[{'key':'person_far','value':'gone'}])
                until(lambda:any(e.get('origin')=='Sensor · Distance' for e in store.events))
                live=call('live?monitor=distance');self.assertTrue(live['sensors']['armed']);self.assertEqual(live['sensors']['monitors'][0]['value'],70)
                call('sensors/arm',{'enabled':False});self.assertFalse(call('state')['sensors']['armed'])
            finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()
