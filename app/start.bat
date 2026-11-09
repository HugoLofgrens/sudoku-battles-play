@echo off
rem Double-click to run Sudoku Battles on this computer and your Wi-Fi.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get version 22 LTS or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules\ws (
  echo First run: installing the one package the server needs...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 ( pause & exit /b 1 )
)
node --no-warnings=ExperimentalWarning server/main.js
pause
