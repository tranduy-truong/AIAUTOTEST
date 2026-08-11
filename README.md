# Playwright & Vitest AI Automation Test Toolkit

Bộ công cụ hỗ trợ lên kế hoạch và sinh mã nguồn kiểm thử tự động (E2E, Integration, Unit) sử dụng AI, tích hợp Playwright và Vitest.

---

## 🛠️ Hướng dẫn cài đặt nhanh (Clone & Run)

Dự án đã được cấu hình sẵn các file script tự động hóa môi trường. Mentor/Tester sau khi clone về chỉ cần chạy lệnh sau:

### 1. Khởi tạo môi trường
- **Trên Windows**: Click đúp vào file `setup.bat` (hoặc chạy trong cmd: `setup.bat`).
- **Trên macOS / Linux**: Chạy lệnh `./setup.sh` trong Terminal.

*Script này sẽ tự động:*
- Cài đặt toàn bộ dependencies trong `package.json`.
- Cài đặt trình duyệt chạy Playwright (`npx playwright install`).
- Khởi tạo file cấu hình môi trường `.env` từ `.env.example`.
- Tạo các thư mục test cần thiết.

### 2. Cấu hình khóa API Key
Mở file `.env` vừa được tạo ra ở thư mục gốc và điền API Key của bạn:
```env
GROQ_API_KEY=your_api_key_here
```

---

## 🚀 Hướng dẫn chạy chương trình

### 1. Bật bảng điều khiển CLI chính
Chạy lệnh sau ở thư mục gốc để mở Menu tương tác:
```bash
npm start
```

### 2. Chạy test case thủ công (Playwright)
Để chạy các file kiểm thử E2E đã sinh ra:
- Chạy headless (không giao diện):
  ```bash
  npx playwright test
  ```
- Chạy headed (hiển thị trình duyệt):
  ```bash
  npx playwright test --headed
  ```
- Chạy với giao diện Playwright UI trực quan:
  ```bash
  npx playwright test --ui
  ```

---

## 📁 Cấu trúc thư mục dự án

```text
├── src/                  # Mã nguồn CLI và các AI Agents (Planner, Generator, Crawler)
├── tests/
│   ├── e2e/              # Nơi chứa các file test Playwright (.spec.ts)
│   ├── integration/      # Nơi chứa test tích hợp API/DB
│   └── unit/             # Nơi chứa unit test logic nội bộ
├── artifacts/            # Báo cáo phân tích lỗi và DOM Crawl
├── playwright.config.ts  # Cấu hình Playwright
├── package.json          # Khai báo thư viện dependencies
├── setup.bat             # File cài đặt tự động cho Windows
└── setup.sh              # File cài đặt tự động cho macOS/Linux
```

## Luồng E2E hiện tại

1. **Planner** đọc trực tiếp kịch bản tiếng Việt, tách câu ghép thành Action Intent nguyên tử và ghi `artifacts/test-plan-e2e.json`. File Markdown cùng tên chỉ là bản trình bày được dựng tự động từ JSON.
2. **Validator của Planner** chặn test case/bước/dữ liệu không có trong kịch bản, bước mơ hồ và mọi locator do AI tự tạo. Kịch bản lớn được chia theo `TC_...` để tránh vượt giới hạn token rồi mới hợp nhất.
3. **Live Crawler** chạy các Action Intent trên website thật. Locator tự xác minh được lưu vào Action Plan; trường hợp chưa biết mới yêu cầu tester chọn mẫu và ghi nhớ nội bộ trong `.testkit/crawler-locators.json`.
4. **Generator** chỉ sinh Playwright từ `artifacts/action-plan.json` đã xác minh. Nó không được thay locator hoặc đổi Expected Result.
5. **Healer** khi test lỗi sẽ replay lại `test-plan-e2e.json`, crawl trạng thái thật và chỉ sửa phần kỹ thuật nếu vẫn giữ nguyên kết quả mong đợi.

`source-script-e2e.md` là đầu vào gốc để đối chiếu; `test-plan-e2e.json` là dữ liệu chuẩn cho máy; `test-plan-e2e.md` là bản dễ đọc cho tester; `crawled-dom.md` là catalog DOM rút gọn; `action-plan.json` là hợp đồng cuối giữa Crawler và Generator.
