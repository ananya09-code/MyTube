@echo off
rem ---------------------------------------------------------------
rem  Native messaging launcher for mytube.
rem  Chrome needs a real executable path, so this wrapper runs host.py.
rem  Nothing is echoed: stdout must contain only protocol messages.
rem ---------------------------------------------------------------
setlocal
rem run from this script's own folder so host.py is always found
cd /d "%~dp0"

where py >nul 2>&1
if %errorlevel%==0 (
  py -3 "%~dp0host.py"
  goto :eof
)

where python >nul 2>&1
if %errorlevel%==0 (
  python "%~dp0host.py"
  goto :eof
)

rem No Python found: write the reason to the log and exit non-zero.
>>"%~dp0host.log" echo [%DATE% %TIME%] ERROR: neither "py -3" nor "python" was found in PATH.
exit /b 1
