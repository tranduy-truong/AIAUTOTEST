# Hướng dẫn sử dụng AI Automation Test Toolkit

Tài liệu này dành cho tester, QA, developer và mentor muốn cài đặt, tạo và chạy kiểm thử tự động bằng bộ công cụ trong repository `AIAUTOTEST`.

> Tài liệu được viết theo mã nguồn trên nhánh `main`. Các file test và artifact được sinh ra ở máy người dùng, phần lớn đã được `.gitignore` để tránh đưa URL, tài khoản và dữ liệu kiểm thử lên GitHub.

## 1. Công cụ này làm được gì?

Toolkit hỗ trợ ba tầng kiểm thử:

| Tầng | Mục đích | Công nghệ chạy test | Đầu vào chính |
|---|---|---|---|
| E2E | Kiểm thử luồng người dùng trên giao diện website | Playwright | Kịch bản tiếng Việt và website thật |
| Integration | Kiểm thử API, database và dịch vụ phụ thuộc trong sandbox | Vitest, MSW/fake HTTP server, SQLite/Testcontainers | Mô tả API và `testkit.integration.json` |
| Unit | Kiểm thử hàm hoặc public method trong source JavaScript/TypeScript | Vitest | Thư mục dự án, file nguồn hoặc đoạn code có `export` |

Kiến trúc công khai gồm ba agent:

1. **Planner** chuyển yêu cầu của tester thành kế hoạch kiểm thử có cấu trúc.
2. **Generator** sinh mã test từ kế hoạch đã được xác minh.
3. **Healer** phân loại lỗi, thu thập lại bằng chứng khi cần và chỉ sửa phần kỹ thuật nếu không làm thay đổi kết quả mong đợi.

Riêng E2E có **Live Crawler** làm công cụ hỗ trợ Planner: crawler mở website thật, thực hiện từng Action Intent và xác minh locator trước khi Generator được phép sinh code.

## 2. Yêu cầu trước khi cài đặt

### 2.1. Bắt buộc

- Git.
- Node.js 22.x và npm. GitHub Actions của dự án đang sử dụng Node.js 22.
- Kết nối Internet để cài npm package, trình duyệt Playwright và gọi Groq API khi luồng cần AI.
- Một API key Groq hợp lệ. Adapter hiện tại gọi endpoint tương thích OpenAI của Groq với model mặc định `llama-3.3-70b-versatile`.
- Quyền truy cập website hoặc source code mà bạn được phép kiểm thử.

Kiểm tra môi trường:

```bash
git --version
node --version
npm --version
```

Khuyến nghị kết quả `node --version` bắt đầu bằng `v22`.

### 2.2. Tùy chọn

- Docker Desktop hoặc Docker Engine: chỉ cần khi Integration Test dùng PostgreSQL/MySQL qua Testcontainers.
- VS Code: thuận tiện để nhập kịch bản trong editor do CLI mở.
- Ollama và model `qwen2.5-coder`: repository có adapter local, nhưng luồng Planner/Generator hiện tại đang khởi tạo `OpenAIAdapter` dùng Groq. Không nên mặc định rằng chỉ cài Ollama là đủ.

## 3. Tải mã nguồn

```bash
git clone https://github.com/tranduy-truong/AIAUTOTEST.git
cd AIAUTOTEST
```

Nếu đã clone từ trước:

```bash
git switch main
git pull origin main
```

Không chạy `git pull` khi đang có thay đổi chưa commit mà chưa kiểm tra `git status`.

## 4. Cài đặt lần đầu

### 4.1. Windows

Cách nhanh nhất:

1. Mở thư mục dự án.
2. Chạy `setup.bat`; hoặc mở PowerShell/CMD tại thư mục dự án và chạy:

```bat
setup.bat
```

Script sẽ:

- chạy `npm install`;
- cài trình duyệt và dependency của Playwright;
- tạo `.env` từ `.env.example` nếu chưa có;
- tạo `tests/unit`, `tests/integration`, `tests/e2e` và `artifacts`.

Nếu bước `npx playwright install --with-deps` báo lỗi quyền trên Windows, thử cài browser bằng:

```bash
npx playwright install
```

### 4.2. macOS/Linux

```bash
chmod +x setup.sh
./setup.sh
```

Nếu không muốn chạy script:

```bash
npm install
npx playwright install --with-deps
cp .env.example .env
mkdir -p tests/unit tests/integration tests/e2e artifacts
```

### 4.3. Cấu hình API key

Mở `.env` và điền:

```env
GROQ_API_KEY=your_real_groq_api_key
```

Lưu ý bảo mật:

- Không gửi API key vào kịch bản test.
- Không commit `.env`; file này đã nằm trong `.gitignore`.
- Không chụp màn hình hoặc chia sẻ log có chứa key, JWT, mật khẩu.
- Workflow E2E hiện đặt biến `OPENAI_API_KEY`, trong khi adapter mã nguồn đọc `GROQ_API_KEY`. Nếu chạy pipeline có bước gọi AI, secret cần thống nhất với biến mà adapter thực sự đọc.

### 4.4. Kiểm tra cài đặt

```bash
npm run typecheck:core
npm run test:core
```

Nếu hai lệnh chạy thành công, mở ứng dụng:

```bash
npm start
```

## 5. Làm quen với menu chính

`npm start` mở menu tương tác:

| Mục | Chức năng |
|---|---|
| 01. Lên kế hoạch & sinh test | Chọn E2E, Integration hoặc Unit; chạy Planner rồi Generator |
| 02. Chạy E2E | Chạy các spec hiện có trong `tests/e2e` bằng Playwright |
| 03. Chạy Integration | Khởi tạo sandbox và chạy Integration Test |
| 04. Chạy Unit Test | Chạy bộ Unit Test được sinh gần nhất trong dự án đích |
| 05. Xác nhận kết quả Unit | Xử lý các expected result mà hệ thống chưa tự chứng minh được |
| 06. Xem báo cáo | Hiển thị `artifacts/report.md` gần nhất |
| 07. Thoát | Đóng CLI |

Sử dụng phím mũi tên để chọn, `Enter` để xác nhận và `Space` để đánh dấu checkbox.

## 6. Quy trình E2E từ kịch bản tiếng Việt

### 6.1. Chuẩn bị website và dữ liệu

Trước khi chạy:

- xác nhận URL truy cập được từ máy đang chạy toolkit;
- dùng tài khoản test, không dùng tài khoản production nếu không cần thiết;
- chuẩn bị dữ liệu có thể tạo/xóa an toàn;
- đảm bảo tester có quyền thực hiện các thao tác trong kịch bản;
- không trộn test của nhiều website trong một lần sinh suite.

Mỗi lần Generator sinh E2E sẽ tạo suite trong `tests/e2e`. Các file `*.spec.ts` và `*.spec.js` ở đây bị Git bỏ qua vì có thể chứa URL hoặc dữ liệu đăng nhập.

### 6.2. Cách viết kịch bản tốt

Chọn:

`01. Lên kế hoạch & sinh test` → `E2E (Kiểm thử luồng giao diện - Blackbox)`

CLI mở editor để nhập kịch bản. Nên tuân theo mẫu:

```text
URL: https://staging.example.com/dang-nhap

TC_LOGIN_01: Đăng nhập thành công
- Mở URL
- Nhập 'tester01' vào ô 'Nhập tên đăng nhập'
- Nhập 'test-password' vào ô 'Nhập mật khẩu'
- Bấm nút 'Đăng nhập'
- Kiểm tra: URL không còn chứa 'dang-nhap'

TC_LOGIN_02: Bỏ trống thông tin đăng nhập
- Mở URL
- Để trống ô 'Nhập tên đăng nhập'
- Để trống ô 'Nhập mật khẩu'
- Bấm nút 'Đăng nhập'
- Kiểm tra: đồng thời hiển thị 'Vui lòng nhập tên đăng nhập' và 'Vui lòng nhập mật khẩu'
```

Nguyên tắc viết:

- Mỗi test case có ID duy nhất, ưu tiên dạng `TC_MODULE_01`.
- Ghi URL cụ thể ở đầu kịch bản hoặc trong từng test case nếu URL khác nhau.
- Mỗi gạch đầu dòng nên mô tả một hành động hoặc một nhóm kiểm tra thực sự đồng thời.
- Dùng đúng chữ đang nhìn thấy trên giao diện: label, placeholder, tên nút, tên option.
- Nói rõ đối tượng khi trang có nhiều phần tử giống nhau, ví dụ: `Trong hộp thoại Thêm tổ chức, nhập ...`.
- Với icon không có chữ, mô tả cả ngữ cảnh và tác dụng, ví dụ: `Bấm nút biểu tượng con mắt bên phải ô Nhập mật khẩu để hiện mật khẩu`.
- Viết expected result có thể quan sát: URL, text, trạng thái visible/hidden, kiểu input, toast, dòng dữ liệu.
- Không dùng câu mơ hồ như `kiểm tra đúng`, `bấm cái đó`, `thành công là được`.
- Nếu một bước phụ thuộc dữ liệu tạo trước đó, ghi rõ dữ liệu và thứ tự.

### 6.3. Planner xử lý gì?

Planner:

- lưu kịch bản gốc tại `artifacts/source-script-e2e.md`;
- tách câu tiếng Việt thành Action Intent nguyên tử;
- chia kịch bản lớn theo test case để giảm nguy cơ vượt giới hạn token;
- kiểm tra bước, dữ liệu và assertion có thật trong kịch bản;
- từ chối output hỏng JSON hoặc có locator do AI tự đoán;
- tạo `artifacts/test-plan-e2e.json` và bản dễ đọc `artifacts/test-plan-e2e.md`.

Nếu Planner dừng, đọc:

- `artifacts/planner-validation-errors.json`;
- `artifacts/test-plan-e2e.invalid.txt` nếu có.

Sửa kịch bản gốc cho rõ hơn rồi chạy lại, không chỉnh tay Action Plan để che lỗi yêu cầu.

### 6.4. Đăng nhập và tái sử dụng phiên

Khi Crawler bắt đầu, CLI hỏi website có yêu cầu đăng nhập không.

#### Không cần đăng nhập

Chọn `No`. Crawler dùng chiến lược `NONE`.

#### Đăng nhập bằng form

Chọn:

`Yes` → `Đăng nhập qua form (Username + Password)`

Nhập:

- URL trang đăng nhập;
- username/email;
- password;
- label ô username và password nếu muốn chỉ định;
- URL/path sau đăng nhập nếu website redirect khó tự nhận biết.

Hệ thống mở Chromium ở chế độ headless, điền form, chờ rời trang đăng nhập và lưu:

- `.auth/session.json`;
- `.auth/storage-state.json`.

Lần sau CLI hỏi có dùng lại session cũ không. Chọn `No` nếu tài khoản, website hoặc môi trường đã thay đổi. Để buộc đăng nhập lại hoàn toàn, xóa hai file trên khi CLI không chạy.

#### JWT Header

Chọn `JWT Token` và nhập token. Hệ thống inject header:

```text
Authorization: Bearer <token>
```

Chỉ dùng token của môi trường test và không đưa token vào Git.

### 6.5. Live Crawler và Guided Learning ngầm

Crawler thực hiện từng bước trên DOM thật. Thứ tự ưu tiên là locator ổn định như role, label, placeholder, text, test id và locator đã học trước đó.

Khi không xác minh được duy nhất một phần tử, hệ thống có thể yêu cầu tester hỗ trợ chọn mẫu. Locator đã xác minh được ghi vào `.testkit/crawler-locators.json`. Đây là bộ nhớ kỹ thuật nội bộ, không phải agent thứ tư và đã bị Git bỏ qua.

Crawler tạo:

- `artifacts/crawled-dom.md`: catalog DOM rút gọn;
- `artifacts/action-plan.json`: hợp đồng locator đã xác minh;
- `artifacts/crawler-failures.json`: lỗi theo bước;
- `artifacts/unresolved-actions.json`: action chưa đủ độ tin cậy.

Nếu còn action `confidence: low`, Generator bị chặn. Đây là hành vi an toàn để không sinh locator đoán mò.

### 6.6. Generator sinh E2E

Sau khi Planner và Crawler thành công, chọn `Yes` khi CLI hỏi `Kế hoạch đã sẵn sàng. Sinh file test ngay?`.

Generator chỉ dùng `action-plan.json` đã xác minh, giữ nguyên expected result và tạo file có tên dễ đọc kèm ngày, ví dụ:

```text
tests/e2e/dang_nhap_thanh_cong_2026_08_14.spec.ts
```

Nếu chạy sinh nhiều lần trong cùng ngày, tên có hậu tố `_02`, `_03`, ... để không ghi đè nhầm.

### 6.7. Chạy E2E

Qua menu: chọn `02. Chạy E2E`.

Hoặc chạy trực tiếp:

```bash
# Tất cả trình duyệt trong playwright.config.ts
npx playwright test

# Chỉ Chromium
npx playwright test --project=chromium

# Hiện trình duyệt
npm run test:headed

# Giao diện Playwright UI
npm run test:ui

# Một file cụ thể, tuần tự và hiện trình duyệt
npx playwright test tests/e2e/ten_file.spec.ts --project=chromium --headed --workers=1

# Xem báo cáo HTML gần nhất
npx playwright show-report
```

Cấu hình hiện tại:

- thư mục test: `tests/e2e`;
- timeout mỗi test: 30 giây;
- local chạy song song theo mặc định;
- CI retry 2 lần, dùng 2 worker;
- trace được ghi ở lần retry đầu tiên;
- ba project: Chromium, Firefox, WebKit.

Khi đang điều tra dropdown, modal hoặc dữ liệu phụ thuộc thứ tự, nên chạy một browser và `--workers=1` để log dễ đọc.

### 6.8. Healer khi E2E lỗi

Nếu E2E lỗi qua menu, Healer đọc log và phân loại lỗi như locator thay đổi, timing, dữ liệu, môi trường, mạng, assertion hoặc xác thực.

Healer có thể crawl lại và sinh lại phần kỹ thuật khi có đủ bằng chứng. Healer không được tự đổi expected result để làm test pass. Báo cáo gần nhất nằm ở:

```text
artifacts/report.md
```

## 7. Quy trình Unit Test Whitebox

### 7.1. Điều kiện của dự án đích

- Dự án là JavaScript/TypeScript.
- Đã cấu hình Vitest hoặc Jest để Code Reader nhận biết framework.
- Target là hàm/arrow function được `export`, hoặc public method của class export.
- Phiên bản hiện tại chỉ có deterministic compiler cho Vitest. Dự án Jest có thể được nhận diện nhưng báo `PROFILE_NOT_SUPPORTED` ở bước sinh.
- Toolkit không tự cài test runner vào dự án đích.

### 7.2. Tạo Unit Test

Chọn:

`01. Lên kế hoạch & sinh test` → `Unit`

Chọn một cách cung cấp source:

1. **Chọn thư mục dự án**: phù hợp khi cần quét nhiều file.
2. **Chọn một file nguồn**: nhanh và rõ phạm vi.
3. **Dán đoạn code export**: dùng thử nhanh; code được lưu tạm dưới `.testkit/unit-inputs/`.

Nhập đường dẫn tuyệt đối hoặc tương đối hợp lệ. Ví dụ Windows:

```text
D:\Projects\shop-api\src\services\discount.ts
```

Ví dụ macOS/Linux:

```text
/home/tester/projects/shop-api/src/services/discount.ts
```

Sau khi quét, CLI hiển thị:

- tên dự án;
- số file nguồn;
- số target có thể test;
- test framework.

Nếu có nhiều target, chọn target cụ thể là phương án khuyến nghị để context nhỏ và kết quả dễ kiểm soát.

### 7.3. Nhập requirement và expected result

Editor cho phép nhập yêu cầu nghiệp vụ. Ví dụ:

```text
Hàm calculateDiscount:
- Khách hàng thường nhận giảm giá 0%.
- Hạng SILVER nhận 5% khi tổng đơn từ 1.000.000 đồng.
- Hạng GOLD nhận 10% khi tổng đơn từ 1.000.000 đồng.
- Tổng tiền âm phải throw lỗi có chứa "invalid amount".
```

Nếu để trống, Planner chỉ dùng hành vi có thể suy ra từ AST. AI chỉ bổ sung khi deterministic planner chưa đủ context.

### 7.4. Hiểu các profile testability

| Profile | Ý nghĩa thực tế |
|---|---|
| `UNIT_NATIVE` | Có thể test trực tiếp |
| `UNIT_MOCKED` | Có dependency nhưng có thể mock an toàn |
| `COMPONENT_DOM` | Component cần môi trường DOM |
| `INTEGRATION_SANDBOX` | Phù hợp hơn với sandbox tích hợp |
| `PROCESS_SANDBOX` | Cần cô lập process |
| `ENTRYPOINT_SMOKE` | Chỉ nên smoke test entrypoint |
| `NO_RUNTIME_TEST` | Không có hành vi runtime đáng test |
| `REFACTOR_REQUIRED` | Khó cô lập; nên refactor trước |

`NO_RUNTIME_TEST` là một kết quả phân tích hợp lệ, không phải hệ thống bỏ sót test.

### 7.5. Oracle Gate và xác nhận của tester

Toolkit không tin expected result do AI tự đề xuất. Một expected chỉ được dùng khi có một trong các bằng chứng:

- requirement của tester;
- AST evaluator chứng minh từ source thuần;
- mock-trace chứng minh qua hành vi dependency có cấu trúc;
- tester xác nhận trực tiếp trên CLI.

Nếu có case đang chờ, dùng mục `05. Xác nhận kết quả Unit`. Với từng case, tester có thể:

- xác nhận đề xuất;
- nhập lại giá trị đúng;
- tạm bỏ qua;
- đánh dấu cần BA/developer xem thêm;
- xem lý do kỹ thuật;
- dừng và lưu các lựa chọn đã làm.

Chỉ xác nhận expected nếu đó thật sự là hành vi nghiệp vụ mong muốn. Không xác nhận chỉ vì muốn test chuyển sang màu xanh.

### 7.6. Vị trí file và artifact Unit

File test được sinh vào dự án đích:

```text
<du-an-dich>/tests/unit/ai-generated/
```

Artifact của từng phiên:

```text
artifacts/unit/<project>/<yyyyMMdd_HHmmss_SSS>/
├── project-manifest.json
├── testability-manifest.json
├── code-index.json
├── branch-map.json
├── dependency-map.json
├── supporting-context.json
├── test-plan-unit.json
├── test-plan-unit.md
├── oracle-resolution.json
├── oracle-requests.json
├── generation-manifest.json
├── test-results.json
├── coverage-gaps.json
├── coverage-loop.json
├── untestable-targets.json
└── healer-diagnosis.json
```

Một số file chỉ xuất hiện khi có dữ liệu tương ứng.

### 7.7. Chạy Unit Test

Chọn `04. Chạy Unit Test`. Toolkit chạy suite được sinh gần nhất trong đúng thư mục dự án đích, không phải mặc định chạy unit test nội bộ của toolkit.

Nếu project có coverage provider, hệ thống đọc coverage, ánh xạ gap về branch và có thể chạy tối đa ba vòng bổ sung. Vòng lặp dừng khi coverage không tăng. Tắt bằng biến môi trường:

Windows PowerShell:

```powershell
$env:UNIT_COVERAGE_LOOP="0"
npm start
```

macOS/Linux:

```bash
UNIT_COVERAGE_LOOP=0 npm start
```

Healer Unit ở chế độ `diagnose-only`: không sửa source sản phẩm, không đổi expected và không skip test.

## 8. Quy trình Integration Test Sandbox

### 8.1. Tạo kế hoạch và code Integration

Chọn:

`01. Lên kế hoạch & sinh test` → `Integration`

Nhập endpoint, JSON hoặc nội dung Swagger/OpenAPI có liên quan. Nên bổ sung:

- method và path;
- request body/query/header;
- status code mong đợi;
- response schema;
- dữ liệu database cần kiểm tra;
- external service nào phải mock;
- trường hợp thành công và thất bại.

### 8.2. Cấu hình `testkit.integration.json`

Nếu không có file này ở thư mục chạy, toolkit dùng mặc định PostgreSQL Testcontainers với image `postgres:17`. Để dễ chạy local không cần Docker, có thể dùng SQLite:

```json
{
  "version": 1,
  "projectName": "my-api",
  "projectRoot": ".",
  "testDirectory": "tests/integration",
  "database": {
    "strategy": "SQLITE_MEMORY",
    "engine": "sqlite",
    "migrationCommand": "npm run db:migrate:test",
    "seedCommand": "npm run db:seed:test"
  },
  "externalMocks": {
    "mode": "IN_PROCESS_MSW",
    "fakeServices": []
  },
  "appServer": {
    "enabled": false,
    "startCommand": "npm run start:test",
    "healthEndpoint": "http://localhost:3000/api/health",
    "startupTimeoutMs": 15000
  },
  "security": {
    "blockProductionUrls": true,
    "allowedHostnames": ["localhost", "127.0.0.1"],
    "redactSecretsInLogs": true
  }
}
```

Các database strategy:

| Strategy | Dùng khi | Yêu cầu |
|---|---|---|
| `SQLITE_MEMORY` | Logic SQL tương thích SQLite, cần chạy nhanh | Không cần Docker |
| `TESTCONTAINERS` | Cần hành vi thật của PostgreSQL/MySQL | Docker đang hoạt động |
| `EXTERNAL_TEST_DB` | Có database test riêng | Tên biến môi trường kết nối; tuyệt đối không trỏ production |

Ví dụ PostgreSQL:

```json
{
  "database": {
    "strategy": "TESTCONTAINERS",
    "engine": "postgres",
    "image": "postgres:17",
    "databaseName": "my_api_test",
    "migrationCommand": "npm run db:migrate:test",
    "seedCommand": "npm run db:seed:test"
  }
}
```

Ví dụ external test database:

```json
{
  "database": {
    "strategy": "EXTERNAL_TEST_DB",
    "connectionEnv": "TEST_DATABASE_URL",
    "migrationCommand": "npm run db:migrate:test"
  }
}
```

Luôn bật `blockProductionUrls` và chỉ allow hostname test/local. Nếu Docker không khả dụng trong chế độ Testcontainers, adapter trả `INFRASTRUCTURE_UNAVAILABLE` và Orchestrator dừng, không tạo URL database giả.

### 8.3. Chạy Integration

Qua menu: `03. Chạy Integration`.

Hoặc:

```bash
npm run test:integration
```

Pipeline sandbox quản lý vòng đời database, mock service, app server, health check, test runner và cleanup. Không tắt terminal giữa lúc cleanup trừ khi tiến trình bị treo thực sự.

## 9. Chạy bằng lệnh npm

| Lệnh | Tác dụng |
|---|---|
| `npm start` | Mở menu tương tác |
| `npm test` | Chạy Playwright E2E |
| `npm run test:headed` | Chạy E2E có giao diện browser |
| `npm run test:ui` | Mở Playwright UI |
| `npm run test:smoke` | Chạy test có tag `@smoke` |
| `npm run test:regression` | Chạy test có tag `@regression` |
| `npm run test:core` | Chạy unit test nội bộ của toolkit |
| `npm run test:unit:cov` | Chạy unit test nội bộ và coverage |
| `npm run test:integration` | Chạy test tích hợp nội bộ trong `tests/integration` |
| `npm run typecheck:core` | Type-check core TypeScript |
| `npm run test:e2e` | Gọi CLI với `--level e2e`; ở non-interactive mode chỉ chạy suite E2E đã tồn tại |

Phân biệt quan trọng:

- `npm run test:core` kiểm tra chính mã nguồn của toolkit.
- Mục `04. Chạy Unit Test` chạy suite AI-generated gần nhất của dự án đích.
- `npm run test:e2e` không tự hỏi kịch bản và không tự sinh suite trong non-interactive mode.

## 10. Artifact và cách đọc

| File | Khi nào xem |
|---|---|
| `source-script-e2e.md` | Xác nhận đầu vào gốc |
| `test-plan-e2e.json` | Hợp đồng máy của Planner |
| `test-plan-e2e.md` | Đọc kế hoạch bằng Markdown |
| `crawled-dom.md` | Xem DOM rút gọn theo trạng thái |
| `action-plan.json` | Xem locator/code đã được Crawler xác minh |
| `crawler-failures.json` | Tìm bước crawler thất bại |
| `unresolved-actions.json` | Tìm action khiến Generator bị chặn |
| `report.md` | Chẩn đoán lỗi gần nhất |
| `test-results.json` | Kết quả chạy test có cấu trúc |

Thư mục `artifacts/` bị Git bỏ qua. Khi cần gửi lỗi cho developer, hãy kiểm tra và che username, password, JWT, API key, URL nội bộ và dữ liệu cá nhân trước.

## 11. Xử lý lỗi thường gặp

### 11.1. `GROQ_API_KEY` thiếu hoặc không hợp lệ

Dấu hiệu: Planner/Generator báo lỗi AI API, 401 hoặc authentication.

Cách xử lý:

1. kiểm tra `.env` nằm ở thư mục gốc;
2. tên biến phải là `GROQ_API_KEY`;
3. không có dấu nháy thừa hoặc khoảng trắng quanh key;
4. đóng và mở lại terminal rồi chạy `npm start`.

### 11.2. Lỗi 413 hoặc vượt token/rate limit

- Rút gọn kịch bản, mỗi lần xử lý một module nghiệp vụ.
- Giữ từng test case dưới khoảng 14 bước rõ ràng.
- Không dán toàn bộ HTML/Swagger khổng lồ nếu chỉ test một endpoint.
- Chờ quota được khôi phục nếu nhà cung cấp báo rate limit.

### 11.3. Playwright báo browser executable không tồn tại

```bash
npx playwright install --with-deps
```

Windows có thể dùng:

```bash
npx playwright install
```

### 11.4. Crawler không tìm thấy locator duy nhất

- Kiểm tra text/label trong kịch bản có đúng giao diện hiện tại không.
- Bổ sung ngữ cảnh modal, form, row hoặc section.
- Với dropdown custom, mô tả bước mở dropdown rồi chọn option.
- Với icon, mô tả chức năng và vị trí tương đối.
- Đóng popup/banner che phần tử trước khi thao tác.
- Đọc `crawler-failures.json` và `unresolved-actions.json`.

Không chữa bằng `nth()` hoặc CSS dài nếu chưa chứng minh thứ tự phần tử ổn định.

### 11.5. `locator.fill` nhận nhầm `div`

Kịch bản chưa chỉ rõ input hoặc trang có nhiều phần tử cùng text. Viết lại, ví dụ:

```text
Trong hộp thoại 'Thêm tổ chức', nhập 'Giáo xứ A' vào ô input có placeholder 'Nhập tên tổ chức'.
```

### 11.6. Timeout 30 giây

- Xác minh mạng và website không đang lỗi.
- Kiểm tra có bị redirect về login hay không.
- Kiểm tra session cũ đã hết hạn.
- Chạy một browser, một worker và headed để quan sát.
- Nếu ứng dụng thực sự tải chậm, chỉ tăng timeout sau khi đã loại trừ locator sai.

### 11.7. Sau đăng nhập vẫn ở `/dang-nhap?redirect=...`

- Kiểm tra credentials.
- Nhập đúng `expectedRedirectUrl`.
- Chỉ định label username/password nếu auto-detect chọn sai.
- Xóa `.auth/session.json` và `.auth/storage-state.json`, sau đó capture lại.

### 11.8. Docker không chạy

Nếu Integration dùng `TESTCONTAINERS`, mở Docker và kiểm tra:

```bash
docker version
docker ps
```

Nếu nghiệp vụ không cần PostgreSQL/MySQL thật, chuyển sang `SQLITE_MEMORY`. Không dùng một URL giả hoặc database production để né lỗi Docker.

### 11.9. Unit không tìm thấy target

- Hàm phải được `export`.
- Tránh trỏ vào file chỉ chứa interface/type.
- Với class, chọn public method.
- Kiểm tra file có cú pháp TypeScript/JavaScript hợp lệ.

### 11.10. Unit bị `NEEDS_ORACLE` hoặc `SOURCE_CONFLICT`

- `NEEDS_ORACLE`: expected chưa có bằng chứng; vào mục 05 để xác nhận hoặc bổ sung requirement.
- `SOURCE_CONFLICT`: source hiện tại khác hợp đồng đã lập; không ép chạy CI, hãy lập kế hoạch lại sau khi đồng bộ source.

## 12. CI/CD trên GitHub Actions

Repository có ba workflow chạy khi push hoặc tạo pull request vào `main`/`develop`:

- `.github/workflows/unit.yml`;
- `.github/workflows/integration.yml`;
- `.github/workflows/e2e.yml`.

### 12.1. Secrets E2E xác thực bằng form

Trong GitHub repository, vào `Settings` → `Secrets and variables` → `Actions` và tạo:

| Secret | Nội dung |
|---|---|
| `AUTH_LOGIN_URL` | URL trang đăng nhập môi trường test |
| `AUTH_USERNAME` | Tài khoản test |
| `AUTH_PASSWORD` | Mật khẩu test |
| `AUTH_REDIRECT_URL` | URL/path sau đăng nhập |

Mã nguồn `loadAuthConfig` cũng hỗ trợ `AUTH_JWT_TOKEN` cho chiến lược JWT khi workflow/config được cấu hình tương ứng.

### 12.2. Giới hạn E2E CI hiện tại

Các spec E2E được sinh trong `tests/e2e/*.spec.ts` đang bị `.gitignore`. Workflow E2E lại chạy non-interactive và chỉ thực thi suite đã có; nó không có kịch bản để Planner/Crawler/Generator sinh mới. Vì vậy, để E2E CI thực sự chạy test nghiệp vụ, đội dự án phải chọn một chiến lược rõ ràng:

1. lưu các spec đã kiểm duyệt trong một đường dẫn được phép commit; hoặc
2. cung cấp kịch bản và bước generation an toàn trong workflow; hoặc
3. tải suite đã sinh từ artifact/release tin cậy.

Không xóa ignore và commit credential cứng. Nếu spec có dữ liệu nhạy cảm, thay bằng biến môi trường hoặc secret trước.

### 12.3. Chạy non-interactive local

```bash
npm start -- --level unit --non-interactive
npm start -- --level integration --non-interactive
npm start -- --level e2e --non-interactive
```

Lưu ý: các lệnh này chạy phiên/suite đã chuẩn bị trước; chúng không thay thế bước nhập kịch bản tương tác.

## 13. Quy tắc an toàn và dữ liệu kiểm thử

- Chỉ test hệ thống được cấp quyền.
- Ưu tiên staging/UAT; không chạy destructive test trên production.
- Dùng tài khoản test có quyền tối thiểu.
- Không ghi API key/JWT/mật khẩu vào README, issue, commit hoặc ảnh chụp.
- Không dùng database production trong Integration Sandbox.
- Đặt tên dữ liệu test có thể nhận biết và có kế hoạch cleanup.
- Review assertion trước khi xác nhận Oracle Unit.
- Review file generated trước khi đưa vào CI.

## 14. Quy trình khuyến nghị cho tester mới

1. Clone repo và chạy setup.
2. Điền `GROQ_API_KEY` vào `.env`.
3. Chạy `npm run typecheck:core` và `npm run test:core`.
4. Bắt đầu bằng một E2E test case 4–6 bước trên staging.
5. Chạy `npm start`, sinh E2E và xem `test-plan-e2e.md`.
6. Để Crawler xác minh toàn bộ action.
7. Sinh spec và chạy Chromium headed với một worker.
8. Khi pass, chạy đủ ba browser nếu sản phẩm yêu cầu cross-browser.
9. Lưu artifact chẩn đoán đã che dữ liệu nhạy cảm nếu cần báo lỗi.
10. Chỉ mở rộng sang nhiều test case sau khi luồng đầu tiên ổn định.

## 15. Checklist trước khi báo cáo kết quả

- [ ] Đúng branch và commit của website/source cần test.
- [ ] Môi trường là staging/UAT hoặc sandbox được phép.
- [ ] Kịch bản có ID, bước và expected result rõ ràng.
- [ ] Không còn `unresolved-actions`.
- [ ] File generated import/chỉ tới đúng source hoặc URL.
- [ ] Test đã chạy ít nhất một lần trên Chromium.
- [ ] Đã kiểm tra trace/report khi có retry hoặc lỗi.
- [ ] Không có secret trong log và artifact chia sẻ.
- [ ] Phân biệt product bug với test script/environment error.
- [ ] Ghi rõ số test pass, fail, skipped và nguyên nhân.

## 16. Cấu trúc thư mục cần nhớ

```text
AIAUTOTEST/
├── .auth/                         # Session đăng nhập local, không commit
├── .github/workflows/             # CI Unit, Integration, E2E
├── .testkit/                      # Bộ nhớ crawler và input tạm, không commit
├── artifacts/                     # Kế hoạch, DOM, kết quả, báo cáo, không commit
├── docs/                          # Tài liệu người dùng
├── src/
│   ├── agents/
│   │   ├── planner/
│   │   ├── generator/
│   │   ├── healer/
│   │   └── crawler/
│   ├── core/
│   └── cli.js
├── tests/
│   ├── e2e/
│   ├── integration/
│   └── unit/
├── .env.example
├── package.json
├── playwright.config.ts
├── setup.bat
└── setup.sh
```

## 17. Tóm tắt nhanh

```bash
# Cài đặt
git clone https://github.com/tranduy-truong/AIAUTOTEST.git
cd AIAUTOTEST
npm install
npx playwright install --with-deps

# Tạo .env và điền GROQ_API_KEY
cp .env.example .env

# Kiểm tra toolkit
npm run typecheck:core
npm run test:core

# Mở CLI để lập kế hoạch và sinh test
npm start

# Chạy E2E đã sinh
npx playwright test --project=chromium --headed --workers=1

# Xem Playwright report
npx playwright show-report
```

Khi hệ thống dừng vì thiếu bằng chứng, hãy sửa đầu vào hoặc cung cấp xác nhận của tester. Không ép Generator/Healer đoán locator hoặc expected result.
