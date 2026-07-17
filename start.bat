@echo off
echo ============================================
echo  HUAY GO — Starting servers
echo ============================================
echo  Backend : http://localhost:3001
echo  Frontend: http://localhost:5173
echo  LAN     : http://[your-ip]:5173
echo ============================================

mkdir "%~dp0data" 2>nul

start "HUAY GO Backend" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 3 /nobreak >nul
start "HUAY GO Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Both servers starting... Check the windows above.
echo Press any key to close this launcher.
pause >nul
