@echo off
echo ============================================
echo  HUAY GO — Starting ALL services
echo ============================================
echo  Backend       : http://localhost:3001
echo  Frontend      : http://localhost:5173
echo  OCR service   : http://localhost:8000
echo  Webhook tunnel: https://huay-webhook.nexapos.io -^> localhost:3001
echo  LAN           : http://[your-ip]:5173
echo ============================================

mkdir "%~dp0data" 2>nul

start "HUAY GO Backend" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 3 /nobreak >nul
start "HUAY GO Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 3 /nobreak >nul
start "HUAY GO OCR Service" cmd /k "cd /d %~dp0ocr-service && start-ocr.bat"
timeout /t 3 /nobreak >nul
start "HUAY GO Webhook Tunnel" cmd /k "%~dp0start-webhook-tunnel.bat"

echo.
echo All 4 services starting... Check the windows above.
echo (OCR service window handles its own first-time venv/pip setup — see ocr-service\README.md.
echo  It is optional: LINE bet-slip photos still queue for staff review even if it's not running.
echo  Webhook tunnel needs the backend up to avoid 502 — it waits 9s total before launching so
echo  backend has time to boot first.)
echo Press any key to close this launcher.
pause >nul
