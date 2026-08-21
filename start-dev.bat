@echo off
REM Double-click to start the RM Ops dev server. Leave this window open while you work.
cd /d "%~dp0"
set "PATH=C:\Users\Utente\AppData\Local\nvm\v20.20.2;C:\nvm4w\nodejs;%PATH%"
echo Starting RM Ops dev server on http://localhost:3000 ...
echo (Keep this window open. Close it to stop the server.)
echo.
pnpm dev
pause
