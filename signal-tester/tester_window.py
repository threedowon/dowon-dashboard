"""The window owns the local engine lifetime, including native X and UI exit."""
import threading


def run_window(server, url, webview_module=None):
    if webview_module is None:
        import webview as webview_module
    webview = webview_module
    webview.settings['ALLOW_DOWNLOADS'] = True
    webview.settings['ALLOW_FILE_URLS'] = False
    debug_lock = threading.Lock()
    debug_window = None
    closing = threading.Event()
    class WindowAPI:
        def open_debug(self):
            nonlocal debug_window
            with debug_lock:
                if closing.is_set():
                    return False
                if debug_window is not None:
                    debug_window.restore()
                    debug_window.show()
                    return True
                debug_window = webview.create_window('Signal Tester · 송수신 디버깅',
                    url.rstrip('/')+'/debug.html', width=1200, height=820, min_size=(850, 580),
                    text_select=True, background_color='#f2f5f2')
                child = debug_window
                def closed():
                    nonlocal debug_window
                    with debug_lock:
                        if debug_window is child:
                            debug_window = None
                debug_window.events.closed += closed
                return True
    window = webview.create_window('Signal Tester', url, width=1440, height=940,
                                  min_size=(1000, 650), text_select=True, background_color='#f2f5f2', js_api=WindowAPI())
    server.ui_ready = False
    def loaded():
        server.ui_ready = True
    window.events.loaded += loaded
    finished = threading.Event()
    def serve():
        try:
            server.serve_forever(poll_interval=.2)
        finally:
            finished.set()
    engine = threading.Thread(target=serve, name='tester-http', daemon=True)
    engine.start()
    def close_engine():
        closing.set()
        server.sensors.arm(False)
        server.shutdown()
    window.events.closing += close_engine
    def watch_engine():
        finished.wait()
        closing.set()
        with debug_lock:
            child = debug_window
        if child is not None:
            child.destroy()
        window.destroy()
    try:
        webview.start(watch_engine, gui='edgechromium', private_mode=True, debug=False)
    finally:
        close_engine()
        engine.join(timeout=10)
