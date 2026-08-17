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
| **WC_AUTH_01** | Truy cập trái phép Deep Link khi chưa đăng nhập | 1. Mở thẳng URL nội bộ (ví dụ: `/quan-tri/ton-giao/co-so`) trong tab ẩn danh sạch (chưa login). | Hệ thống **lập tức chuyển hướng (redirect) về trang `/dang-nhap`**, tuyệt đối không để lộ dữ liệu hay layout quản trị. |
| **WC_AUTH_02** | Thử nghiệm SQL Injection trên Form Đăng nhập | 1. `fill` ô Tên đăng nhập: `' OR '1'='1`<br>2. `fill` ô Mật khẩu: `' OR '1'='1`<br>3. `click` Đăng nhập. | Hệ thống **không bị lỗi 500 / Crash**, hiển thị thông báo lỗi thân thiện: `"Tên đăng nhập hoặc mật khẩu không chính xác"`. |
| **WC_AUTH_03** | Thử nghiệm XSS Payload trên ô Tên đăng nhập | 1. `fill` ô Tên đăng nhập: `<script>alert('XSS')</script>`<br>2. `fill` ô Mật khẩu: `123456`<br>3. `click` Đăng nhập. | Chuỗi script được escape an toàn, không thực thi mã độc, báo lỗi đăng nhập thất bại. |
| **WC_AUTH_04** | Đăng nhập với các trường rỗng hoặc chỉ toàn khoảng trắng | 1. `fill` ô Tên đăng nhập: `   ` (3 dấu cách)<br>2. `fill` ô Mật khẩu: `   `<br>3. `click` Đăng nhập. | Giao diện hiển thị cảnh báo yêu cầu nhập tên đăng nhập/mật khẩu, không gửi request rác lên server. |
| **WC_AUTH_05** | Đăng nhập sai mật khẩu nhiều lần (Rate Limit UX) | 1. `fill` đúng username: `admin`<br>2. `fill` sai password: `sai_mat_khau_123`<br>3. `click` Đăng nhập liên tiếp. | Hệ thống hiển thị thông báo rõ ràng về số lần thử hoặc yêu cầu thử lại sau X giây, không treo trình duyệt. |
| **WC_AUTH_06** | Ẩn / Hiện mật khẩu trên form đăng nhập | 1. `fill` mật khẩu `123123`<br>2. `click` icon con mắt (Show/Hide password). | Thuộc tính ô nhập đổi từ `type="password"` sang `type="text"` và ngược lại. |

---

### ⚡ NHÓM 2: DỮ LIỆU CỰC HẠN, BIÊN GIỚI & KÝ TỰ ĐẶC BIỆT (DATA BOUNDARY - HIGH)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_DATA_01** | Chuỗi siêu dài (Extreme Length / Buffer Test) vào ô Tìm kiếm | 1. `fill` vào ô Tìm kiếm chuỗi 500+ ký tự: `TEST_STRING_LONG_...` (lặp lại 50 lần).<br>2. `press` Enter hoặc bấm Tìm kiếm. | Giao diện **không bị vỡ bố cục ngang (No horizontal scroll overflow)**, bảng hiển thị thông báo không tìm thấy kết quả hoặc cắt gọn an toàn. |
| **WC_DATA_02** | Ký tự đặc biệt Regex & Meta-characters | 1. `fill` vào ô Tìm kiếm: `.*+?^${}()\|[]\\` và `!@#$%^&*~`. | Hệ thống không ném lỗi cú pháp Regex (Unhandled Regex Error), xử lý chuỗi như text thuần. |
| **WC_DATA_03** | Ký tự Unicode, Emojis & Đa ngôn ngữ | 1. `fill` vào trường dữ liệu: `🚀 Tôn Giáo Việt Nam 🇻🇳 🕌 ⛪ 100% Valid`. | Dữ liệu hiển thị đúng chuẩn Unicode, không bị biến thành dấu hỏi `???` hoặc ký tự rác. |
| **WC_DATA_04** | Khoảng trắng ở đầu và cuối chuỗi (Whitespace Trimming) | 1. `fill` vào ô tìm kiếm: `"   Chùa Vĩnh Nghiêm   "` (có khoảng trắng thừa ở 2 đầu). | Hệ thống tự động trim khoảng trắng và vẫn tìm thấy đúng bản ghi "Chùa Vĩnh Nghiêm". |
| **WC_DATA_05** | Giá trị số âm, số 0, số thập phân cho trường Số lượng / Năm | 1. `fill` các trường năm/số lượng: `-2024`, `0`, `99999999999`. | Hệ thống hiển thị lỗi validation: `"Giá trị không hợp lệ"` hoặc chặn nhập số âm. |

---

### 📝 NHÓM 3: VALIDATION FORM, RACE CONDITION & UX STATE (FORM UX - HIGH)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_FORM_01** | Gửi Form hoàn toàn rỗng (Blank Form Submission) | 1. Mở form Thêm mới / Cập nhật.<br>2. Không điền bất kỳ trường nào.<br>3. `click` Lưu / Thêm mới. | **Tất cả các trường bắt buộc** đồng loạt viền đỏ và hiển thị dòng chữ lỗi cụ thể (ví dụ: `"Vui lòng nhập tên cơ sở"`), form không bị gửi đi. |
| **WC_FORM_02** | Chống bấm nút liên tục (Double Submission / Spam Click) | 1. Điền thông tin hợp lệ vào form.<br>2. `click` liên tiếp 3 lần cực nhanh vào nút "Lưu" (Spam click). | Nút bấm tự động chuyển sang trạng thái **Disabled / Loading Spinner** sau cú click đầu tiên, ngăn chặn việc tạo 2 bản ghi trùng lặp trong Database. |
| **WC_FORM_03** | Hủy form giữa chừng & Reset trạng thái (Form Abandonment) | 1. Mở modal Thêm mới.<br>2. Nhập một nửa thông tin dở dang.<br>3. `click` nút "Hủy" hoặc "Đóng" (hoặc phím Escape).<br>4. Mở lại modal Thêm mới. | Modal mở lại với **trạng thái hoàn toàn sạch (Clean Form)**, không còn lưu các dữ liệu rác đã nhập trước đó. |
| **WC_FORM_04** | Nhập dữ liệu trùng lặp trường định danh duy nhất (Duplicate Key) | 1. Mở form Thêm mới.<br>2. Nhập Mã cơ sở / CCCD đã tồn tại trong hệ thống (ví dụ: `CSTG001`).<br>3. `click` Lưu. | Hệ thống thông báo rõ ràng: `"Mã cơ sở đã tồn tại trong hệ thống"`, trỏ đúng vào ô bị trùng. |

---

### 📊 NHÓM 4: BẢNG DỮ LIỆU, TÌM KIẾM, LỌC & PHÂN TRANG (GRID & SEARCH UX - MEDIUM/HIGH)

| Mã | Tên kịch bản | Thao tác (Action Steps) | Kỳ vọng hệ thống (Expected Result) |
|---|---|---|---|
| **WC_GRID_01** | Tìm kiếm không có kết quả (Empty State UX) | 1. `fill` từ khóa vô nghĩa: `__KHONG_THE_TIM_THAY_DU_LIEU_99999__`.<br>2. `click` Tìm kiếm. | Bảng hiển thị **thông báo / hình ảnh Empty State thân thiện** (`"Không tìm thấy dữ liệu phù hợp"`), không để bảng trống trơn hay bị sập layout. |
| **WC_GRID_02** | Chuyển đổi Tab phân loại liên tục (Rapid Tab Switching Race Condition) | 1. `click` Tab 1 (Chức sắc) $\rightarrow$ Ngay lập tức `click` Tab 2 (Chức việc) $\rightarrow$ `click` Tab 3 (Nhà tu hành) trong 1 giây. | Dữ liệu hiển thị cuối cùng phải khớp 100% với Tab đang active, không bị hiển thị chồng chéo dữ liệu cũ do bất đồng bộ (Async race condition). |
| **WC_GRID_03** | Xóa bộ lọc tìm kiếm (Clear Filter / Reset State) | 1. Nhập từ khóa tìm kiếm và chọn bộ lọc $\rightarrow$ Bấm Tìm.<br>2. `click` nút "Làm mới" / "Đặt lại" / Xóa ô tìm kiếm. | Bảng dữ liệu lập tức khôi phục về danh sách đầy đủ ban đầu. |
| **WC_GRID_04** | Phân trang ở các vị trí biên (Pagination Boundary) | 1. Ở trang 1: Kiểm tra nút "Trang trước" (Previous) bị **Disabled**.<br>2. Chuyển đến trang cuối: Kiểm tra nút "Trang sau" (Next) bị **Disabled**. | Người dùng không thể bấm vượt quá số trang hiện có. |

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
