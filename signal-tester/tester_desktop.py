"""Standalone Windows entry point. The embedded engine serves its own browser UI."""
from pathlib import Path
import subprocess
import sys

from tester_launcher import BASE, launch


def main():
    args = sys.argv[1:]
    if args[:1] == ['--tester-engine']:
        from signal_tester import main as run_engine
        run_engine(['--desktop', *args[1:]])
        return 0
    try:
        executable = Path(sys.executable).resolve() if getattr(sys, 'frozen', False) else None
        # Extraction directories change each run; identify the installed EXE instead.
        return launch(['--desktop', *args], base=executable or BASE, executable=executable)
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'Could not start Signal Tester: {error}', file=sys.stderr, flush=True)
        if '--no-browser' not in args and sys.stdin.isatty():
            input('Press Enter to close...')
        return 1


if __name__ == '__main__':
    sys.exit(main())
