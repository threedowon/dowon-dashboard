"""The window owns the local engine lifetime, including native X and UI exit."""
import threading


def run_window(server, url, webview_module=None):
    if webview_module is None:
        import webview as webview_module
    webview = webview_module
    webview.settings['ALLOW_DOWNLOADS'] = True
    webview.settings['ALLOW_FILE_URLS'] = False
    window = webview.create_window('Signal Tester', url, width=1440, height=940,
                                  min_size=(1000, 650), text_select=True, background_color='#f2f5f2')
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
        server.sensors.arm(False)
        server.shutdown()
    window.events.closing += close_engine
    def watch_engine():
        finished.wait()
        window.destroy()
    try:
        webview.start(watch_engine, gui='edgechromium', private_mode=True, debug=False)
    finally:
        close_engine()
        engine.join(timeout=10)
