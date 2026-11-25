"""Standalone Windows entry point. The embedded engine serves its own browser UI."""
from pathlib import Path
import subprocess
import sys
import os
import logging
from logging.handlers import RotatingFileHandler

from tester_launcher import BASE, launch


def main():
    # A windowed EXE has no stdout/stderr. Keep bounded diagnostic logs on this PC.
    if getattr(sys, 'frozen', False):
        folder = Path(os.environ['LOCALAPPDATA'])/'SignalTester'/'logs'
        folder.mkdir(parents=True, exist_ok=True)
        log = logging.getLogger('signal-tester')
        handler = RotatingFileHandler(folder/'desktop.log', maxBytes=1000000, backupCount=2, encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        class LogStream:
            def write(self, text):
                if text.strip(): log.info(text.rstrip())
            def flush(self): pass
            def isatty(self): return False
        sys.stdout = sys.stderr = LogStream()
    args = sys.argv[1:]
    try:
        if args[:1] == ['--apply-update'] and len(args) == 2:
            from tester_update import apply_update
            return apply_update(args[1])
        if args[:1] == ['--tester-engine']:
            from signal_tester import main as run_engine
            if '--dashboard' not in args and '--web-ui' not in args:
                args.append('--web-ui')
            run_engine(['--desktop', *args[1:]], native=True)
            return 0
        executable = Path(sys.executable).resolve() if getattr(sys, 'frozen', False) else None
        # Extraction directories change each run; identify the installed EXE instead.
        return launch(['--desktop', *args], base=executable or BASE, executable=executable)
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        print(f'Could not start Signal Tester: {error}', file=sys.stderr, flush=True)
        if '--no-browser' not in args:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, 'Signal Tester를 시작하지 못했습니다.\n'+str(error)+'\n\n진단 로그: %LOCALAPPDATA%\\SignalTester\\logs', 'Signal Tester', 0x10)
        return 1


if __name__ == '__main__':
    sys.exit(main())
