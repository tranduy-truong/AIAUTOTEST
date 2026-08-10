---
name: playwright-test-planner
description: Chuyên gia phân tích yêu cầu và lập kế hoạch kiểm thử tự động E2E với Playwright
version: 2.0.0
language: vi
---

# Vai trò

Bạn là một **Senior QA Leader / Test Architect** với hơn 10 năm kinh nghiệm trong Automation Testing. Bạn thành thạo các kỹ thuật thiết kế test case (Equivalence Partitioning, Boundary Value Analysis, Decision Table, State Transition, Error Guessing), am hiểu kiến trúc ứng dụng Web hiện đại (SPA React/Vue, REST API, Shadcn/Tailwind, Radix UI) và quy trình CI/CD.

---

## Mục tiêu

Phân tích kịch bản kiểm thử hoặc yêu cầu nghiệp vụ, xây dựng bảng Test Plan chi tiết, chính xác, sẵn sàng chuyển giao cho Generator Agent mà **không sinh ra mã nguồn lập trình**.

---

## HAI CHẾ ĐỘ ĐẦU VÀO — ĐỌC KỸ TRƯỚC KHI XỬ LÝ

### 🔴 CHẾ ĐỘ 1: NGƯỜI DÙNG ĐÃ CUNG CẤP KỊCH BẢN CHI TIẾT (Script Mode)

**Nhận biết**: Đầu vào chứa danh sách TC_01, TC_02... với từng bước hành động cụ thể.

**QUY TẮC BẮT BUỘC — TUÂN THỦ TUYỆT ĐỐI**:

1. **DỊCH NGUYÊN VẸN 1:1**: Chuyển từng TC sang hàng trong bảng. Mỗi bước trong kịch bản = một dòng trong cột `Test Steps`. Không thêm, không bỏ, không đổi thứ tự.
2. **CHÍNH XÁC SỐ LƯỢNG**: Kịch bản có N test cases → bảng có đúng N hàng. **TUYỆT ĐỐI KHÔNG tự thêm** TC mới (dù nghĩ rằng nên test thêm). **TUYỆT ĐỐI KHÔNG bỏ bớt** TC nào.
3. **GIỮ NGUYÊN DỮ LIỆU TEST**: URL, username, password, tên trường, giá trị nhập — sao chép y hệt từ kịch bản vào cột `Test Data`. Không dùng placeholder như `[giá trị hợp lệ]`.
4. **GIỮ NGUYÊN EXPECTED RESULT**: Nếu kịch bản ghi "Kiểm tra: Thông báo có chữ 'Thành công'", cột `Expected Result` PHẢI ghi chính xác: `Xuất hiện thông báo chứa chữ "Thành công"`. Không được suy diễn thêm.
5. **URL**: Nếu kịch bản ghi rõ URL thì ghi y hệt vào `Preconditions` và `Test Steps`. Tuyệt đối không tự thay thế hay rút gọn URL.

### 🟡 CHẾ ĐỘ 2: NGƯỜI DÙNG CHỈ MÔ TẢ YÊU CẦU CHUNG (Auto Mode)

**Nhận biết**: Đầu vào là mô tả tính năng, user story, hoặc requirement mà không có từng bước cụ thể.

**QUY TẮC**: Áp dụng đầy đủ quy trình 6 bước bên dưới, bao gồm Happy Path, Negative, Boundary, Validation, Security, Session cases.

---

## Quy trình xử lý (Auto Mode)

### Bước 1: Phân tích đầu vào
- Xác định Actor, Module, URL/màn hình liên quan.
- Xác định Preconditions (hệ thống/dữ liệu cần có sẵn).
- Xác định Business Rules cốt lõi.
- Đánh dấu điểm mơ hồ: `[Assumption]` / `[Need Clarification]` / `[Not defined in requirement]`.

### Bước 2: Ánh xạ kỹ thuật thiết kế test

| Kỹ thuật | Áp dụng khi |
|---|---|
| Equivalence Partitioning | Ô nhập có nhiều nhóm giá trị hợp lệ / không hợp lệ |
| Boundary Value Analysis | Trường có giới hạn độ dài, số lượng, tuổi, ngày tháng |
| Decision Table | Logic phụ thuộc vào nhiều điều kiện kết hợp |
| State Transition | Luồng có trạng thái (Chờ → Đang xử lý → Hoàn thành) |
| Error Guessing | Các lỗi phổ biến dựa trên kinh nghiệm thực tế |

### Bước 3: Xây dựng danh sách test cases

Bao phủ tối thiểu các loại sau:

- ✅ **Happy Path**: Luồng thành công chuẩn với dữ liệu hợp lệ.
- ❌ **Negative**: Dữ liệu sai định dạng, sai giá trị, sai quy trình.
- 📐 **Boundary**: Giá trị biên dưới/trên, rỗng/tối đa.
- 🔒 **Validation**: Trường bắt buộc, regex, định dạng.
- 👤 **Permission**: Phân quyền vai trò (nếu có nhiều role).
- ⏱ **Session**: Hết hạn phiên, đăng xuất, đa tab/thiết bị.
- 🛡 **Security**: SQL Injection, XSS cơ bản, brute force.
- 🔄 **Regression**: Tác động đến tính năng liên quan.

### Bước 4: Gán thuộc tính

- **Priority**: `Critical` | `High` | `Medium` | `Low`
- **Test Type**: `Smoke` | `Functional` | `Regression` | `Negative` | `Boundary` | `Security` | `Session`
- **Automation Suitability**: `Yes` | `No` | `Partial` (kèm lý do nếu No/Partial)

---

## Quy tắc bắt buộc (ÁP DỤNG CHO CẢ 2 CHẾ ĐỘ)

### R01 — TUYỆT ĐỐI KHÔNG sinh mã nguồn
Không viết bất kỳ đoạn code Playwright / JavaScript / TypeScript nào.

### R02 — Expected Result PHẢI cụ thể và đo lường được

| ❌ CẤM viết | ✅ BẮT BUỘC viết |
|---|---|
| "Hệ thống hoạt động bình thường" | "Trang chuyển hướng đến `/dashboard`, URL không còn chứa `/dang-nhap`" |
| "Hiển thị thông báo lỗi" | "Xuất hiện thông báo: \"Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động.\"" |
| "Trang load đúng" | "Form Thêm mới hiển thị, có các ô: Tên tổ chức, Tên quốc tế, Tên viết tắt, Dropdown Loại hình" |
| "Không đăng nhập được" | "Trang giữ nguyên URL `/dang-nhap`, hiển thị thông báo lỗi tương ứng" |

### R03 — Test Data PHẢI dùng dữ liệu thực từ kịch bản

- Nếu kịch bản ghi `username: 'test'`, `password: 'Abc@12345'` → phải ghi đúng trong Test Data.
- Không dùng placeholder chung chung: `[valid_user]`, `[correct_password]`.
- Nếu kịch bản bỏ trống một ô → ghi rõ: `Để trống`.

### R04 — URL phải ghi rõ ràng trong Preconditions và Test Steps

- Nếu kịch bản có URL → ghi y hệt URL đó.
- Ví dụ: `Truy cập https://hcm.mobifone.vn/qly-dttg/dang-nhap`.
- Không được rút gọn thành `/dang-nhap` hay `[Login URL]`.

### R05 — Tiêu chí Preconditions cho test case SAU đăng nhập

- Mọi test case yêu cầu đăng nhập (Thêm tổ chức, Sửa danh mục, Phân quyền...) → cột `Preconditions` PHẢI ghi: `Đã đăng nhập thành công vào hệ thống với tài khoản [username]`.
- Không được để trống Preconditions nếu test case cần auth.

### R06 — Test Steps phải đánh số thứ tự, đủ hành động

Format chuẩn:
```
1. Truy cập URL: https://...
2. Nhập [giá trị] vào ô [Tên ô]
3. Click nút [Tên nút]
4. Kiểm tra [điều kiện kết quả]
```

Mỗi bước là một hành động/kiểm tra đơn lẻ. Không gộp nhiều hành động vào một bước.

### R07 — Tên Test Case phải tường minh

Format: `TC_[MODULE]_[STT] - [Hành động + Điều kiện + Kết quả mong đợi]`

- ❌ Sai: `TC_01 - Đăng nhập`
- ✅ Đúng: `TC_LOGIN_01 - Đăng nhập thành công với tài khoản test/Abc@12345, URL chuyển khỏi /dang-nhap`

### R08 — Với kịch bản Script Mode: KHÔNG tự sáng tạo thêm

Ví dụ: Người dùng chỉ cung cấp TC_01 (Thêm tổ chức thành công) → Planner KHÔNG được tự thêm TC_02 (Thêm tổ chức thiếu tên), TC_03 (Tổ chức đã tồn tại)... vì đó là sáng tạo ngoài phạm vi kịch bản.

### R09 — Ghi chú Dropdown / Icon / UI đặc biệt

Khi kịch bản đề cập tới:
- **Dropdown tùy chỉnh** (chọn từ danh sách xổ xuống): Ghi rõ trong Test Steps: `Click ô dropdown "[Tên dropdown]" → Chọn giá trị "[Tên giá trị]"`.
- **Icon không có chữ** (icon con mắt, icon sửa, icon xóa): Ghi rõ trong Test Steps: `Click icon [loại icon] ở [vị trí cụ thể]`.
- **Nút có biểu tượng** (`+ Thêm`, `✏ Sửa`): Ghi rõ tên nút đầy đủ trong Test Steps.

### R10 — Assertion rõ ràng cho từng loại phần tử

| Loại kiểm tra | Expected Result chuẩn |
|---|---|
| URL sau hành động | `URL chuyển sang [URL mới]` hoặc `URL không còn chứa '[slug]'` |
| Thông báo popup/toast | `Xuất hiện thông báo: "[Nội dung thông báo chính xác]"` |
| Giá trị ô input | `Ô [Tên ô] hiển thị giá trị: "[giá trị]"` |
| Type của ô mật khẩu | `Ô mật khẩu chuyển sang type="text" (hiển thị rõ ký tự)` |
| Dữ liệu trong bảng | `Bảng xuất hiện dòng mới với [Tên cột]: "[Giá trị]"` |
| Form validation | `Ô [Tên ô] hiển thị thông báo lỗi: "[Nội dung lỗi]"` |

---

## Định dạng đầu ra

Đầu ra bắt buộc có đúng 2 phần theo thứ tự sau:

### Phần 1: Bảng danh sách Test Case

```markdown
| ID | Module | Test Case Name | Objective | Preconditions | Test Steps | Test Data | Expected Result | Priority | Test Type | Automation Suitability | Notes |
|----|--------|---------------|-----------|---------------|------------|-----------|-----------------|----------|-----------|----------------------|-------|
```

**Quy tắc điền bảng**:
- Cột `Test Steps`: Dùng `<br>` để xuống dòng giữa các bước trong ô bảng.
- Cột `Test Data`: Liệt kê theo format `[Tên trường]: [giá trị]`, phân cách bằng `<br>`. Dùng `(để trống)` nếu bỏ trống.
- Cột `Expected Result`: Phải cụ thể, đo lường được (xem R02).
- Cột `Notes`: Ghi nhãn Happy path / Negative / Boundary / `[Assumption]` nếu có.

### Phần 2: Tổng kết

- **Coverage Summary**: Bao phủ những loại kịch bản nào (Happy, Negative, Boundary...).
- **Out-of-scope**: Các phần không nằm trong phạm vi lần này.
- **Risks**: Rủi ro kỹ thuật hoặc dữ liệu.
- **Missing Requirements / Clarifications**: Điểm mơ hồ cần PO/BA xác nhận (nếu có).
- **Recommended Smoke Suite**: Liệt kê các TC ID tối thiểu cần chạy để xác nhận hệ thống sẵn sàng.
- **Recommended Regression Suite**: Liệt kê các TC ID cần chạy mỗi khi có thay đổi.

---

## Tiêu chí chất lượng đầu ra

| Tiêu chí | Mức yêu cầu |
|---|---|
| Số TC bám sát kịch bản (Script Mode) | 100% — không thêm, không bớt |
| Expected Result cụ thể | 100% — không có câu mơ hồ |
| Test Data đầy đủ | Mọi ô nhập đều có dữ liệu rõ ràng |
| Tên TC tường minh | Đọc tên là hiểu ngay kịch bản |
| Preconditions đủ | Đặc biệt với test case cần auth |
| Không có mã nguồn | Tuyệt đối |

---

## Ví dụ định dạng chuẩn (CHỈ THAM KHẢO CẤU TRÚC — KHÔNG COPY DỮ LIỆU)

> ⚠️ Ví dụ dưới đây chỉ minh họa **cấu trúc và định dạng**. Khi sinh test case thực tế, PHẢI dùng URL, tên trường, và dữ liệu từ kịch bản của người dùng. KHÔNG được sao chép giá trị ví dụ.

| ID | Module | Test Case Name | Objective | Preconditions | Test Steps | Test Data | Expected Result | Priority | Test Type | Automation Suitability | Notes |
|----|--------|---------------|-----------|---------------|------------|-----------|-----------------|----------|-----------|----------------------|-------|
| TC_LOGIN_01 | Đăng nhập | Đăng nhập thành công với tài khoản hợp lệ, URL chuyển khỏi /dang-nhap | Xác nhận hệ thống cho phép đăng nhập với thông tin hợp lệ | Trình duyệt đã mở, có kết nối mạng | 1. Truy cập https://[domain]/dang-nhap<br>2. Nhập [username] vào ô "Nhập tên đăng nhập"<br>3. Nhập [password] vào ô "Nhập mật khẩu"<br>4. Click nút "Đăng nhập"<br>5. Kiểm tra URL | Username: `[user]`<br>Password: `[pass]` | URL chuyển sang trang chính, URL không còn chứa `/dang-nhap` | Critical | Smoke / Functional | Yes | Happy path |
| TC_LOGIN_02 | Đăng nhập | Đăng nhập thất bại khi nhập sai mật khẩu — hiển thị thông báo lỗi chính xác | Xác nhận hệ thống từ chối đăng nhập với mật khẩu sai | Trình duyệt đã mở | 1. Truy cập https://[domain]/dang-nhap<br>2. Nhập [username] vào ô "Nhập tên đăng nhập"<br>3. Nhập [wrong_pass] vào ô "Nhập mật khẩu"<br>4. Click nút "Đăng nhập"<br>5. Kiểm tra thông báo lỗi | Username: `[user]`<br>Password: `[sai_pass]` | Trang giữ nguyên URL `/dang-nhap`. Xuất hiện thông báo: "[Nội dung thông báo lỗi từ kịch bản]" | High | Negative | Yes | Negative path |


---
⚠️ LƯU Ý QUAN TRỌNG: Phần "Ví dụ" ở trên chỉ là THAM KHẢO ĐỊNH DẠNG. 
TUYỆT ĐỐI KHÔNG dùng URL, dữ liệu, hay tên trang web trong ví dụ đó.
Bạn PHẢI sử dụng ĐÚNG thông tin thực tế từ mục [THÔNG TIN THỰC TẾ CỦA NGƯỜI DÙNG] bên dưới.
---

[THÔNG TIN THỰC TẾ CỦA NGƯỜI DÙNG - ĐÂY LÀ MỤC TIÊU THẬT SỰ]
URL / Tính năng cần kiểm thử: [CHẾ ĐỘ KỊCH BẢN CHI TIẾT - SCRIPT MODE]
QUAN TRỌNG: Người dùng đã viết kịch bản test CHI TIẾT TỪNG BƯỚC. 
AI PHẢI chuyển đổi CHÍNH XÁC 1:1 từng bước sang code Playwright.
TUYỆT ĐỐI KHÔNG được tự thêm, bớt hoặc thay đổi bất kỳ bước nào.
Khi gặp mô tả mơ hồ (VD: "icon con mắt", "nút ẩn/hiện"), tra cứu dữ liệu DOM bên dưới để tìm selector chính xác.
Nếu không tìm thấy trong DOM, dùng selector tổng quát nhất có thể (VD: button gần ô input password).

Quy tắc chuyển đổi:
- "Mở URL" hoặc "Mở trang ..." → await page.goto(URL)
- "Nhập 'X' vào ô 'Y'" → await page.getByPlaceholder('Y').fill('X')
- "Nhập 'X' vào label 'Y'" → await page.getByLabel('Y').fill('X')
- "Bỏ trống ô 'Y'" → không gọi fill() cho ô đó
- "Bấm nút 'Z'" → await page.getByRole('button', { name: 'Z' }).or(page.getByText('Z')).first().click()
- "Click vào 'Z'" → await page.getByText('Z').first().click()
- "Bấm vào icon ..." → tra cứu DOM để tìm button/svg gần nhất, dùng locator('.class-name').first().click()
- "Kiểm tra: hiển thị text 'W'" hoặc "Kiểm tra: Có thông báo 'W'" → await expect(page.getByText('W')).toBeVisible()
- "Kiểm tra: Có cả 2 thông báo 'A' và 'B'" → 2 dòng expect riêng biệt
- "Kiểm tra: URL không còn chứa 'X'" → await expect(page).not.toHaveURL(/.*X.*/i)
- "Kiểm tra: URL chứa 'X'" → await expect(page).toHaveURL(/.*X.*/i)
- "Kiểm tra: Mật khẩu dạng ẩn" → await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'password')
- "Kiểm tra: Mật khẩu dạng văn bản" → await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'text')
- "Chờ trang load xong" → await page.waitForLoadState('networkidle')

=== KỊCH BẢN TEST CỦA NGƯỜI DÙNG ===
URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap
TC_01: Đăng nhập thành công
-	Mở URL 
-	Nhập 'admin' vào ô 'Nhập tên đăng nhập'                    
-	Nhập '123123' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: URL không còn chứa 'dang-nhap'

TC_02: Đăng nhập thất bại vì sai mật khẩu
-	Mở URL 
-	Nhập 'admin' vào ô 'Nhập tên đăng nhập'                    
-	Nhập '1231234' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."

TC_03: Đăng nhập thất bại vì sai username
-	Mở URL 
-	Nhập 'admin'1 vào ô 'Nhập tên đăng nhập'                    
-	Nhập '123123' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."

TC_04: Đăng nhập thất bại vì bỏ trống mật khẩu
-	Mở URL 
-	Nhập 'admin' vào ô 'Nhập tên đăng nhập'                    
-	Bỏ trống ô 'Nhập mật khẩu'
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có xuất hiện: "Vui lòng nhập mật khẩu"

TC_05: Đăng nhập thất bại vì bỏ trống username
-	Mở URL 
-	Bỏ trống ô 'Nhập tên đăng nhập'                    
-	Nhập '123123' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có thông báo: "Vui lòng nhập tên đăng nhập"

TC_06: Đăng nhập thất bại vì sai username (Test chữ hoa)
-	Mở URL 
-	Nhập 'Admin' vào ô 'Nhập tên đăng nhập'                    
-	Nhập '123123' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."


TC_07: Đăng nhập thất bại vì bỏ trống cả 2 trường
-	Mở URL 
-	Bỏ trống ô 'Nhập tên đăng nhập'                    
-	Bỏ trống ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có cả 2 thông báo: " Vui lòng nhập tên đăng nhập" và " Vui lòng nhập mật khẩu" cùng lúc
TC_08: Kiểm tra tính năng ẩn/hiện mật khẩu (Icon con mắt)
-	Mở URL
-	Nhập '123123' vào ô 'Nhập mật khẩu' (mặc định hiển thị dạng chấm tròn ••••••)
-	Bấm vào icon Con mắt ở góc phải ô Mật khẩu
-	Kiểm tra: Mật khẩu chuyển sang dạng văn bản đọc được ('123123')
-	Bấm icon Con mắt thêm một lần nữa
-	Kiểm tra: Mật khẩu quay lại dạng ẩn (••••••)
TC_09: Xử lý khoảng trắng thừa ở Username (Trim space)
-	Mở URL
-	Nhập ' admin ' (có khoảng trắng ở đầu và cuối) vào ô 'Nhập tên đăng nhập'
-	Nhập '123123' vào ô 'Nhập mật khẩu'
-	Bấm nút 'Đăng nhập'
-	Kiểm tra: URL không còn chứa 'dang-nhap'

TC_10: Kiểm tra chống tấn công SQL Injection
•	Mở URL
•	Nhập ' OR '1'='1 vào ô 'Nhập tên đăng nhập'
•	Nhập ' OR '1'='1 vào ô 'Nhập mật khẩu'
•	Bấm nút 'Đăng nhập'
•	Kiểm tra: Có thông báo "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."







=== HẾT KỊCH BẢN ===

[DU LIEU DOM THUC TE DA CRAWL THEO TUNG TRANG THAI NGHIEP VU]
Khi buoc test mo ta phan tu, hay TRA CUU DOM ben duoi de tim selector va role chinh xac.
# Multi-State Crawled DOM Data

## TC_01 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_02 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_03 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_04 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_05 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_06 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_07 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_08 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_09 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_10 DOM Snapshots



[YÊU CẦU ĐẦU RA]
- Sinh test case dựa 100% trên URL/tính năng "[CHẾ ĐỘ KỊCH BẢN CHI TIẾT - SCRIPT MODE]
QUAN TRỌNG: Người dùng đã viết kịch bản test CHI TIẾT TỪNG BƯỚC. 
AI PHẢI chuyển đổi CHÍNH XÁC 1:1 từng bước sang code Playwright.
TUYỆT ĐỐI KHÔNG được tự thêm, bớt hoặc thay đổi bất kỳ bước nào.
Khi gặp mô tả mơ hồ (VD: "icon con mắt", "nút ẩn/hiện"), tra cứu dữ liệu DOM bên dưới để tìm selector chính xác.
Nếu không tìm thấy trong DOM, dùng selector tổng quát nhất có thể (VD: button gần ô input password).

Quy tắc chuyển đổi:
- "Mở URL" hoặc "Mở trang ..." → await page.goto(URL)
- "Nhập 'X' vào ô 'Y'" → await page.getByPlaceholder('Y').fill('X')
- "Nhập 'X' vào label 'Y'" → await page.getByLabel('Y').fill('X')
- "Bỏ trống ô 'Y'" → không gọi fill() cho ô đó
- "Bấm nút 'Z'" → await page.getByRole('button', { name: 'Z' }).or(page.getByText('Z')).first().click()
- "Click vào 'Z'" → await page.getByText('Z').first().click()
- "Bấm vào icon ..." → tra cứu DOM để tìm button/svg gần nhất, dùng locator('.class-name').first().click()
- "Kiểm tra: hiển thị text 'W'" hoặc "Kiểm tra: Có thông báo 'W'" → await expect(page.getByText('W')).toBeVisible()
- "Kiểm tra: Có cả 2 thông báo 'A' và 'B'" → 2 dòng expect riêng biệt
- "Kiểm tra: URL không còn chứa 'X'" → await expect(page).not.toHaveURL(/.*X.*/i)
- "Kiểm tra: URL chứa 'X'" → await expect(page).toHaveURL(/.*X.*/i)
- "Kiểm tra: Mật khẩu dạng ẩn" → await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'password')
- "Kiểm tra: Mật khẩu dạng văn bản" → await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'text')
- "Chờ trang load xong" → await page.waitForLoadState('networkidle')

=== KỊCH BẢN TEST CỦA NGƯỜI DÙNG ===
URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap
TC_01: Đăng nhập thành công
-	Mở URL 
-	Nhập 'admin' vào ô 'Nhập tên đăng nhập'                    
-	Nhập '123123' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: URL không còn chứa 'dang-nhap'

TC_02: Đăng nhập thất bại vì sai mật khẩu
-	Mở URL 
-	Nhập 'admin' vào ô 'Nhập tên đăng nhập'                    
-	Nhập '1231234' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."

TC_03: Đăng nhập thất bại vì sai username
-	Mở URL 
-	Nhập 'admin'1 vào ô 'Nhập tên đăng nhập'                    
-	Nhập '123123' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."

TC_04: Đăng nhập thất bại vì bỏ trống mật khẩu
-	Mở URL 
-	Nhập 'admin' vào ô 'Nhập tên đăng nhập'                    
-	Bỏ trống ô 'Nhập mật khẩu'
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có xuất hiện: "Vui lòng nhập mật khẩu"

TC_05: Đăng nhập thất bại vì bỏ trống username
-	Mở URL 
-	Bỏ trống ô 'Nhập tên đăng nhập'                    
-	Nhập '123123' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có thông báo: "Vui lòng nhập tên đăng nhập"

TC_06: Đăng nhập thất bại vì sai username (Test chữ hoa)
-	Mở URL 
-	Nhập 'Admin' vào ô 'Nhập tên đăng nhập'                    
-	Nhập '123123' vào ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."


TC_07: Đăng nhập thất bại vì bỏ trống cả 2 trường
-	Mở URL 
-	Bỏ trống ô 'Nhập tên đăng nhập'                    
-	Bỏ trống ô 'Nhập mật khẩu'                          
-	Bấm nút 'Đăng nhập'                                          
-	Kiểm tra: Có cả 2 thông báo: " Vui lòng nhập tên đăng nhập" và " Vui lòng nhập mật khẩu" cùng lúc
TC_08: Kiểm tra tính năng ẩn/hiện mật khẩu (Icon con mắt)
-	Mở URL
-	Nhập '123123' vào ô 'Nhập mật khẩu' (mặc định hiển thị dạng chấm tròn ••••••)
-	Bấm vào icon Con mắt ở góc phải ô Mật khẩu
-	Kiểm tra: Mật khẩu chuyển sang dạng văn bản đọc được ('123123')
-	Bấm icon Con mắt thêm một lần nữa
-	Kiểm tra: Mật khẩu quay lại dạng ẩn (••••••)
TC_09: Xử lý khoảng trắng thừa ở Username (Trim space)
-	Mở URL
-	Nhập ' admin ' (có khoảng trắng ở đầu và cuối) vào ô 'Nhập tên đăng nhập'
-	Nhập '123123' vào ô 'Nhập mật khẩu'
-	Bấm nút 'Đăng nhập'
-	Kiểm tra: URL không còn chứa 'dang-nhap'

TC_10: Kiểm tra chống tấn công SQL Injection
•	Mở URL
•	Nhập ' OR '1'='1 vào ô 'Nhập tên đăng nhập'
•	Nhập ' OR '1'='1 vào ô 'Nhập mật khẩu'
•	Bấm nút 'Đăng nhập'
•	Kiểm tra: Có thông báo "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."







=== HẾT KỊCH BẢN ===

[DU LIEU DOM THUC TE DA CRAWL THEO TUNG TRANG THAI NGHIEP VU]
Khi buoc test mo ta phan tu, hay TRA CUU DOM ben duoi de tim selector va role chinh xac.
# Multi-State Crawled DOM Data

## TC_01 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_02 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_03 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_04 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_05 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_06 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_07 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_08 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_09 DOM Snapshots

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

### State: undefined (URL: https://hcm.mobifone.vn/qly-dttg/dang-nhap)
| Tag | Type | Role | Name | Placeholder | Label | Text |
| --- | ---- | ---- | ---- | ----------- | ----- | ---- |
| input | text |  | username | Nhập tên đăng nhập |  |  |
| input | password |  | password | Nhập mật khẩu |  |  |
| button | submit |  |  |  |  | Đăng nhập |

## TC_10 DOM Snapshots

" ở trên.
- KHÔNG sử dụng bất kỳ thông tin nào từ ví dụ minh họa (saucedemo, standard_user, secret_sauce, v.v.).
- Chỉ xuất ra mảng JSON hợp lệ chứa các test case. KHÔNG GIẢI THÍCH GÌ THÊM.