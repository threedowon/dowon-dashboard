import threading
import unittest
from types import SimpleNamespace
from tester_window import run_window


class Event:
    def __init__(self):self.handlers=[]
    def __iadd__(self, handler):self.handlers.append(handler);return self
    def fire(self):
        for handler in self.handlers:handler()


class WindowTests(unittest.TestCase):
    def test_native_close_and_in_app_exit_both_stop_the_engine(self):
        for mode in ('native-close','api-exit'):
            with self.subTest(mode=mode):
                stopped=threading.Event();destroyed=threading.Event();armed=[]
                server=SimpleNamespace(sensors=SimpleNamespace(arm=armed.append),
                    serve_forever=lambda **kw:stopped.wait(3),shutdown=stopped.set)
                closing=Event()
                def destroy():destroyed.set();closing.fire()
                window=SimpleNamespace(events=SimpleNamespace(closing=closing),destroy=destroy)
                def start(watch,**options):
                    self.assertEqual(options['gui'],'edgechromium')
                    thread=threading.Thread(target=watch);thread.start()
                    if mode=='native-close':closing.fire()
                    else:server.shutdown()
                    self.assertTrue(destroyed.wait(2));thread.join(2)
                webview=SimpleNamespace(settings={},create_window=lambda *a,**kw:window,start=start)
                run_window(server,'http://127.0.0.1:1234/',webview)
                self.assertTrue(stopped.is_set());self.assertIn(False,armed)
                self.assertFalse(webview.settings['ALLOW_FILE_URLS'])


if __name__=='__main__':unittest.main()
