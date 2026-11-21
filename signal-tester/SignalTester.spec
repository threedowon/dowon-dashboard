# Build from this directory with: python -m PyInstaller --clean --noconfirm SignalTester.spec
from pathlib import Path

root = Path(SPECPATH)
a = Analysis(
    [str(root / 'tester_desktop.py')],
    pathex=[str(root)],
    binaries=[],
    datas=[(str(root / 'signal_tester_ui'), 'signal_tester_ui'),
           (str(root / 'presets'), 'presets')],
    hiddenimports=['serial.tools.list_ports_windows', 'serial.urlhandler.protocol_loop'],
    hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [], name='SignalTester',
    debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
    console=True, disable_windowed_traceback=False,
)
