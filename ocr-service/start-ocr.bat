@echo off
echo ============================================
echo  HUAY GO — OCR Service (PaddleOCR)
echo ============================================
echo  http://localhost:8000
echo ============================================

cd /d %~dp0
if not exist venv (
    echo Creating venv...
    python -m venv venv
)
call venv\Scripts\activate.bat

echo Installing/checking dependencies (pip skips anything already satisfied)...
pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo Dependency install failed — see errors above. Not starting the server.
    pause
    exit /b 1
)

uvicorn app:app --host 127.0.0.1 --port 8000

pause
