"""Exercise the installer with mocked downloads/process launch, never a real EXE."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.name == 'nt', 'Windows launcher')
class SharedLauncherTests(unittest.TestCase):
    def test_verified_first_install_then_reuse_with_workspace(self):
        launcher = Path(__file__).with_name('Start-Shared-Tester.ps1').resolve()
        with tempfile.TemporaryDirectory(prefix='shared-launcher-') as folder:
            script = r"""
$ErrorActionPreference='Stop'
Import-Module Microsoft.PowerShell.Utility
$stats=@{launches=0;downloads=0}
$payload=[Text.Encoding]::UTF8.GetBytes('test placeholder, not an executable')
$hash=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($payload))).Replace('-','').ToLower()
function Invoke-RestMethod {
    return @{tag_name='signal-tester-v1.4.0';assets=@(@{name='SignalTester.exe';digest=('sha256:'+$hash);browser_download_url='https://github.com/threedowon/dowon-dashboard/releases/download/signal-tester-v1.4.0/SignalTester.exe'})}
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing,$Uri,$OutFile)
    $stats.downloads++
    [IO.File]::WriteAllBytes($OutFile,$payload)
}
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle)
    if($WindowStyle -ne 'Hidden' -or $ArgumentList[0] -ne '--web-ui' -or $ArgumentList[1] -ne '--config' -or $ArgumentList[2] -ne ('"'+$env:LOCALAPPDATA+'\settings with spaces.json"')) { throw 'Incorrect launch arguments' }
    $stats.launches++
}
& $env:TEST_LAUNCHER -WorkspacePath (Join-Path $env:LOCALAPPDATA 'settings with spaces.json')
& $env:TEST_LAUNCHER -WorkspacePath (Join-Path $env:LOCALAPPDATA 'settings with spaces.json')
if($stats.downloads -ne 1 -or $stats.launches -ne 2) { throw 'Shared reuse failed' }
"""
            environment = dict(os.environ, LOCALAPPDATA=folder, TEST_LAUNCHER=str(launcher))
            # Windows PowerShell must discover its own modules, not inherit pwsh's paths.
            environment.pop('PSModulePath', None)
            result = subprocess.run(['powershell', '-NoProfile', '-Command', script],
                env=environment,
                capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual((Path(folder)/'SignalTester/shared/SignalTester.exe').read_bytes(),
                             b'test placeholder, not an executable')
