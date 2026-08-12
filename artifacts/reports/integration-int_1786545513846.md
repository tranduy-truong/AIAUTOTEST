# 🧪 BÁO CÁO INTEGRATION TEST HARNESS — ❌ FAILED

- **Run ID**: `int_1786545513846`
- **Trạng thái**: ❌ FAILED
- **Thời gian chạy**: `1.73s`
- **Tổng số test**: `1` (Pass: `0`, Fail: `1`)

---

## 🔄 Tiến trình thực thi 10 Bước Sandbox (10-Step Lifecycle)

| Bước | Tên tác vụ | Trạng thái | Thời gian | Chi tiết |
| --- | --- | --- | --- | --- |
| Step 1 | Security Preflight & Config Validation | ✅ OK | 1ms | Security Preflight đạt 100%. Đã kiểm tra Hostname, Database URL và Shell Commands. |
| Step 2 | Start Test Database | ✅ OK | 7ms | Database sẵn sàng (Mode: FILE_SQLITE): file:D:\AIAUTOTEST1-latest\artifacts\runs\int_1786545513846\sandbox-integration.sqlite |
| Step 3 | Database Migration | ✅ OK | 0ms | Bỏ qua (chưa cấu hình migrationCommand). |
| Step 4 | Seed Test Data | ✅ OK | 0ms | Bỏ qua (chưa cấu hình seedCommand). |
| Step 5 | Start External Mocks | ✅ OK | 1ms | Mocks sẵn sàng (IN_PROCESS_MSW). |
| Step 6 | Start App Server | ✅ OK | 0ms | Bỏ qua (Chế độ In-process Route Handlers). |
| Step 7 | Healthcheck Readiness | ✅ OK | 0ms | Bỏ qua healthcheck HTTP. |
| Step 8 | Execute Integration Tests | ❌ FAIL | 1716ms | Vitest JSON Report: Total=1, Pass=0, Fail=1 |
| Step 9 | Post-run Verification & DB Assertions | ❌ FAIL | 0ms | Tất cả Schema response và DB connectivity assertions đã vượt qua kiểm tra. |
| Step 10 | Teardown Resources | ✅ OK | 0ms | Đã hoàn tất dọn dẹp Containers, Mocks và Tiến trình. |

---

*Báo cáo được tự động khởi tạo bởi Playwright-AI-TestKit Integration Sandbox Harness.*