import time
import unittest
from signal_tester import target
from tester_dmx import frame, settings
from tester_transports import TransportHub

class FakePort:
    in_waiting = 0
    def __init__(self, **kwargs): self.writes=[]; self.closed=False; self.short=False
    def read(self,n): time.sleep(.01); return b''
    def write(self,data):
        if self.short:return 1
        self.writes.append(data);return len(data)
    def close(self):self.closed=True

class DmxTests(unittest.TestCase):
    def profile(self, **extra):return target(dict(id='dmx',name='Lights',type='enttec',device='COM901',**extra))
    def test_packet_and_fixture_isolation(self):
        packet=frame(self.profile(),dict(brightness=100,mix=25,on=[True,False,True,False]))
        self.assertEqual(len(packet),518)
        self.assertEqual(packet[:5],b'\x7e\x06\x01\x02\x00')
        self.assertEqual(packet[5:13],bytes([191,64,0,0,191,64,0,0]))
        self.assertEqual(packet[13:-1],bytes(504));self.assertEqual(packet[-1],231)
    def test_last_address_and_order(self):
        p=frame(self.profile(startAddress=505,channelOrder='cw-ww'),dict(brightness=100,mix=0,on=[False,False,False,True]))
        self.assertEqual(p[-3:-1],bytes([0,255]))
        for x in [0,506,True]:
            with self.assertRaises(ValueError):self.profile(startAddress=x)
        for x in [{'on':[True]}, {'mix':101}, {'brightness':True}]:
            with self.assertRaises(ValueError):settings(x)
    def test_lifecycle_and_partial_write(self):
        events=[]
        def emit(e):events.append(e);return e
        hub=TransportHub(emit,serial_factory=FakePort,port_provider=lambda:[])
        p=self.profile()
        try:
            hub.open(p);port=hub.sessions['dmx'].handle
            self.assertEqual(port.writes[0][4:-1],bytes(513))
            self.assertTrue(hub.send(p,dict(on=[True]*4))['ok'])
            self.assertEqual(hub.snapshot([p])['dmx']['dmx']['on'],[True]*4)
            port.short=True
            self.assertFalse(hub.send(p,dict(on=[False]*4))['ok'])
            self.assertEqual(hub.snapshot([p])['dmx']['dmx']['on'],[True]*4)
            port.short=False
            hub.disconnect('dmx');self.assertEqual(port.writes[-1][4:-1],bytes(513));self.assertTrue(port.closed)
            self.assertFalse(hub.send(p,dict(on=[True]*4))['ok'])
        finally:hub.close()

if __name__=='__main__':unittest.main()
