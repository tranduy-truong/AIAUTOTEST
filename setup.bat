@echo off
chcp 65001 > nul
echo ===================================================
echo   KHOI TAO MOI TRUONG PLAYWRIGHT-AI-TESTKIT
echo ===================================================

echo.
echo 1. Dang cai dat dependencies tu package.json...
call npm install

echo.
echo 2. Dang cai dat Playwright Browsers...
call npx playwright install --with-deps

echo.
echo 3. Dang khoi tao file cau hinh moi truong...
if not exist ".env" (
    copy .env.example .env > nul
    echo Da tao file .env tu .env.example. Vui long dien API Key vao file .env truoc khi chay!
) else (
    echo File .env da ton tai.
)

echo.
echo 4. Dang tao cac thu muc can thiet...
if not exist "tests\unit" mkdir "tests\unit"
if not exist "tests\integration" mkdir "tests\integration"
if not exist "tests\e2e" mkdir "tests\e2e"
if not exist "artifacts" mkdir "artifacts"

echo.
echo ===================================================
echo   HOAN THANH SETUP MOI TRUONG!
echo   Go "npm start" de bat dau.
echo ===================================================
pause