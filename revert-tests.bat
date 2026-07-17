@echo off
chcp 65001 >nul
REM ============================================================
REM  revert-tests.bat
REM  ลบทุกอย่างที่สร้างขึ้นมาเพื่อ test และ restore โค้ดที่แก้
REM  รัน: double-click หรือ cd F:\webapp\huai && revert-tests.bat
REM ============================================================

cd /d "%~dp0"
echo.
echo ========================================
echo  REVERT TESTS — HUAY GO
echo ========================================
echo.

echo [1/6] ลบ test files...
rd /s /q "backend\src\__tests__"   2>nul && echo   OK: backend\src\__tests__\ ลบแล้ว
rd /s /q "frontend\src\__tests__"  2>nul && echo   OK: frontend\src\__tests__\ ลบแล้ว

echo [2/6] ลบ utility files ที่แยกออกมาเพื่อ test...
del /q "backend\src\utils\betLogic.ts"  2>nul && echo   OK: betLogic.ts ลบแล้ว
del /q "frontend\src\utils\checkWin.ts" 2>nul && echo   OK: checkWin.ts ลบแล้ว
rd "backend\src\utils"  2>nul
rd "frontend\src\utils" 2>nul

echo [3/6] ลบ vitest config + .npmrc...
del /q "backend\vitest.config.ts"  2>nul && echo   OK: backend\vitest.config.ts ลบแล้ว
del /q "frontend\vitest.config.ts" 2>nul && echo   OK: frontend\vitest.config.ts ลบแล้ว
del /q "backend\.npmrc"            2>nul && echo   OK: backend\.npmrc ลบแล้ว

echo [4/6] revert package.json — เอา vitest scripts + deps ออก...
powershell -NoProfile -Command ^
  "$f = 'backend\package.json';" ^
  "$c = Get-Content $f -Raw;" ^
  "$c = $c -replace '(?m)^\s+\"test\":\s+\"vitest run\",\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"test:watch\":\s+\"vitest\",\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"test:coverage\":\s+\"vitest run --coverage\"\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"vitest\":\s+\"\^2\.0\.0\",\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"@vitest/coverage-v8\":\s+\"\^2\.0\.0\",\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"pnpm\":\s+\{\r?\n\s+\"onlyBuiltDependencies\":\s+\[\"better-sqlite3\",\s+\"esbuild\",\s+\"puppeteer\"\]\r?\n\s+\},\r?\n', '';" ^
  "Set-Content $f $c -NoNewline;" ^
  "Write-Host '  OK: backend\package.json reverted'"

powershell -NoProfile -Command ^
  "$f = 'frontend\package.json';" ^
  "$c = Get-Content $f -Raw;" ^
  "$c = $c -replace '(?m)^\s+\"test\":\s+\"vitest run\",\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"test:watch\":\s+\"vitest\",\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"test:coverage\":\s+\"vitest run --coverage\"\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"vitest\":\s+\"\^2\.0\.0\",\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"@vitest/coverage-v8\":\s+\"\^2\.0\.0\",\r?\n', '';" ^
  "$c = $c -replace '(?m)^\s+\"jsdom\":\s+\"\^25\.0\.0\",\r?\n', '';" ^
  "Set-Content $f $c -NoNewline;" ^
  "Write-Host '  OK: frontend\package.json reverted'"

echo [5/6] revert SqliteBetRepo.ts — restore switch block...
powershell -NoProfile -Command ^
  "$f = 'backend\src\repositories\sqlite\SqliteBetRepo.ts';" ^
  "$c = Get-Content $f -Raw;" ^
  "$c = $c -replace \"import \{ isBetWin \} from '../../utils/betLogic'`r`n\", '';" ^
  "$c = $c -replace '        won = isBetWin\(bet\.bet_type, bet\.number, result3top, result2top, result2bot\)', `"        switch (bet.bet_type) {`r`n          case '3' + [char]0x15D1 + [char]0x15D1 + [char]0x15A7 + [char]0x15A1 + [char]0x1594:   won = bet.number === result3top; break`r`n        }`";" ^
  "Set-Content $f $c -NoNewline"
echo   NOTE: SqliteBetRepo.ts — ต้องแก้ switch block ด้วยมือ (Thai chars ใน bat ไม่รองรับ)
echo         ให้ replace 'won = isBetWin(...)' กลับเป็น switch statement เดิม

echo [6/6] revert ResultBetsModal.tsx — เอา import checkWin ออก + ใส่ inline functions กลับ...
powershell -NoProfile -Command ^
  "$f = 'frontend\src\pages\Results\ResultBetsModal.tsx';" ^
  "$c = Get-Content $f -Raw;" ^
  "$c = $c -replace \"import \{ checkWin, calcWinAmount \} from '@/utils/checkWin'`r`n\", '';" ^
  "Set-Content $f $c -NoNewline;" ^
  "Write-Host '  OK: import line removed from ResultBetsModal.tsx'"
echo   NOTE: ต้องใส่ inline checkWin/calcWinAmount functions กลับใน ResultBetsModal.tsx ด้วยมือ

echo.
echo ========================================
echo  เสร็จแล้ว!
echo ========================================
echo.
echo  สิ่งที่ revert อัตโนมัติ:
echo    - ลบ test files, utils, vitest config, .npmrc
echo    - package.json: เอา scripts + deps ออก
echo    - ResultBetsModal.tsx: เอา import ออก
echo.
echo  ต้องทำด้วยมือ 2 ไฟล์:
echo    1. backend\src\repositories\sqlite\SqliteBetRepo.ts
echo       - เอา "import isBetWin" ออก
echo       - restore switch(bet.bet_type) { case '3ตัวบน': ... }
echo    2. frontend\src\pages\Results\ResultBetsModal.tsx
echo       - ใส่ inline checkWin() + calcWinAmount() กลับ
echo       (หรือ copy จาก frontend\src\utils\checkWin.ts ก่อนลบ)
echo.
pause
