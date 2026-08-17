# 🧪 BẢN HƯỚNG DẪN SỬ DỤNG ĐẦY ĐỦ — AIAUTOTEST SYSTEM

Bản hướng dẫn này cung cấp toàn bộ kiến thức, quy trình thao tác và hướng dẫn chi tiết để sử dụng hệ thống **AIAUTOTEST** — Nền tảng kiểm thử tự động đa tầng (E2E, Integration, Unit Test) tích hợp AI Agent và Sandbox Harness cách ly.

---

## 📌 MỤC LỤC
1. [Giới thiệu Tổng quan](#1-giới-thiệu-tổng-quan)
2. [Cấu hình Môi trường & API Key](#2-cấu-hình-môi-trường--api-key)
3. [Hướng dẫn Chi tiết 6 Chức năng CLI Menu](#3-hướng-dẫn-chi-tiết-6-chức-năng-cli-menu)
   - [Chức năng 01: Lên kế hoạch & Sinh test (Planner → Generator)](#chức-năng-01-lên-kế-hoạch--sinh-test-planner--generator)
   - [Chức năng 02: Chạy E2E Test (Playwright UI)](#chức-năng-02-chạy-e2e-test-playwright-ui)
   - [Chức năng 03: Chạy Integration Test (Sandbox Harness)](#chức-năng-03-chạy-integration-test-sandbox-harness)
   - [Chức năng 04: API Integration Test Wizard (No-Code API Test)](#chức-năng-04-api-integration-test-wizard-no-code-api-test)
   - [Chức năng 05: Chạy Unit Test (Vitest Whitebox)](#chức-năng-05-chạy-unit-test-vitest-whitebox)
   - [Chức năng 06: Báo cáo & Lịch sử Kiểm thử](#chức-năng-06-báo-cáo--lịch-sử-kiểm-thử)
4. [Kịch bản Kiểm thử Thực tế (Use Cases)](#4-kịch-bản-kiểm-thử-thực-tế-use-cases)
5. [Xử lý Lỗi Thường gặp (Troubleshooting)](#5-xử-lý-lỗi-thường-gặp-troubleshooting)

---

## 1. GIỚI THIỆU TỔNG QUAN

Hệ thống **AIAUTOTEST** hoạt động dựa trên sự phối hợp giữa 3 Agent trí tuệ nhân tạo và 2 Engine thực thi chuyên dụng:

* **🧠 AI Planner Agent:** Đọc yêu cầu tiếng Việt hoặc file đặc tả OpenAPI (YAML/JSON), tự phân tích nghiệp vụ và lập bản kế hoạch test (Test Intent).
* **👨‍💻 AI Generator Agent / OpenAPI Engine:** Tự động biên dịch kế hoạch thành mã nguồn kiểm thử chuẩn xác (`.test.ts` hoặc `.spec.js`) mà không cần con người phải gõ code.
* **🩺 AI Healer Agent:** Tự động theo dõi, chẩn đoán và sửa lỗi kịch bản khi kịch bản bị lệch locator hoặc môi trường bị thay đổi.
* **🐳 Integration Sandbox Harness:** Môi trường kiểm thử tích hợp 10 bước độc lập, tự bật Docker PostgreSQL container, nạp dữ liệu mẫu và dọn dẹp sạch sẽ sau khi test.

---

## 2. CẤU HÌNH MÔI TRƯỜNG & API KEY

### 2.1. Yêu cầu Hệ thống
* **Node.js**: v18.0.0 trở lên.
* **Docker Desktop**: Cần thiết khi dùng Chức năng `03` (Sandbox với PostgreSQL).
* **Terminal**: Windows PowerShell hoặc Command Prompt.

### 2.2. Cấu hình file `.env`
Mở hoặc tạo file `.env` tại thư mục gốc của dự án (`D:\AIAUTOTEST1-latest\.env`):

#### 🔹 Dùng Google Gemini API (Miễn phí - Khuyên dùng)
```env
GEMINI_API_KEY=AIzaSy_your_gemini_api_key_here
AI_MODEL=gemini-flash-latest
```
*(Lấy key miễn phí tại: [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey))*

#### 🔹 Dùng GROQ API (Miễn phí)
```env
GROQ_API_KEY=gsk_your_groq_key_here
AI_MODEL=llama-3.3-70b-versatile
```
*(Lấy key tại: [https://console.groq.com/keys](https://console.groq.com/keys))*

---

## 3. HƯỚNG DẪN CHI TIẾT 6 CHỨC NĂNG CLI MENU

Khởi động công cụ bằng lệnh:
```bash
npm start
```

---

### 01  Lên kế hoạch & Sinh test (Planner → Generator)
Chức năng này dùng để **chuyển đổi ý tưởng kiểm thử hoặc file đặc tả Swagger/OpenAPI thành file mã nguồn test thật (`.test.ts`)**.

* **Cách sử dụng:**
  1. Chọn Menu `01`.
  2. Chọn tầng kiểm thử:
     - `Integration`: Dành cho kiểm thử API & Database.
     - `E2E`: Dành cho kiểm thử giao diện Web trên trình duyệt.
     - `Unit`: Dành cho kiểm thử logic hàm code trắng (Whitebox).
  3. Nhập kịch bản bằng 1 trong 2 cách:
     - **Cách A (Nạp Swagger/OpenAPI):** Dán đường dẫn file OpenAPI, ví dụ: `D:\AIAUTOTEST1-latest\DRF Start Kit API.yaml` (Hệ thống sẽ bóc tách 100% endpoint trong 0.05s).
     - **Cách B (Tiếng Việt tự nhiên):** Gõ kịch bản như: *"Test luồng đăng nhập tài khoản admin, tạo mới tôn giáo Phật giáo và kiểm tra danh sách"*.
  4. Xác nhận **`Yes`** để Generator tự tạo file test vào thư mục `tests/integration/` hoặc `tests/e2e/`.

---

### 02  Chạy E2E Test (Playwright UI)
Thực thi các kịch bản kiểm thử giao diện web tự động.

* **Tính năng nổi bật:**
  - Tự bật trình duyệt (Chromium/Firefox) để click, nhập liệu như người dùng thật.
  - Tự động ghi video, chụp màn hình khi có lỗi.
  - Tích hợp **AI Healer** tự sửa locator nếu giao diện web bị thay đổi class/id.
* **Đầu ra:** Báo cáo HTML trực quan và hình ảnh lưu tại `artifacts/reports/`.

---

### 03  Chạy Integration Test (Sandbox Harness)
Thực thi toàn bộ các file kiểm thử API & Database trong môi trường Sandbox độc lập.

* **Quy trình 10 bước tự động của Sandbox:**
  1. 🔒 Security Preflight (Kiểm tra bảo mật và câu lệnh).
  2. 🐳 Khởi tạo PostgreSQL Container thật trong Docker.
  3. 🗄️ Chạy Migration cấu hình bảng dữ liệu.
  4. 🌱 Nạp dữ liệu mẫu (Seed Data).
  5. 🌐 Khởi tạo Mock Server (MSW) cho các dịch vụ bên thứ 3 (Cổng thanh toán, SMS...).
  6. 🚀 Khởi chạy Backend Server.
  7. 🩺 Kiểm tra sức khỏe kết nối (Healthcheck Readiness).
  8. 🧪 Thực thi bộ test Vitest (`tests/integration/*.test.ts`).
  9. 📊 Kiểm tra dữ liệu dưới Database thật (DB Assertions).
  10. 🧹 Tự động dọn dẹp và tắt container Docker.

---

### 04  API Integration Test Wizard (No-Code API Test)
Chức năng kiểm thử API trực tiếp cho **BẤT KỲ DỰ ÁN NÀO** (như web Mobifone, web công ty) mà **không cần đụng tới 1 dòng code**.

* **Quy trình 4 bước tương tác đơn giản:**
  1. **Chọn file OpenAPI/Swagger:** Kéo thả file `.yaml` hoặc `.json`.
  2. **Nhập Base URL:** Nhập địa chỉ web đang chạy (Ví dụ: `https://hcm.mobifone.vn`).
  3. **Cấu hình Xác thực (Auth):**
     - Chọn `Bearer Token (JWT)` -> Nhập Token đăng nhập.
     - Hoặc chọn `Public API` nếu không cần đăng nhập.
  4. **Lọc Endpoint (Tùy chọn):** Nhập từ khóa lọc (ví dụ: `/religions/`) hoặc bấm Enter để test toàn bộ.
* **Đầu ra:** Báo cáo Markdown chi tiết phân loại rõ test nào PASS (200 OK), test nào FAIL (404/400).

---

### 05  Chạy Unit Test (Vitest Whitebox)
Dành cho lập trình viên muốn kiểm thử từng hàm, từng component logic độc lập trong mã nguồn dự án.

---

### 06  Xem báo cáo & Lịch sử kiểm thử
Hiển thị danh sách toàn bộ các báo cáo test gần đây, mở báo cáo xem lại kết quả chi tiết dưới dạng bảng và biểu đồ.

---

## 4. KỊCH BẢN KIỂM THỬ THỰC TẾ (USE CASES)

### 🟢 Kịch bản 1: Đã có Web đang chạy + File Swagger (Dành cho Tester)
👉 **Giải pháp:** Sử dụng **Menu `04` (API Wizard)**.
* Không cần cài Docker, không cần viết code.
* Chỉ cần nạp file Swagger + nhập URL web ➔ Có ngay báo cáo 200+ API sau vài giây!

### 🟢 Kịch bản 2: Muốn tự động hóa sinh file `.test.ts` rồi chạy Sandbox Docker
👉 **Giải pháp:**
1. Chọn **Menu `01`** ➔ Chọn `Integration` ➔ Nạp file Swagger.
2. AI tự tạo file `tests/integration/api_generated.test.ts`.
3. Chọn **Menu `03`** để thực thi file test đó trong Docker Sandbox.

---

## 5. XỬ LÝ LỖI THƯỜNG GẶP (TROUBLESHOOTING)

| Lỗi gặp phải | Nguyên nhân | Cách khắc phục |
|---|---|---|
| `401 Invalid API Key` / `402 Payment Required` | API Key của Kimi/Cerebras bị hết hạn hoặc yêu cầu nạp tiền | Chuyển sang dùng **Gemini API** (miễn phí) hoặc **Groq API** trong file `.env`. |
| `RateLimitError 429` | Gửi file Swagger quá lớn qua lượt gọi AI | Đã có **OpenAPI Engine** tự động bóc tách 0 token, cập nhật code mới nhất bằng `npm start`. |
| `Docker Daemon Not Running` | Chưa bật phần mềm Docker Desktop trên máy | Mở ứng dụng **Docker Desktop** trên Windows lên trước khi bấm Menu `03`. |
| `API trả về 404 Not Found` | Đường dẫn có chứa tham số mẫu như `{id}` hoặc `{code}` | Truyền thêm ID thực tế hoặc dùng Token đăng nhập hợp lệ trong Menu `04`. |

---
*Tài liệu được phát triển và duy trì bởi bộ phận tự động hóa kiểm thử AIAUTOTEST.*
