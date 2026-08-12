# 🧪 BÁO CÁO INTEGRATION TEST HARNESS — ❌ FAILED

- **Run ID**: `int_1786543265219`
- **Trạng thái**: ❌ FAILED
- **Thời gian chạy**: `13.26s`
- **Tổng số test**: `1` (Pass: `0`, Fail: `1`)

---

## 🔄 Tiến trình thực thi 10 Bước Sandbox (10-Step Lifecycle)

| Bước | Tên tác vụ | Trạng thái | Thời gian | Chi tiết |
| --- | --- | --- | --- | --- |
| Step 1 | Security Preflight & Config Validation | ✅ OK | 1ms | Config hợp lệ. Đã kiểm tra không có Production DATABASE_URL. |
| Step 2 | Start Test Database | ✅ OK | 1ms | Database đã sẵn sàng: file::memory:?cache=shared |
| Step 3 | Database Migration | ✅ OK | 0ms | Bỏ qua (chưa cấu hình migrationCommand). |
| Step 4 | Seed Test Data | ✅ OK | 0ms | Bỏ qua (chưa cấu hình seedCommand). |
| Step 5 | Start External Mocks | ✅ OK | 0ms | Mocks đã chạy trước khi start server (IN_PROCESS_MSW). |
| Step 6 | Start App Server | ✅ OK | 0ms | Bỏ qua (App Server mode: In-process Route Handlers). |
| Step 7 | Healthcheck Readiness | ✅ OK | 0ms | Bỏ qua healthcheck HTTP. |
| Step 8 | Execute Integration Tests | ❌ FAIL | 13248ms | Vitest run kết thúc. Pass: 0, Fail: 1 |
| Step 9 | Assert Response & DB State | ❌ FAIL | 0ms | Có assertion thất bại. |
| Step 10 | Teardown Resources | ✅ OK | 1ms | Đã giải phóng thành công Containers, Fake HTTP Servers, và Child Processes. |

---

*Báo cáo được tự động khởi tạo bởi Playwright-AI-TestKit Integration Sandbox Harness.*