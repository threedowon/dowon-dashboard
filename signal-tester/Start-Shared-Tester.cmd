@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Shared-Tester.ps1" %*
if errorlevel 1 pause
endlocal
