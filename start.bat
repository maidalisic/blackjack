@echo off
setlocal EnableDelayedExpansion

set BACKEND_PORT=8001
set FRONTEND_PORT=5174

set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%backend
set FRONTEND_DIR=%SCRIPT_DIR%frontend

echo Installing backend dependencies...
cd /d "%BACKEND_DIR%"
uv sync --quiet
if errorlevel 1 ( echo ERROR: uv sync failed & pause & exit /b 1 )

echo Starting backend on port %BACKEND_PORT%...
start "Blackjack Backend" /min cmd /c "uv run uvicorn main:app --host 0.0.0.0 --port %BACKEND_PORT% --log-level warning"

echo Starting frontend on port %FRONTEND_PORT%...
cd /d "%FRONTEND_DIR%"
start "Blackjack Frontend" /min cmd /c "npm run dev -- --port %FRONTEND_PORT%"

echo Waiting for servers to start...
timeout /t 4 /nobreak >nul

:: Get local network IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1" ^| findstr /v "::"') do (
    set LAN_IP=%%a
    set LAN_IP=!LAN_IP: =!
    goto :found_ip
)
set LAN_IP=unknown
:found_ip

cls
echo +---------------------------------------------+
echo ^|           Blackjack -- running              ^|
echo +---------------------------------------------+
echo ^|  Local:    http://localhost:%FRONTEND_PORT%        ^|
echo ^|  Network:  http://%LAN_IP%:%FRONTEND_PORT%          ^|
echo ^|  Backend:  http://localhost:%BACKEND_PORT%        ^|
echo +---------------------------------------------+
echo ^|  Admin:    http://localhost:%FRONTEND_PORT%/admin  ^|
echo ^|  Admin:    http://%LAN_IP%:%FRONTEND_PORT%/admin    ^|
echo +---------------------------------------------+
echo ^|  Press  Q + Enter  to quit                 ^|
echo +---------------------------------------------+
echo.

:menu
set /p input="> "
if /i "%input%"=="q"    goto :quit
if /i "%input%"=="quit" goto :quit
if /i "%input%"=="exit" goto :quit
echo   (Q to quit)
goto :menu

:quit
echo.
echo Shutting down...
taskkill /fi "WindowTitle eq Blackjack Backend*" /f >nul 2>&1
taskkill /fi "WindowTitle eq Blackjack Frontend*" /f >nul 2>&1
echo Done.
exit /b 0
