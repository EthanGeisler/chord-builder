@echo off
title Chord Builder

:: Kill any existing proxy/server processes
taskkill /f /fi "WINDOWTITLE eq Chord Builder Proxy" >nul 2>&1

:: Start CORS proxy in background
start "Chord Builder Proxy" /min cmd /c "cd /d %~dp0proxy && npm install --silent 2>nul && node server.js"

:: Start HTTP server and open browser
cd /d %~dp0
timeout /t 2 /nobreak >nul
start http://localhost:8000
python -m http.server 8000
