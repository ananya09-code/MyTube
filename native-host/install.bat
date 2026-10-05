@echo off
setlocal enabledelayedexpansion
title Install native helper - mytube

rem ===============================================================
rem  Registers the native messaging host for mytube.
rem  Writes to HKCU only, so no administrator rights are needed.
rem ===============================================================

echo.
echo ==============================================
echo  mytube - native helper installer
echo ==============================================
echo.

rem ---------------------------------------------------------------
rem  1. Locate this script's folder
rem ---------------------------------------------------------------
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
echo Helper folder: %HERE%

rem ---------------------------------------------------------------
rem  2. Check prerequisites and warn (do not abort)
rem ---------------------------------------------------------------
echo.
echo Checking prerequisites...

call :CheckPython
if "%PYOK%"=="1" (
  echo   [OK]   Python 3 found ^( %PYCMD% ^)
) else (
  echo   [WARN] Python 3 was NOT found.
  echo          The native helper cannot run without it.
  echo          Install it from https://www.python.org/downloads/
  echo          and tick "Add python.exe to PATH" during setup.
  echo.
  pause
  exit /b 1
)

set "DLOK=0"
where yt-dlp >nul 2>&1 && set "DLOK=1"
if "%DLOK%"=="1" (
  echo   [OK]   yt-dlp found in PATH
) else (
  echo   [WARN] yt-dlp was NOT found in PATH.
  echo          The helper still works - it will only save the .txt files.
  echo          Install with:  pip install -U yt-dlp
)

rem ---------------------------------------------------------------
rem  3. Ask for the extension ID
rem ---------------------------------------------------------------
echo.
echo ---------------------------------------------------------------
echo  I need your extension ID.
echo.
echo  How to find it:
echo    1. Open  chrome://extensions  (or edge://extensions)
echo    2. Make sure "Developer mode" is ON (top right)
echo    3. Find "mytube"
echo    4. Copy the long 32-character "ID" shown on its card
echo.
echo  It looks like:  aefdklpahdlgknbmahdbkehkjlcpnfil
echo ---------------------------------------------------------------
echo.

set "EXTID="
set /p "EXTID=Paste your extension ID here: "

rem strip spaces, quotes and any stray characters
set "EXTID=%EXTID: =%"
set "EXTID=%EXTID:"=%"
set "EXTID=%EXTID:'=%"

call :ValidateId "%EXTID%"
if errorlevel 1 (
  echo.
  echo Install cancelled. Run install.bat again when you have the ID.
  pause
  exit /b 1
)
rem adopt the validated (lower-cased) form
set "EXTID=!ID!"

rem ---------------------------------------------------------------
rem  4. Build the manifest JSON
rem     Paths inside JSON need escaped backslashes, so "C:\x" -> "C:\\x"
rem ---------------------------------------------------------------
set "JSONFILE=%HERE%\com.linkcollector.ytdlp.json"
set "BATESC=%HERE%\host.bat"
set "BATESC=%BATESC:\=\\%"

echo.
echo Writing host manifest...
(
  echo {
  echo   "name": "com.linkcollector.ytdlp",
  echo   "description": "mytube native helper - runs yt-dlp on a topic list",
  echo   "path": "!BATESC!",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://!EXTID!/"]
  echo }
) > "%JSONFILE%"

if not exist "%JSONFILE%" (
  echo   [ERROR] Could not write %JSONFILE%
  goto :fail
)
echo   [OK]   %JSONFILE%

rem ---------------------------------------------------------------
rem  5. Register in the registry for Chrome, Chromium and Edge
rem ---------------------------------------------------------------
echo.
echo Registering the host (HKCU, no admin needed)...

call :Register "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.linkcollector.ytdlp"           "Chrome"
call :Register "HKCU\Software\Chromium\NativeMessagingHosts\com.linkcollector.ytdlp"               "Chromium"
call :Register "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.linkcollector.ytdlp"          "Edge"

rem ---------------------------------------------------------------
rem  6. Done
rem ---------------------------------------------------------------
echo.
echo ==============================================
echo  Installed.
echo ==============================================
echo.
echo   Extension ID : %EXTID%
echo   Host manifest: %JSONFILE%
echo   Log file     : %HERE%\host.log
echo.
echo   Next steps:
echo     1. Close and reopen your browser.
echo     2. Open the extension popup, expand Settings
echo        and click "Test helper".
echo.
echo   If "Test helper" complains, the ID in step 3 above
echo   must match the ID shown in your browser exactly.
echo.
pause
exit /b 0

rem ===============================================================
rem  Subroutines
rem ===============================================================

:CheckPython
rem Sets PYOK=1/2 and PYCMD to the working interpreter, PYOK=0 if none works.
set "PYOK=0"
set "PYCMD="
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 (
  set "PYOK=1"
  set "PYCMD=py -3"
  exit /b 0
)
python -c "import sys" >nul 2>&1
if not errorlevel 1 (
  set "PYOK=1"
  set "PYCMD=python"
  exit /b 0
)
python3 -c "import sys" >nul 2>&1
if not errorlevel 1 (
  set "PYOK=1"
  set "PYCMD=python3"
  exit /b 0
)
exit /b 0

:Register
rem %1 = registry key, %2 = friendly browser name
reg add "%~1" /ve /t REG_SZ /d "%JSONFILE%" /f >nul 2>&1
if errorlevel 1 (
  echo   [WARN] Could not register for %~2 - try running this script as administrator.
) else (
  echo   [OK]   Registered for %~2
)
exit /b 0

:ValidateId
rem %1 = the ID typed by the user
set "ID=%~1"
if "%ID%"=="" (
  echo.
  echo   [ERROR] No extension ID was entered.
  goto :validatefail
)
rem Chrome/Edge IDs are exactly 32 characters from a-p
set "TMP=%ID%"
set /a LEN=0
:CountLoop
if "!TMP!"=="" goto :CountDone
set "TMP=!TMP:~1!"
set /a LEN+=1
goto :CountLoop
:CountDone
if not "!LEN!"=="32" (
  echo.
  echo   [ERROR] "!ID!" is !LEN! characters long, but an extension ID is 32.
  echo           Copy it again from the extension card in chrome://extensions.
  goto :validatefail
)
rem Extension IDs use the letters a-p; normalise to lower case first so a
rem mis-copied upper case ID is accepted instead of silently failing to match.
call :Lowercase ID
set "ID=!ID!"

set "BAD=!ID:a=!"
set "BAD=!BAD:b=!"
set "BAD=!BAD:c=!"
set "BAD=!BAD:d=!"
set "BAD=!BAD:e=!"
set "BAD=!BAD:f=!"
set "BAD=!BAD:g=!"
set "BAD=!BAD:h=!"
set "BAD=!BAD:i=!"
set "BAD=!BAD:j=!"
set "BAD=!BAD:k=!"
set "BAD=!BAD:l=!"
set "BAD=!BAD:m=!"
set "BAD=!BAD:n=!"
set "BAD=!BAD:o=!"
set "BAD=!BAD:p=!"
if not "!BAD!"=="" (
  echo.
  echo   [ERROR] "!ID!" contains characters that are not valid in an extension ID.
  echo           Only the letters a to p are allowed.
  goto :validatefail
)
exit /b 0

:validatefail
exit /b 1

:Lowercase
rem Lowercases the variable named in %1 using a 26-step substitution table.
set "L=!%~1!"
for %%C in (a b c d e f g h i j k l m n o p q r s t u v w x y z) do (
  call set "L=!L:%%C=%%~C!"
)
set "%~1=!L!"
exit /b 0

:noid
echo.
echo Install cancelled.
pause
exit /b 1

:fail
echo.
echo Install failed. See the messages above.
pause
exit /b 1
