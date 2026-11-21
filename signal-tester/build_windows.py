"""Build the distributable with an isolated Python environment on Windows."""
from pathlib import Path
import os
import subprocess
import venv

ROOT = Path(__file__).resolve().parent


def main():
    if os.name != 'nt':
        raise SystemExit('Build SignalTester.exe on Windows with Python 3.10 or newer.')
    environment = ROOT / '.build-venv'
    venv.EnvBuilder(with_pip=True).create(environment)
    python = environment / 'Scripts' / 'python.exe'
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'requirements-build.txt')], check=True)
    subprocess.run([str(python), '-m', 'PyInstaller', '--clean', '--noconfirm',
                    '--workpath', str(ROOT / '.build-work'), str(ROOT / 'SignalTester.spec')], cwd=ROOT, check=True)
    print(f'Ready: {ROOT / "dist" / "SignalTester.exe"}')


if __name__ == '__main__':
    main()
