@echo off
setlocal enabledelayedexpansion
title HUAY GO - Deploy (Git + Cloudflare + Railway)
cd /d "%~dp0"

echo ============================================
echo  HUAY GO - Deploy Pipeline
echo  1) Pre-flight checks (backend type-check + tests, frontend type-check)
echo  2) Git commit + push (triggers Railway's GitHub auto-deploy)
echo  3) Cloudflare Pages (frontend - huay77)
echo ============================================
echo.

REM --- Safety: never deploy from "master" — it still holds the old git
REM     history with credentials that were later removed from source and
REM     rotated. Only "github-main" (pushed clean, tracks origin/main) and
REM     branches made from it are safe to push to the public repo.
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "CUR_BRANCH=%%b"
if /i "!CUR_BRANCH!"=="master" (
    echo [ERROR] You are on "master", which contains old leaked-credential history.
    echo         That branch must never be pushed. Switch first:
    echo             git checkout github-main
    pause
    exit /b 1
)
echo Current branch: !CUR_BRANCH!
echo.

echo [1/5] Backend: type-check + tests...
cd /d "%~dp0backend"
del /q data\test.db data\test.db-* >nul 2>&1
call npx tsc --noEmit
if errorlevel 1 (
    echo [ERROR] Backend has TypeScript errors. Fix before deploying.
    pause
    exit /b 1
)
call npm test
if errorlevel 1 (
    echo [ERROR] Backend tests failed. Fix before deploying.
    pause
    exit /b 1
)
cd /d "%~dp0"
echo.

echo [2/5] Frontend: type-check...
cd /d "%~dp0frontend"
call npx tsc --noEmit
if errorlevel 1 (
    echo [ERROR] Frontend has TypeScript errors. Fix before deploying.
    pause
    exit /b 1
)
cd /d "%~dp0"
echo.

echo [3/5] Git status:
git status --short
echo.

set "COMMIT_MSG="
set /p COMMIT_MSG="Commit message (Enter = 'deploy: update'): "
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=deploy: update"

git add -A

REM --- Basic secret scan on what's about to be committed — this repo is
REM     PUBLIC on GitHub. Catches the exact mistake that leaked real
REM     credentials into git history before (see MEMORY.md). Not exhaustive,
REM     just a last-line safety net — review "git diff --cached" yourself too.
REM     deploy.bat itself is excluded: it legitimately contains these words
REM     as its own findstr search patterns, which would otherwise always
REM     self-flag whenever this script gets edited.
git diff --cached -- . ":(exclude)deploy.bat" | findstr /i /c:"Root#77" /c:"Mms123123" /c:"password123" /c:"Test1234" /c:"PrikTai" >nul
if not errorlevel 1 (
    echo [ERROR] A known leaked/test credential pattern was found in staged changes.
    echo         Run "git diff --cached" and review before committing. Aborting.
    git reset >nul
    pause
    exit /b 1
)

git commit -m "%COMMIT_MSG%"
echo (if nothing to commit, that's fine - continuing)
echo.

echo [4/5] Pushing to GitHub main (triggers Railway auto-deploy)...
git push origin HEAD:main
if errorlevel 1 (
    echo [ERROR] git push failed. Aborting deploy.
    pause
    exit /b 1
)
echo.

echo [5/5] Building + deploying frontend to Cloudflare Pages (huay77)...
cd /d "%~dp0frontend"
call npm run build
if errorlevel 1 (
    echo [ERROR] Frontend build failed. Aborting.
    pause
    exit /b 1
)
call npx wrangler pages deploy dist --project-name=huay77
if errorlevel 1 (
    echo [ERROR] Cloudflare Pages deploy failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Deploy complete!
echo  Frontend: https://huay77.pages.dev
echo  Backend : https://huaygo-backend-production.up.railway.app
echo            (Railway auto-deploy triggered by the git push above -
echo             check the Railway dashboard, or run "railway status", for
echo             build progress)
echo ============================================
pause
