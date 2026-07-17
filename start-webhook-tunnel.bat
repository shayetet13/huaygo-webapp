@echo off
echo ============================================
echo  HUAY GO — LINE Webhook Tunnel (stable, named)
echo ============================================
echo  https://huay-webhook.nexapos.io
echo  -> http://localhost:3001 (backend)
echo.
echo  Separate from the pos-backend tunnel — do not
echo  touch ~/.cloudflared/config.yml for this one.
echo ============================================
echo.

cloudflared tunnel --config "%~dp0cloudflared-huay-go-tunnel.yml" run huay-go

pause
