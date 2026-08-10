#!/bin/bash
echo "==================================================="
echo "  KHOI TAO MOI TRUONG PLAYWRIGHT-AI-TESTKIT"
echo "==================================================="

echo ""
echo "1. Dang cai dat dependencies tu package.json..."
npm install

echo ""
echo "2. Dang cai dat Playwright Browsers..."
npx playwright install --with-deps

echo ""
echo "3. Dang khoi tao file cau hinh moi truong..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Da tao file .env tu .env.example. Vui long dien API Key vao file .env truoc khi chay!"
else
    echo "File .env da ton tai."
fi

echo ""
echo "4. Dang tao cac thu muc can thiet..."
mkdir -p tests/unit tests/integration tests/e2e artifacts

echo ""
echo "==================================================="
echo "  HOAN THANH SETUP MOI TRUONG!"
echo "  Go \"npm start\" de bat dau."
echo "==================================================="
