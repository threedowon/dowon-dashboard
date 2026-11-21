@echo off
setlocal
cd /d "%~dp0"
title Signal Tester
set "SIGNAL_PYTHON="
for /d %%D in ("%LOCALAPPDATA%\Python\pythoncore-*") do if exist "%%~D\python.exe" set "SIGNAL_PYTHON=%%~D\python.exe"
if defined SIGNAL_PYTHON goto run_path
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%~D\python.exe" set "SIGNAL_PYTHON=%%~D\python.exe"
if defined SIGNAL_PYTHON goto run_path
python --version >nul 2>&1
if not errorlevel 1 goto run_python
py -3 --version >nul 2>&1
if not errorlevel 1 goto run_py
echo Python 3.10 or newer is required. Install Python, then run this file again.
pause
exit /b 1
:run_path
"%SIGNAL_PYTHON%" "%~dp0tester_launcher.py" --dashboard %*
goto finished
:run_py
py -3 "%~dp0tester_launcher.py" --dashboard %*
goto finished
:run_python
python "%~dp0tester_launcher.py" --dashboard %*
:finished
if errorlevel 1 pause
endlocal
