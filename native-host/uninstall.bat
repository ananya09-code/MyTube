@echo off
setlocal enabledelayedexpansion
title Uninstall native helper - mytube

rem ===============================================================
rem  Removes the native messaging registration that install.bat made.
rem  HKCU only, so no administrator rights are needed.
rem ===============================================================

set "HOSTNAME_KEY=com.linkcollector.ytdlp"
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

echo.
echo Removing native helper registration...
echo.

call :DelKey "HKCU\Software\Google\Chrome\NativeMessagingHosts\!HOSTNAME_KEY!"           "Chrome"
call :DelKey "HKCU\Software\Chromium\NativeMessagingHosts\!HOSTNAME_KEY!"               "Chromium"
call :DelKey "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\!HOSTNAME_KEY!"          "Edge"

if exist "%HERE%\com.linkcollector.ytdlp.json" (
  del /q "%HERE%\com.linkcollector.ytdlp.json" >nul 2>&1
  echo   [OK]   removed the generated host manifest
)

echo.
echo Done. Restart your browser to make it forget the helper.
echo host.py and host.bat were left in place; delete the native-host folder to remove them.
echo.
pause
exit /b 0

rem ===============================================================
rem  Subroutines
rem ===============================================================

:DelKey
rem %1 = registry key, %2 = friendly browser name
reg query "%~1" >nul 2>&1
if errorlevel 1 (
  echo   [--]   %~2: not registered
  exit /b 0
)
reg delete "%~1" /f >nul 2>&1
if errorlevel 1 (
  echo   [WARN] Could not delete the %~2 key - try running this script as administrator.
) else (
  echo   [OK]   removed the %~2 registration
)
exit /b 0
