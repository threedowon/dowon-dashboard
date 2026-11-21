"""Run with: python -m unittest test_signal_tester -v (only isolated test ports)."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

import signal_tester as tester


class SignalTesterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='signal-tester-test-')
        self.store = tester.Store(Path(self.temp.name)/'workspace.json')

    def tearDown(self):
        self.temp.cleanup()

    def test_signal_cooldown_shared_across_sources_and_targets(self):
        data=self.store.snapshot()
        self.assertEqual(data['signals'][0]['cooldown'],3)
        data['targets'].append({**data['targets'][0],'id':'second'})
        self.store.save(data)
        body={'targetId':data['targets'][0]['id'],'key':'person','value':1}
        with patch.object(tester.time,'monotonic',return_value=10) as clock, patch.object(tester,'request_receiver',return_value={'status':'transitioned'}) as send:
            self.assertTrue(tester.perform_send(self.store,{**body,'origin':'Keyboard'})['received'])
            clock.return_value=12.99
            blocked=tester.perform_send(self.store,{**body,'targetId':'second','origin':'Sensor'})
            self.assertEqual(blocked['stage'],'cooldown')
            self.assertFalse(blocked['received'])
            self.assertEqual(send.call_count,1)
            self.assertTrue(tester.perform_send(self.store,{**body,'key':'person_far'})['received'])
            clock.return_value=13
            self.assertTrue(tester.perform_send(self.store,body)['received'])
            data['signals'][0]['cooldown']=0;self.store.save(data)
            self.assertTrue(tester.perform_send(self.store,body)['received'])

    def test_cooldown_reserves_before_concurrent_network_sends(self):
        data=self.store.snapshot();body={'targetId':data['targets'][0]['id'],'key':'person'}
        entered=threading.Event();release=threading.Event()
        def receiver(*args):
            entered.set();release.wait(3)
            return {'status':'transitioned'}
        with patch.object(tester,'request_receiver',side_effect=receiver) as send:
            worker=threading.Thread(target=tester.perform_send,args=(self.store,body));worker.start()
            try:
                self.assertTrue(entered.wait(2))
                self.assertEqual(tester.perform_send(self.store,body)['stage'],'cooldown')
                self.assertEqual(send.call_count,1)
            finally:
                release.set();worker.join(3)

    def test_cooldown_migration_and_validation(self):
        data=self.store.snapshot();data['signals'][0].pop('cooldown')
        self.assertEqual(self.store.save(data)['signals'][0]['cooldown'],3)
        for value in [-1,3601,True,'3',float('nan'),float('inf')]:
            data['signals'][0]['cooldown']=value
            with self.assertRaises(ValueError):self.store.save(data)

    def test_roundtrip_edit_delete_targets_and_keys(self):
        data=self.store.snapshot()
        data['targets'].append({'id':'second','name':'Player 2','host':'LOCALHOST','port':8421})
        data['signals'][0].update(name='Detect',key='PERSON',value=120)
        data['activeTarget']='second'
        saved=self.store.save(data)
        self.assertEqual(saved['targets'][1]['host'],'localhost')
        self.assertEqual(saved['signals'][0]['key'],'person')
        self.assertEqual(tester.Store(self.store.file).snapshot(),saved)
        saved['targets']=saved['targets'][:1];saved['signals']=[]
        self.store.save(saved)
        restored=tester.Store(self.store.file).snapshot()
        self.assertEqual(restored['activeTarget'],restored['targets'][0]['id'])
        self.assertEqual(restored['signals'],[])

    def test_scene_import_merges_and_preserves_values(self):
        data=self.store.snapshot();data['signals'][0]['value']=10;self.store.save(data)
        result=self.store.import_scene({'project':{'signals':[{'key':'PERSON','name':'New name'},{'key':'ready'}],
            'scenes':[{'conditions':[{'triggers':[{'type':'signal','key':'next'},{'type':'signal','key':'ready'}]}]}]}})
        self.assertEqual((result['added'],result['skipped']),(2,1))
        person=next(s for s in result['workspace']['signals'] if s['key']=='person')
        self.assertEqual(person['value'],10)
        self.assertEqual(self.store.import_scene({'scenes':[]})['added'],0)

    def test_invalid_import_preserves_workspace(self):
        before=self.store.snapshot()
        with self.assertRaises(ValueError):self.store.import_scene({'project':{'scenes':[],'signals':[{'key':'bad space'}]}})
        self.assertEqual(before,self.store.snapshot())

    def test_duplicate_and_invalid_workspace_rejected(self):
        for mutate in [lambda d:d['signals'].append(d['signals'][0].copy()), lambda d:d['targets'][0].update(port=0),
                       lambda d:d['targets'][0].update(port=True),lambda d:d.update(version=9)]:
            data=self.store.snapshot();mutate(data)
            with self.assertRaises(ValueError):self.store.save(data)
        self.assertFalse(self.store.file.exists())

    def test_host_validation(self):
        for raw in ['http://127.0.0.1','localhost/signal','localhost:8420','a..b','-test','test-','a@b','[::1]bad']:
            with self.subTest(raw=raw),self.assertRaises(ValueError):tester.normalize_host(raw)
        self.assertEqual(tester.normalize_host('[::1]'),'::1')
        self.assertEqual(tester.endpoint({'host':'::1','port':8420},'signal'),'http://[::1]:8420/signal')

    def test_value_validation(self):
        for val in [None,False,True,'한글',42,.5]:self.assertEqual(tester.validate_value(val),val)
        for val in [[],{},float('nan'),float('inf'),10**1000,'가'*3000]:
            with self.subTest(value_type=type(val)),self.assertRaises(ValueError):tester.validate_value(val)

    def test_corrupt_config_not_overwritten(self):
        self.store.file.write_text('{broken',encoding='utf8')
        broken=tester.Store(self.store.file)
        self.assertTrue(broken.warning)
        with self.assertRaises(ValueError):broken.save(tester.defaults())
        self.assertEqual(self.store.file.read_text(),'{broken')

    def test_receiver_and_api(self):
        self.assertIn('queued', tester.STATUS, 'Timeline Branch acknowledgement must be recognized')
        requests=[]
        class Receiver(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                body=b'{"ok":true,"service":"SceneCast Signal"}'
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests.append(body)
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
                self.wfile.write(json.dumps({'ok':True,'status':body['key'] if body['key'] in tester.STATUS else 'transitioned','from':'a','to':'b'}).encode())
        receiver=ThreadingHTTPServer(('127.0.0.1',0),Receiver)
        server=tester.create_server(self.store)
        for srv in [receiver,server]:threading.Thread(target=srv.serve_forever,daemon=True).start()
        target=self.store.snapshot()['targets'][0];target['port']=receiver.server_port
        data=self.store.snapshot();data['targets']=[target];self.store.save(data)
        url=f'http://127.0.0.1:{server.server_port}'
        def call(route,body=None,token=server.token,origin=None):
            headers={'X-Tester-Token':token,'Content-Type':'application/json'}
            if origin:headers['Origin']=origin
            req=urllib.request.Request(url+route,data=None if body is None else json.dumps(body).encode(),headers=headers)
            with urllib.request.urlopen(req,timeout=5) as res:return json.load(res)
        try:
            with urllib.request.urlopen(url) as res:
                self.assertIn(server.token.encode(),res.read())
                self.assertIn("frame-ancestors 'none'",res.headers['Content-Security-Policy'])
            self.assertTrue(call('/api/health',{'targetId':target['id']})['online'])
            self.assertEqual(requests,[],'Health checks never send Signals')
            for status in tester.STATUS:
                event=call('/api/send',{'targetId':target['id'],'key':status,'value':False})
                self.assertEqual(event['status'],status);self.assertTrue(event['received']);self.assertEqual(event['value'],False)
                if status == 'queued':
                    self.assertTrue(event['ok']);self.assertEqual(event['severity'], 'info')
                    self.assertEqual(event['label'], 'Waiting for timeline point')
            self.assertEqual(len(call('/api/state')['events']),len(tester.STATUS))
            call('/api/clear',{});self.assertEqual(call('/api/state')['events'],[])
            for bad_token,origin in [('bad',None),(server.token,'https://foreign.example')]:
                with self.assertRaises(urllib.error.HTTPError) as err:call('/api/send',{'targetId':target['id'],'key':'person'},bad_token,origin)
                self.assertEqual(err.exception.code,403)
                err.exception.close()
            with self.assertRaises(urllib.error.HTTPError) as err:call('/api/send',{'targetId':target['id'],'key':'bad space'})
            self.assertEqual(err.exception.code,400)
            err.exception.close()
            self.assertEqual(len(requests),len(tester.STATUS),'Invalid requests are never forwarded')
            receiver.shutdown();receiver.server_close()
            event=call('/api/send',{'targetId':target['id'],'key':'person'})
            self.assertFalse(event['received']);self.assertEqual(event['status'],'connection_error')
        finally:
            for srv in [receiver,server]:srv.shutdown();srv.server_close()


if __name__=='__main__':unittest.main()
