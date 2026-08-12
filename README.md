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

## Luồng Unit Test Whitebox

Kiến trúc công khai vẫn là **Planner → Generator → Healer**. Code Reader, Branch Analyzer và Dependency Resolver nằm trong `src/core/unit/`, là công cụ nội bộ của Planner chứ không phải agent thứ tư.

### Phạm vi phiên bản hiện tại

- Dự án JavaScript/TypeScript đã cấu hình Vitest hoặc Jest.
- Hàm, arrow function và class được `export`.
- Phân tích `if/else`, ternary, `switch`, `catch` và vòng lặp bằng TypeScript AST.
- Phân loại dependency database/API/filesystem/time để Generator mock đúng ranh giới.
- Dựng call graph/type graph có giới hạn để cung cấp đúng helper, constant và interface reachable; không kéo dependency của hàm không liên quan.
- Test sinh tại `<du-an-dich>/tests/unit/ai-generated/` và luôn import source thật.
- File sinh phải qua static contract và TypeScript preflight; phiên chạy chỉ giữ file của lần Generator thành công gần nhất.
- Healer Unit chạy theo chính sách `diagnose-only`: không đổi expected, không sửa source sản phẩm và không skip test.

### Cách dùng

1. Chạy `npm start`.
2. Chọn `AI Lên kế hoạch & Sinh Code Test` → `Unit`.
3. Chọn thư mục dự án, một file nguồn hoặc dán một đoạn code có `export`.
4. Chọn hàm/class cần test và nhập requirement nếu có.
5. Planner lập kế hoạch cho từng target; Generator chỉ chạy khi JSON vượt qua validator.
6. Chọn `Chạy kiểm thử Unit Test` ở menu để chạy các file gần nhất trong đúng thư mục dự án đích.

TestKit không tự cài Vitest/Jest và không gửi `.env`, secret key, test cũ, `node_modules`, `dist`, `build` hoặc `coverage` vào AI. Nếu dự án chưa có test runner, hệ thống dừng và yêu cầu cấu hình rõ ràng.

### Artifact của mỗi lần chạy

```text
artifacts/unit/<project>/<yyyyMMdd_HHmmss_SSS>/
├── project-manifest.json
├── code-index.json
├── branch-map.json
├── dependency-map.json
├── supporting-context.json
├── context-bundle.json
├── test-plan-unit.json
├── test-plan-unit.md
├── generation-manifest.json
├── test-results.json
├── coverage-gaps.json
└── healer-diagnosis.json
```

JSON là hợp đồng cho chương trình; Markdown là bản trình bày để tester đọc. `supporting-context.json` chứa call graph, helper, type và constant thật sự liên quan đến target. `sourceHash` chặn Generator nếu target hoặc supporting source đã thay đổi sau khi Planner lập kế hoạch.
