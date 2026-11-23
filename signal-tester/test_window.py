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
    def test_debug_window_is_reused_can_reopen_and_closes_with_engine(self):
        stopped=threading.Event();windows=[];api=None
        server=SimpleNamespace(sensors=SimpleNamespace(arm=lambda _:None),
            serve_forever=lambda **kw:stopped.wait(3),shutdown=stopped.set)
        def create(title,url,**options):
            nonlocal api
            events=SimpleNamespace(closing=Event(),closed=Event(),loaded=Event())
            window=SimpleNamespace(events=events,destroyed=False,shows=0)
            def destroy():window.destroyed=True;events.closing.fire();events.closed.fire()
            def show():window.shows+=1
            window.destroy=destroy;window.show=show;window.restore=lambda:None
            if 'js_api' in options:api=options['js_api']
            else:self.assertEqual(url,'http://127.0.0.1:1234/debug.html')
            windows.append(window);return window
        def start(watch,**options):
            self.assertTrue(api.open_debug());self.assertEqual(len(windows),2)
            api.open_debug();self.assertEqual(len(windows),2);self.assertEqual(windows[1].shows,1)
            windows[1].destroy();self.assertFalse(stopped.is_set())
            api.open_debug();self.assertEqual(len(windows),3)
            server.shutdown();watch()
            self.assertTrue(windows[0].destroyed);self.assertTrue(windows[2].destroyed)
            self.assertFalse(api.open_debug())
        run_window(server,'http://127.0.0.1:1234/',SimpleNamespace(settings={},create_window=create,start=start))

    def test_native_close_and_in_app_exit_both_stop_the_engine(self):
        for mode in ('native-close','api-exit'):
            with self.subTest(mode=mode):
                stopped=threading.Event();destroyed=threading.Event();armed=[]
                server=SimpleNamespace(sensors=SimpleNamespace(arm=armed.append),
                    serve_forever=lambda **kw:stopped.wait(3),shutdown=stopped.set)
                closing=Event();loaded=Event()
                def destroy():destroyed.set();closing.fire()
                window=SimpleNamespace(events=SimpleNamespace(closing=closing,loaded=loaded),destroy=destroy)
                def start(watch,**options):
                    self.assertEqual(options['gui'],'edgechromium')
                    self.assertFalse(server.ui_ready);loaded.fire();self.assertTrue(server.ui_ready)
                    thread=threading.Thread(target=watch);thread.start()
                    if mode=='native-close':closing.fire()
                    else:server.shutdown()
                    self.assertTrue(destroyed.wait(2));thread.join(2)
                webview=SimpleNamespace(settings={},create_window=lambda *a,**kw:window,start=start)
                run_window(server,'http://127.0.0.1:1234/',webview)
                self.assertTrue(stopped.is_set());self.assertIn(False,armed)
                self.assertFalse(webview.settings['ALLOW_FILE_URLS'])


if __name__=='__main__':unittest.main()
