@echo off
echo ============================================
echo  HUAY GO — Cloudflare Quick Tunnel
echo ============================================
echo  Exposing: http://localhost:5173
echo  (frontend proxies /api to backend:3001)
echo.
echo  Make sure start.bat is already running
echo  before using this tunnel.
echo ============================================
echo.

:: --config points at an empty file so this doesn't inherit the
:: named-tunnel credentials from ~/.cloudflared/config.yml, which
:: caused the quick tunnel to register under the wrong tunnel ID (404s).
cloudflared tunnel --config "%~dp0cloudflared-quick-tunnel.yml" --protocol http2 --url http://localhost:5173

pause
