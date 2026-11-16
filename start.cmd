@echo off
rem Starts Crest Forge on http://localhost:8080 and opens your browser. Needs Node.js 22 or newer.
rem Double-click it. The first run installs and builds the app (about a minute).
rem Extra arguments go to the server:
rem   start.cmd --port 3000     another port
rem   start.cmd --lan           reachable from other devices on your network
rem   start.cmd --rebuild       rebuild first (after pulling changes)
rem   start.cmd --no-open       don't open a browser
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Crest Forge needs Node.js 22 or newer: https://nodejs.org
  pause
  exit /b 1
)

set "REBUILD="
for %%A in (%*) do if /i "%%~A"=="--rebuild" set "REBUILD=1"
if not exist dist\index.html set "REBUILD=1"

if defined REBUILD (
  if not exist node_modules (
    echo Installing dependencies...
    call npx -y pnpm@10 install --frozen-lockfile
    if errorlevel 1 goto :fail
  )
  echo Building...
  call npx -y pnpm@10 build
  if errorlevel 1 goto :fail
)

node tools\serve.mjs --open %*
if errorlevel 1 pause
exit /b %errorlevel%

:fail
echo The build failed. See the messages above.
pause
exit /b 1
