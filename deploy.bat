@echo off
setlocal
title HUAY GO - Deploy (Git + Cloudflare + Railway)
cd /d "%~dp0"

echo ============================================
echo  HUAY GO - Deploy Pipeline
echo  1) Git commit + push
echo  2) Cloudflare Pages (frontend - huay77)
echo  Backend (Railway) auto-deploys from GitHub on push - no CLI step needed
echo ============================================
echo.

echo [1/3] Git status:
git status --short
echo.

set "COMMIT_MSG="
set /p COMMIT_MSG="Commit message (Enter = 'deploy: update'): "
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=deploy: update"

git add -A
git commit -m "%COMMIT_MSG%"
echo (if nothing to commit, that's fine - continuing)

echo.
echo [2/3] Pushing to git (this also triggers Railway's GitHub auto-deploy)...
git push
if errorlevel 1 (
    echo [ERROR] git push failed. Aborting deploy.
    pause
    exit /b 1
)

echo.
echo [3/3] Building + deploying frontend to Cloudflare Pages (huay77)...
cd /d "%~dp0frontend"
call npm run build
if errorlevel 1 (
    echo [ERROR] Frontend build failed. Aborting.
    pause
    exit /b 1
)
call wrangler pages deploy dist --project-name=huay77
if errorlevel 1 (
    echo [ERROR] Cloudflare Pages deploy failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Deploy complete!
echo  Frontend: https://huay77.pages.dev
echo  Backend : https://huaygo-backend-production.up.railway.app (building via Railway's GitHub integration - check dashboard)
echo ============================================
pause
