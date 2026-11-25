@echo off
setlocal
cd /d "%~dp0"
title Signal Tester - Web
if not exist "%~dp0SignalTester.exe" (
  echo Put this CMD beside SignalTester.exe and run it again.
  pause
  exit /b 1
)
echo Starting Signal Tester at http://127.0.0.1:6699/
echo No Python or source code is required.
start "" "%~dp0SignalTester.exe" --no-browser --ui-port 6699
powershell -NoProfile -Command "$ready = $false; for ($i = 0; $i -lt 30; $i++) { try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:6699/' -TimeoutSec 1; if ($response.StatusCode -eq 200 -and $response.Content -match 'Signal Tester') { $ready = $true; break } } catch {}; Start-Sleep -Seconds 1 }; if ($ready) { Start-Process 'http://127.0.0.1:6699/'; exit 0 }; exit 1"
if errorlevel 1 (
  echo Could not open the tester. Try http://127.0.0.1:6699/ in your browser.
  echo Check that port 6699 is free. Diagnostic logs: %LOCALAPPDATA%\SignalTester\logs
  pause
  exit /b 1
)
echo Tester is running. Closing a browser tab does not stop communication.
endlocal
