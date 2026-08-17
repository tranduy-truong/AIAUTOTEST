# 🚀 Playwright & Vitest AI Automation Test Toolkit

**Bộ công cụ tự động hóa kiểm thử đa tầng (Unit, Integration, E2E) tích hợp AI & TypeScript AST Analysis.**

---

## 📋 Giới thiệu chung

`playwright-ai-testkit` (AIAUTOTEST) là hệ thống AI Agent hỗ trợ lên kế hoạch, biên dịch và tự động sửa lỗi (Self-Healing) cho toàn bộ **Kim tự tháp kiểm thử (Test Pyramid)**. Hệ thống kết hợp giữa **phân tích tĩnh tất định (AST Analysis & Deterministic Compilers)** và **mô hình trí tuệ nhân tạo (AI Models)** để tạo ra các kịch bản test chuẩn xác, không đoán mò locator, và không làm hỏng assertion nghiệp vụ.

---

## 🌟 Tính năng nổi bật & Kiến trúc 3 tầng

### 1. ⚙️ Tầng Unit Test (Whitebox Testing - Vitest)
- **Đọc mã nguồn & AST Analysis**: Tự động phân tích AST (TypeScript/JavaScript), trích xuất nhánh `if/else`, `switch`, `ternary`, `catch`, vòng lặp và dependencies.
- **Phân loại khả năng kiểm thử (Testability Classifier)**: Gán 1 trong 8 profile kiểm thử cho từng target:
  - `UNIT_NATIVE`, `UNIT_MOCKED`, `COMPONENT_DOM`, `INTEGRATION_SANDBOX`, `PROCESS_SANDBOX`, `ENTRYPOINT_SMOKE`, `NO_RUNTIME_TEST`, `REFACTOR_REQUIRED`.
- **Deterministic AST Planner**: Bỏ qua AI hoàn toàn khi AST đủ hợp đồng; AI chỉ tham gia diễn giải yêu cầu nghiệp vụ phức tạp hoặc bổ sung case thiếu.
- **Oracle Resolution & Gate Verification**: Kiểm chứng kết quả kỳ vọng (expected results) qua chứng cứ AST, mock-trace hoặc xác nhận từ Tester. Có menu riêng (`05. Xác nhận kết quả Unit`) để xem lại & xác nhận.
- **Deterministic TS Compiler Generator**: Dùng TypeScript Compiler API biên dịch trực tiếp file Vitest (`<project>/tests/unit/ai-generated/`) import mã nguồn thật.
- **Vòng lặp tối ưu Coverage (Coverage-Guided Loop)**: Đọc file `coverage-final.json`, tự động bù đắp gap coverage tối đa 3 vòng để đạt ngưỡng 80%+.
- **Diagnose-Only Healer**: Chẩn đoán lỗi unit test mà không tự ý sửa đổi mã nguồn sản phẩm hay làm sai lệch expected values.

### 2. 🔌 Tầng Integration Test (Greybox Testing - Vitest & Sandboxing)
- **Khởi chạy Sandbox an toàn**: Tự động quản lý tiến trình API server, healthcheck HTTP và môi trường cô lập.
- **Tích hợp Database Containers**: Hỗ trợ Testcontainers (`PostgreSQL`, `MySQL`, `SQLite Memory`) và MSW (Mock Service Worker) cho API/DB integration tests.
- **Chính sách bảo mật**: Tự động mã hóa secrets, lọc biến môi trường và kiểm tra danh sách domain cho phép.

### 3. 🌐 Tầng E2E Test (Blackbox Testing - Playwright)
- **2 Chế độ lập kế hoạch**:
  - 📝 **Script Mode**: Nhập kịch bản kiểm thử tiếng Việt tự nhiên, Planner phân tách thành các Action Intent nguyên tử.
  - 🔍 **Discovery Mode**: Tự động cào đa trang (Discovery Crawler), dựng Catalog DOM (`artifacts/discovery-dom.md`) và gợi ý kịch bản test phù hợp.
- **Quản lý xác thực (Auth Capture)**: Hỗ trợ lưu phiên làm việc qua `PLAYWRIGHT_STORAGE_STATE` (Form Login) hoặc `JWT_HEADER` lưu tại `.auth/session.json`.
- **Live Multi-State Crawler**: Chạy các Action Intent trên trình duyệt thật, tự xác minh locator và lưu registry tại `.testkit/crawler-locators.json`.
- **Generator & Self-Healing Healer**: Biên dịch Playwright test từ Action Plan đã xác minh. Khi có lỗi runner, Healer replay kịch bản, chụp DOM mới và tự động vá kỹ thuật mà không đổi mong đợi nghiệp vụ.

---

## 🔄 Kiến trúc Hybrid Two-Loop & Multi-Model Adapters

1. **Tất định thắng AI (Deterministic > AI)**: Executor (Playwright/Vitest) luôn là người kiểm chứng cuối cùng. AI không bao giờ tự tuyên bố test pass nếu runner thất bại.
2. **Hỗ trợ đa mô hình AI (Model Adapters)**:
   - **Groq API** (`llama-3.3-70b-versatile` qua `GROQ_API_KEY`).
   - **Ollama Local** (`qwen2.5-coder` chạy offline tại `http://localhost:11434`).
   - Kiến trúc mở rộng dễ dàng tích hợp thêm OpenAI, Claude Code, Copilot CLI, v.v.

---

## 🛠️ Hướng dẫn cài đặt nhanh (Clone & Setup)

### Yêu cầu hệ thống
- **Node.js**: `>= 18.0.0`
- **npm**: `>= 9.0.0`

### 1. Khởi tạo môi trường tự động
Dự án đã tích hợp sẵn script tự động hóa môi trường:
- **Trên Windows**: Click đúp vào `setup.bat` (hoặc chạy trong Terminal/CMD: `setup.bat`).
- **Trên macOS / Linux**: Chạy lệnh `./setup.sh` trong Terminal.

*Script sẽ tự động:*
1. Cài đặt toàn bộ dependencies trong `package.json`.
2. Cài đặt trình duyệt Playwright (`npx playwright install --with-deps`).
3. Khởi tạo file `.env` từ `.env.example`.
4. Tạo cấu trúc thư mục kiểm thử: `tests/unit`, `tests/integration`, `tests/e2e`, `artifacts`.

### 2. Cấu hình API Key
Mở file `.env` ở thư mục gốc và điền khóa API (nếu sử dụng Groq API):
```env
GROQ_API_KEY=gsk_your_groq_api_key_here
```
*(Nếu dùng Ollama Local, chỉ cần đảm bảo dịch vụ Ollama đang chạy tại port 11434).*

---

## 🚀 Hướng dẫn sử dụng & Các câu lệnh CLI

### 1. Chạy CLI Bảng điều khiển tương tác (Interactive Menu)
```bash
npm start
```
Bảng điều khiển hiển thị các chức năng chính:
- `01. Lên kế hoạch & sinh test`: Chọn tầng E2E / Integration / Unit.
- `02. Chạy E2E`: Chạy test giao diện Playwright.
- `03. Chạy Integration`: Chạy test tích hợp API/DB.
- `04. Chạy Unit Test`: Chạy unit test Vitest mã nguồn thật.
- `05. Xác nhận kết quả Unit`: Review và duyệt các expected result đang chờ.
- `06. Xem báo cáo`: Đọc file báo cáo chẩn đoán gần nhất (`artifacts/report.md`).
- `07. Thoát`: Đóng ứng dụng.

### 2. Các câu lệnh NPM Script

| Lệnh Script | Mô tả chức năng |
|---|---|
| `npm start` | Khởi chạy giao diện CLI chính (`src/cli.js`) |
| `npm test` | Chạy toàn bộ file kiểm thử E2E Playwright (`tests/e2e`) |
| `npm run test:headed` | Chạy Playwright E2E hiển thị giao diện trình duyệt |
| `npm run test:ui` | Bật Playwright Interactive UI Mode |
| `npm run test:smoke` | Chạy các test case E2E có tag `@smoke` |
| `npm run test:regression` | Chạy các test case E2E có tag `@regression` |
| `npm run test:unit` | Chạy pipeline Unit Test qua AI TestKit CLI |
| `npm run test:unit:cov` | Chạy Vitest Unit Test và xuất báo cáo Coverage |
| `npm run test:integration` | Chạy test tích hợp API/DB qua Vitest |
| `npm run test:core` | Chạy unit test kiểm tra logic nội bộ của chính TestKit |
| `npm run typecheck:core` | Kiểm tra lỗi kiểu tĩnh TypeScript (`tsconfig.core.json`) |
| `npm run test:all` | Chạy toàn bộ suite Unit và E2E |
| `npm run setup` | Thực thi script `setup.bat` khởi tạo môi trường |

### 3. Chạy ở chế độ Tự động hóa CI/CD (Non-Interactive Mode)
Chạy trực tiếp CLI với các cờ lệnh không cần tương tác thủ công:
```bash
# Chạy Unit Test CI
node src/cli.js --non-interactive --level unit

# Chạy Integration Test CI
node src/cli.js --non-interactive --level integration

# Chạy E2E Test CI với Auth Config
node src/cli.js --non-interactive --level e2e --auth-config .auth/ci-config.json
```

---

## 📁 Cấu trúc thư mục dự án

```text
AIAUTOTEST/
├── .agents/                    # Khai báo kỹ thuật & skills cho AI agents
│   └── skills/
│       └── playwright-e2e-testing/
├── .auth/                      # Lưu trữ phiên xác thực (session.json)
├── .testkit/                   # Dữ liệu nội bộ (crawler locators, snippet cache)
├── artifacts/                  # Báo cáo phân tích, DOM dump và kết quả test
│   ├── unit/                   # Artifacts phân tích & kết quả tầng Unit
│   ├── integration/            # Artifacts tầng Integration Sandbox
│   ├── crawled-dom.md          # Catalog DOM thu thập từ Live Crawler
│   ├── action-plan.json        # Hợp đồng Action Plan đã xác minh
│   └── report.md               # Báo cáo chẩn đoán lỗi gần nhất
├── src/                        # Mã nguồn ứng dụng CLI và AI TestKit
│   ├── adapters/               # Model Adapters (Groq OpenAI, Ollama)
│   ├── agents/                 # Các AI Agent chuyên biệt
│   │   ├── crawler/            # Live Multi-State & Discovery Crawler
│   │   ├── generator/          # Code Generator (E2E & Unit Compiler)
│   │   ├── healer/             # Self-Healing Diagnosis Agent
│   │   └── planner/            # Test Planner & Coverage Guided Loop
│   ├── core/                   # Các module xử lý lõi
│   │   ├── auth/               # Capture & Session Handler
│   │   ├── integration/        # Sandbox Orchestrator & Testcontainers
│   │   ├── unit/               # AST Reader, Oracle Gates, Compiler
│   │   ├── action-plan.ts      # Xây dựng Action Plan
│   │   ├── cli-ui.ts           # Giao diện dòng lệnh CLI UI
│   │   └── locator-resolver.ts # Định danh & giải mã Locators
│   ├── harness/                # Policy & Execution Harness
│   └── cli.js                  # Điểm khởi chạy CLI chính
├── tests/                      # Thư mục chứa mã nguồn kiểm thử
│   ├── e2e/                    # Các file test Playwright E2E (*.spec.ts)
│   ├── integration/            # Test tích hợp API / DB
│   └── unit/                   # Unit test mã nguồn thật
├── .env.example                # Mẫu khai báo biến môi trường
├── package.json                # Định nghĩa dependencies & npm scripts
├── playwright.config.ts        # Cấu hình Playwright Runner
├── setup.bat                   # Script cài đặt tự động (Windows)
├── setup.sh                    # Script cài đặt tự động (macOS/Linux)
├── tsconfig.core.json          # Cấu hình TypeScript cho dự án TestKit
├── vitest.config.mts           # Cấu hình Vitest Runner
└── README.md                   # Tài liệu hướng dẫn sử dụng
```

---

## 📊 Hệ thống Artifacts & Báo cáo

Sau mỗi lần thực thi, hệ thống sẽ tự động tạo và lưu trữ các file artifacts chuẩn hóa trong thư mục `artifacts/`:

### Artifacts tầng E2E
- `source-script-e2e.md`: Kịch bản đầu vào gốc bằng tiếng Việt.
- `test-plan-e2e.json` & `test-plan-e2e.md`: Kế hoạch Action Intent dạng JSON (cho máy) và Markdown (cho người đọc).
- `discovery-dom.md` / `crawled-dom.md`: Snapshot catalog DOM thu thập được từ trình duyệt thật.
- `action-plan.json`: Hợp đồng locator đã xác minh giữa Crawler và Generator.
- `unresolved-actions.json` / `crawler-failures.json`: Chi tiết các bước chưa xác minh được locator để ngăn AI đoán mò.

### Artifacts tầng Unit (`artifacts/unit/<project>/<timestamp>/`)
- `project-manifest.json` & `testability-manifest.json`: Báo cáo phân tích cấu trúc dự án và gán 8 profile kiểm thử.
- `code-index.json`, `branch-map.json`, `dependency-map.json`: Bản đồ AST, nhánh rẽ và phụ thuộc.
- `supporting-context.json` & `context-bundle.json`: Ngữ cảnh đóng gói tối thiểu cung cấp cho Planner.
- `test-plan-unit.json` & `test-plan-unit.md`: Kế hoạch unit test chuẩn hóa.
- `generation-manifest.json` & `test-results.json`: Kết quả biên dịch và thực thi Vitest.
- `coverage-gaps.json` & `coverage-loop.json`: Phân tích điểm thiếu coverage và lịch sử các vòng lặp bổ sung.
- `oracle-resolution.json` & `oracle-requests.json`: Chứng cứ xác minh Expected Value và danh sách cần Tester duyệt.

---

## 🔒 Quản lý Bảo mật & Bí mật

- **Không rò rỉ Secrets**: TestKit tự động lọc bỏ các file `.env`, secret keys, token, `node_modules`, `dist` và `coverage` khỏi prompt gửi sang các AI Model.
- **Ủy quyền Tester**: Mọi thay đổi về Expected Result hay Business Logic ở tầng Unit đều yêu cầu bằng chứng hoặc xác nhận thủ công từ Tester, ngăn ngừa AI tự sửa test để che giấu bug thật.

---

## 📄 Giấy phép & Đóng góp

Dự án phục vụ mục đích phát triển và kiểm thử tự động hóa nâng cao. Mọi đóng góp và báo lỗi xin vui lòng tạo Issue hoặc Pull Request trên Repository.

