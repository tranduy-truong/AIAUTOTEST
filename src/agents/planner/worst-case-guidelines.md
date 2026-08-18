# HƯỚNG DẪN THIẾT KẾ KỊCH BẢN KIỂM THỬ WORST-CASE & LỖI NGHIÊM TRỌNG TRẢI NGHIỆM NGƯỜI DÙNG (UX)
> **Dành cho AI Planner Agent** trong việc tự động phân tích DOM và sinh kịch bản kiểm thử chống phá (Adversarial, Boundary & UX Resilience Testing).

---

## 🧭 I. TƯ DUY KIỂM THỬ WORST-CASE (ADVERSARIAL MINDSET)

AI Planner **không chỉ kiểm thử đường dẫn thuận (Happy Path)** mà phải đóng vai trò là một **Tester kiểm thử thâm nhập & chuyên gia trải nghiệm người dùng (UX Auditor)**:
1. **Tìm kiếm điểm dễ vỡ nhất của hệ thống**: Các ô nhập liệu không validate, các nút bấm không chặn double-click, các URL nội bộ không chặn truy cập trái phép.
2. **Đánh giá mức độ nghiêm trọng (Severity)**:
   - 🔴 **CRITICAL (Khẩn cấp)**: Lỗ hổng bảo mật (SQLi, Bypass Auth, lộ mật khẩu/dữ liệu nhạy cảm), sập hệ thống (Crash/500).
   - 🟠 **HIGH (Cao)**: Mất dữ liệu, tạo bản ghi trùng lặp do double submission, XSS không được escape, form không thể submit dù nhập đúng.
   - 🟡 **MEDIUM (Trung bình)**: Vỡ layout giao diện (CSS overflow), tìm kiếm không có dữ liệu bị treo (No Empty State), modal không reset dữ liệu cũ khi mở lại.
   - 🟢 **LOW (Thấp)**: Lỗi chính tả, màu sắc thông báo chưa chuẩn, thiếu placeholder.

---

## 📚 II. DANH MỤC 8 NHÓM KỊCH BẢN WORST-CASE CHI TIẾT

---

### 🚨 NHÓM 1: XÁC THỰC, PHÂN QUYỀN & QUẢN LÝ PHIÊN (AUTH & SESSION - CRITICAL)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_AUTH_01** | Truy cập trái phép Deep Link khi chưa đăng nhập | 1. Mở thẳng URL nội bộ (ví dụ: `/inventory.html`, `/dashboard`, `/admin`) trong tab ẩn danh sạch (chưa login). | Hệ thống **lập tức chuyển hướng (redirect) về trang đăng nhập (`/login` hoặc `/`)**, tuyệt đối không để lộ dữ liệu hay layout quản trị. |
| **WC_AUTH_02** | Thử nghiệm SQL Injection trên Form Đăng nhập | 1. `fill` ô Username / Tên đăng nhập: `' OR '1'='1`<br>2. `fill` ô Password / Mật khẩu: `' OR '1'='1`<br>3. `click` Login / Đăng nhập. | Hệ thống **không bị lỗi 500 / Crash**, hiển thị thông báo lỗi thân thiện: `"Username and password do not match"` hoặc `"Tên đăng nhập/mật khẩu không đúng"`. |
| **WC_AUTH_03** | Thử nghiệm XSS Payload trên ô Username | 1. `fill` ô Username: `<script>alert('XSS')</script>`<br>2. `fill` ô Password: `secret_sauce`<br>3. `click` Login. | Chuỗi script được escape an toàn, không thực thi mã độc, báo lỗi đăng nhập thất bại. |
| **WC_AUTH_04** | Đăng nhập với các trường rỗng hoặc chỉ toàn khoảng trắng | 1. `fill` ô Username: `   ` (khoảng trắng)<br>2. `fill` ô Password: `   `<br>3. `click` Login. | Giao diện hiển thị cảnh báo yêu cầu nhập (ví dụ: `"Username is required"` hoặc viền đỏ), không gửi request rác lên server. |
| **WC_AUTH_05** | Đăng nhập sai mật khẩu (Invalid Credentials UX) | 1. `fill` đúng username: `standard_user` (hoặc `admin`)<br>2. `fill` sai password: `wrong_password_123`<br>3. `click` Login. | Hệ thống hiển thị thông báo lỗi rõ ràng, không treo trình duyệt. |
| **WC_AUTH_06** | Đăng xuất an toàn & Ngăn Back Browser (Logout & History Invalidation) | 1. Đăng nhập thành công<br>2. `click` menu Đăng xuất (Logout)<br>3. Bấm nút Back trên trình duyệt. | Người dùng không thể quay lại trang nội bộ mà bị giữ ở trang Login. |

---

### ⚡ NHÓM 2: DỮ LIỆU CỰC HẠN, BIÊN GIỚI & KÝ TỰ ĐẶC BIỆT (DATA BOUNDARY - HIGH)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_DATA_01** | Chuỗi siêu dài (Extreme Length / Buffer Test) vào ô Tìm kiếm / Nhập liệu | 1. `fill` vào ô Tìm kiếm / Textbox chuỗi 500+ ký tự: `TEST_STRING_LONG_...` (lặp lại 50 lần).<br>2. `press` Enter hoặc bấm Tìm kiếm / Submit. | Giao diện **không bị vỡ bố cục ngang (No horizontal scroll overflow)**, bảng hiển thị thông báo không tìm thấy kết quả hoặc cắt gọn an toàn. |
| **WC_DATA_02** | Ký tự đặc biệt Regex & Meta-characters | 1. `fill` vào ô Tìm kiếm: `.*+?^${}()\|[]\\` và `!@#$%^&*~`. | Hệ thống không ném lỗi cú pháp Regex (Unhandled Regex Error), xử lý chuỗi như text thuần. |
| **WC_DATA_03** | Ký tự Unicode, Emojis & Đa ngôn ngữ | 1. `fill` vào trường dữ liệu: `🚀 E-commerce Test 🇻🇳 🕌 ⛪ 100% Valid`. | Dữ liệu hiển thị đúng chuẩn Unicode, không bị biến thành dấu hỏi `???` hoặc ký tự rác. |
| **WC_DATA_04** | Khoảng trắng ở đầu và cuối chuỗi (Whitespace Trimming) | 1. `fill` vào ô tìm kiếm: `"   Sauce Labs Backpack   "` (có khoảng trắng thừa ở 2 đầu). | Hệ thống tự động trim khoảng trắng và vẫn tìm thấy đúng bản ghi sản phẩm/dữ liệu. |
| **WC_DATA_05** | Giá trị số âm, số 0, số thập phân cho trường Số lượng / Giá | 1. `fill` các trường số lượng/giá: `-10`, `0`, `99999999999`. | Hệ thống hiển thị lỗi validation: `"Invalid quantity"` / `"Giá trị không hợp lệ"` hoặc chặn nhập số âm. |

---

### 📝 NHÓM 3: VALIDATION FORM, RACE CONDITION & UX STATE (FORM UX - HIGH)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_FORM_01** | Gửi Form hoàn toàn rỗng (Blank Form Submission) | 1. Mở form Thêm mới / Checkout / Cập nhật.<br>2. Không điền bất kỳ trường nào.<br>3. `click` nút Submit / Tiếp tục / Lưu. | **Tất cả các trường bắt buộc** đồng loạt viền đỏ và hiển thị dòng chữ lỗi cụ thể (ví dụ: `"First Name is required"`, `"Vui lòng nhập..."`), form không bị gửi đi. |
| **WC_FORM_02** | Chống bấm nút liên tục (Double Submission / Spam Click) | 1. Điền thông tin hợp lệ vào form.<br>2. `click` liên tiếp 3 lần cực nhanh vào nút Submit (Spam click). | Nút bấm tự động chuyển sang trạng thái **Disabled / Loading Spinner** sau cú click đầu tiên, ngăn chặn việc tạo 2 bản ghi/đơn hàng trùng lặp trong Database. |
| **WC_FORM_03** | Hủy form giữa chừng & Reset trạng thái (Form Abandonment) | 1. Mở modal Thêm mới / Form nhập.<br>2. Nhập một nửa thông tin dở dang.<br>3. `click` nút "Hủy" hoặc "Cancel" (hoặc phím Escape).<br>4. Mở lại modal. | Modal mở lại với **trạng thái hoàn toàn sạch (Clean Form)**, không còn lưu các dữ liệu rác đã nhập trước đó. |
| **WC_FORM_04** | Nhập dữ liệu trùng lặp trường định danh duy nhất (Duplicate Key) | 1. Mở form tạo mới.<br>2. Nhập Mã / SKU / Username đã tồn tại trong hệ thống.<br>3. `click` Lưu / Submit. | Hệ thống thông báo rõ ràng: `"Already exists in system"`, trỏ đúng vào ô bị trùng. |

---

### 📊 NHÓM 4: BẢNG DỮ LIỆU, TÌM KIẾM, LỌC, PHÂN TRANG & SỐ DÒNG/TRANG (GRID, PAGINATION & PAGE SIZE UX - HIGH)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_GRID_01** | Tìm kiếm không có kết quả (Empty State UX) | 1. `fill` từ khóa vô nghĩa: `__KHONG_THE_TIM_THAY_DU_LIEU_99999__`.<br>2. `click` Tìm kiếm. | Bảng hiển thị **thông báo / hình ảnh Empty State thân thiện** (`"Không tìm thấy dữ liệu phù hợp"`), không để bảng trống trơn hay bị sập layout. |
| **WC_GRID_02** | Xóa bộ lọc tìm kiếm & Khôi phục danh sách đầy đủ | 1. Nhập từ khóa tìm kiếm (ví dụ: `CSTG008`) $\rightarrow$ Bấm Tìm kiếm.<br>2. Xóa ô tìm kiếm về rỗng $\rightarrow$ Bấm Tìm kiếm. | Bảng dữ liệu lập tức khôi phục về danh sách đầy đủ ban đầu (ví dụ: đủ 11 dòng). |
| **WC_GRID_03** | Chuyển đổi Tab phân loại liên tục (Rapid Tab Switching Race Condition) | 1. `click` Tab 1 (Chức sắc) $\rightarrow$ Ngay lập tức `click` Tab 2 (Chức việc) $\rightarrow$ `click` Tab 3 (Nhà tu hành) trong 1 giây. | Dữ liệu hiển thị cuối cùng phải khớp 100% với Tab đang active, không bị hiển thị chồng chéo dữ liệu cũ do bất đồng bộ (Async race condition). |
| **WC_PAGE_01** | Chuyển trang qua lại trên Bảng dữ liệu (Pagination Navigation) | 1. Đang ở Trang 1/2: `click` nút chuyển trang sau (`>`).<br>2. Kiểm tra bảng tải dữ liệu của Trang 2 (ví dụ: các mã `CSTG027`...) và hiển thị `Trang 2 / 2`.<br>3. `click` nút chuyển trang trước (`<`) để quay lại Trang 1. | Dữ liệu chuyển đổi mượt mà, hiển thị đúng bản ghi trang tương ứng và số trang cập nhật chính xác. |
| **WC_PAGE_02** | Phân trang ở các vị trí biên (Pagination Boundary & Debounce) | 1. Ở trang 1: Kiểm tra nút "Trang trước" (`<`) ở trạng thái **Disabled** (hoặc không kích hoạt reload lỗi).<br>2. Chuyển đến trang cuối (Trang 2): Kiểm tra nút "Trang sau" (`>`) ở trạng thái **Disabled**. | Người dùng không thể bấm vượt quá số trang hiện có. |
| **WC_PAGE_03** | Thay đổi Số dòng/trang (Page Size Selection - 10 lên 20 dòng) | 1. Đang ở chế độ hiển thị 10 dòng/trang (Trang 1/2).<br>2. `click` dropdown **Số dòng/trang** $\rightarrow$ chọn `20` (hoặc `50`). | Bảng gom toàn bộ dữ liệu (tất cả 11 dòng) vào 1 trang duy nhất, tổng số trang đổi thành `1 / 1`, các nút chuyển trang `<` và `>` đều bị disabled. |
| **WC_PAGE_04** | Đổi Số dòng/trang khi đang ở Trang sau (Page Reset Boundary) | 1. `click` chuyển sang Trang 2.<br>2. `click` đổi Số dòng/trang từ 10 lên 20. | Hệ thống tự động reset về `Trang 1 / 1` chứa đầy đủ dữ liệu, không bị kẹt ở trang rỗng. |
| **WC_VIEW_01** | Xem chi tiết bản ghi & Đóng Modal (Row Action View Details) | 1. `click` icon Mắt (👁️) / nút Xem chi tiết trên dòng dữ liệu cụ thể (ví dụ: `CSTG008`).<br>2. Kiểm tra Drawer / Modal mở ra hiển thị thông tin chi tiết của bản ghi.<br>3. `click` nút Đóng / icon X / phím Escape. | Modal đóng lại sạch sẽ, không che khuất màn hình và bảng dữ liệu vẫn giữ nguyên vẹn. |
| **WC_NAV_01** | Điều hướng qua lại giữa các menu phân hệ trên Sidebar | 1. `click` menu "Cơ sở" trên Sidebar $\rightarrow$ URL vào `/co-so`.<br>2. `click` menu "Tổ chức" trên Sidebar $\rightarrow$ URL vào `/to-chuc`. | Điều hướng ổn định, không bị xung đột routing SPA hay kẹt trạng thái filter cũ. |

---

### 🗑️ NHÓM 5: THAO TÁC XÓA & HÀNH ĐỘNG NGUY HIỂM (DESTRUCTIVE ACTIONS - HIGH)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_DEL_01** | Hủy thao tác Xóa (Cancel Delete Confirmation) | 1. `click` nút Xóa trên một dòng dữ liệu.<br>2. Khi Popup xác nhận hiện ra: `click` nút **"Hủy"** / **"Không"**. | Modal xác nhận đóng lại, **bản ghi vẫn còn nguyên vẹn trong bảng**, không bị xóa mất. |
| **WC_DEL_02** | Xác nhận Xóa an toàn (Confirm Delete Flow) | 1. `click` nút Xóa.<br>2. `click` nút **"Xác nhận"** / **"Đồng ý"**. | Dòng dữ liệu biến mất khỏi bảng, hiển thị Toast thông báo `"Xóa thành công"`. |

---

### 📁 NHÓM 6: TẢI TỆP TIN & ĐÍNH KÈM (FILE ATTACHMENT - HIGH)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_FILE_01** | Tải lên tệp sai định dạng (Invalid File Extension) | 1. Chọn file mã độc hoặc sai định dạng (`script.sh`, `app.exe`, `payload.php`) vào ô tải ảnh/tài liệu. | Hệ thống chặn ngay tại client và báo: `"Định dạng tệp không được hỗ trợ. Vui lòng chọn file .png, .jpg, .pdf"`. |
| **WC_FILE_02** | Tải lên tệp vượt quá dung lượng cho phép (File Size Limit) | 1. Chọn file có dung lượng > 20MB. | Hệ thống từ chối tải lên và hiển thị cảnh báo dung lượng vượt quá mức cho phép. |

---

### 💬 NHÓM 7: THÔNG BÁO LỖI & PHẢN HỒI NGƯỜI DÙNG (FEEDBACK UX - MEDIUM)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_UX_01** | Không hiển thị mã lỗi thô cho người dùng (No Raw Stacktrace) | 1. Gây ra bất kỳ lỗi validation hoặc thao tác sai. | Thông báo hiển thị bằng tiếng Việt tự nhiên, **tuyệt đối không hiển thị mã lỗi lập trình thô** như `500 Internal Server Error`, `TypeError: undefined`, `SQL syntax error`. |
| **WC_UX_02** | Toast thông báo tự biến mất hoặc có nút đóng | 1. Kích hoạt thông báo Toast thành công/thất bại. | Toast tự động biến mất sau 3-5 giây hoặc người dùng có thể bấm nút `X` để đóng, không che khuất các nút thao tác khác. |

---

## 🎯 III. QUY TẮC PHÂN BỔ TEST CASE BẮT BUỘC (1 HAPPY PATH + NHIỀU WORST-CASE)

Với mỗi trang web hoặc tính năng được phân tích, Planner **BẮT BUỘC** áp dụng công thức:
👉 **1 HAPPY PATH (Luồng nghiệp vụ chuẩn) + NHIỀU WORST-CASE (Tối thiểu 3 - 6 kịch bản Worst-Case & UX Failure)**:

1. **01 Test Case Happy Path (Chuẩn)**:
   - `TC_01_HAPPY_PATH`: Nhập dữ liệu hợp lệ, submit thành công, kiểm tra hiển thị đúng trên bảng/chi tiết.

2. **NHIỀU Test Cases Worst-Case & UX-Breaking (Bao phủ mọi rủi ro)**:
   - `TC_WC_AUTH_...`: Thử nghiệm bypass bảo mật, truy cập trái phép hoặc SQLi/XSS trên form đăng nhập/tìm kiếm.
   - `TC_WC_FORM_BLANK_...`: Gửi form hoàn toàn rỗng để kiểm tra đồng thời toàn bộ validation viền đỏ và thông báo lỗi.
   - `TC_WC_DATA_EXTREME_...`: Nhập chuỗi siêu dài (500+ ký tự) hoặc ký tự đặc biệt Regex (`.*`, `[`, `\`) để kiểm tra chống vỡ layout ngang (No CSS overflow).
   - `TC_WC_DATA_WHITESPACE_...`: Nhập khoảng trắng thừa ở 2 đầu chuỗi (`"   Text   "`) để kiểm tra auto-trimming.
   - `TC_WC_GRID_EMPTY_...`: Tìm kiếm từ khóa vô nghĩa để kiểm tra hiển thị Empty State ("Không tìm thấy dữ liệu").
   - `TC_WC_TAB_RACE_...`: Bấm chuyển đổi liên tục giữa các Tab phân loại để kiểm tra chống lỗi bất đồng bộ (Race condition).
   - `TC_WC_MODAL_CANCEL_...`: Nhập dữ liệu dở dang rồi Hủy/Đóng modal $\rightarrow$ Mở lại để kiểm tra form được reset sạch sẽ.
   - `TC_WC_DELETE_CANCEL_...`: Bấm Xóa $\rightarrow$ Hủy xác nhận để kiểm tra bản ghi vẫn còn nguyên vẹn.

3. **Quy ước đặt mã TestCaseId**:
   - `TC_01_<Tên Chức Năng>_Happy_Path`
   - `TC_WC_01_Bao_Mat_...`
   - `TC_WC_02_Form_Rong_...`
   - `TC_WC_03_Chuoi_Sieu_Dai_...`
   - `TC_WC_04_Tim_Kiem_Empty_State_...`
   - `TC_WC_05_Chuyen_Tab_Nhanh_...`

4. **Quy tắc Assertion An Toàn**:
   - Mọi test case Worst-case phải kiểm tra chính xác thông báo lỗi hiển thị (`text_visible`), thuộc tính viền đỏ hoặc URL redirect (`url_contains` / `url_not_contains`).
   - Tuyệt đối không để test case kết thúc mà thiếu bước kiểm tra (`check`).
