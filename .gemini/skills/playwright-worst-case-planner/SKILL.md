---
name: playwright-worst-case-planner
description: Hướng dẫn chuyên sâu cho AI Planner trong việc thiết kế toàn diện các kịch bản kiểm thử Worst-Case, tấn công biên, SQLi/XSS payloads, và các lỗi phá vỡ trải nghiệm người dùng (UX-Breaking Bugs).
---

## 🎯 Quy tắc phân bổ test case (BẮT BUỘC):
Với mỗi trang web hoặc tính năng được phân tích, Planner **BẮT BUỘC** áp dụng công thức:
👉 **01 Test Case Happy Path** (Kiểm tra luồng chính với dữ liệu hợp lệ thành công).
👉 **NHIỀU Test Cases Worst-Case (Tối thiểu 3 - 6 kịch bản)** bao phủ toàn diện:
1. `TC_WC_01_Bao_Mat_Bypass_Hoac_SQLi_XSS`
2. `TC_WC_02_Validation_Form_Rong`
3. `TC_WC_03_Chuoi_Sieu_Dai_Chong_Vo_Layout`
4. `TC_WC_04_Tim_Kiem_Empty_State`
5. `TC_WC_05_Chuyen_Tab_Nhanh_Chong_Race_Condition`
6. `TC_WC_06_Huy_Modal_Kiem_Tra_Reset_Form`

---

## 🎯 8 Trụ cột Kiểm thử Worst-Case bắt buộc:

1. **Xác thực & Phân quyền (Auth & Session Security - CRITICAL)**:
   - Truy cập thẳng trang nội bộ khi chưa đăng nhập $\rightarrow$ Phải redirect về `/dang-nhap`.
   - Chuỗi SQL Injection: `' OR '1'='1`, `admin' --` trên form đăng nhập $\rightarrow$ Không được lộ lỗi 500.
   - XSS Payload: `<script>alert(1)</script>` $\rightarrow$ Escape an toàn.
   - Ô nhập rỗng hoặc toàn khoảng trắng $\rightarrow$ Client-side validation chặn gửi.

2. **Dữ liệu Cực hạn & Biên giới (Data Boundary - HIGH)**:
   - Chuỗi siêu dài (500+ ký tự) vào ô tìm kiếm $\rightarrow$ Không vỡ bố cục ngang (No layout overflow).
   - Ký tự Regex đặc biệt: `.*+?^${}()|[]\` $\rightarrow$ Không gây lỗi Unhandled Regex.
   - Unicode, Emojis, Tiếng Việt có dấu $\rightarrow$ Hiển thị đúng, không lỗi `???`.
   - Trimming khoảng trắng: `"   Từ khóa   "` $\rightarrow$ Tự động trim 2 đầu.

3. **Validation Form & Race Condition (Form UX - HIGH)**:
   - Gửi Form rỗng $\rightarrow$ Tất cả trường bắt buộc viền đỏ kèm thông báo lỗi cụ thể.
   - Double-Click / Spam nút Lưu $\rightarrow$ Nút tự disable / hiển thị spinner để chống tạo bản ghi trùng trong DB.
   - Hủy modal giữa chừng $\rightarrow$ Mở lại modal phải sạch dữ liệu cũ.

4. **Bảng Dữ liệu & Tìm kiếm (Grid & Search UX - MEDIUM/HIGH)**:
   - Tìm kiếm không có kết quả $\rightarrow$ Hiển thị Empty State thân thiện ("Không tìm thấy dữ liệu phù hợp"), không treo bảng.
   - Chuyển đổi Tab liên tục (Rapid Tab Switching) $\rightarrow$ Không bị lỗi bất đồng bộ (Race condition) hiển thị sai dữ liệu của tab cũ.
   - Xóa bộ lọc $\rightarrow$ Khôi phục ngay danh sách gốc đầy đủ.

5. **Thao tác Xóa & Xác nhận Nguy hiểm (Destructive Actions - HIGH)**:
   - Bấm Xóa $\rightarrow$ Bắt buộc có popup xác nhận. Bấm "Hủy" $\rightarrow$ Dữ liệu còn nguyên.

6. **Tải tệp tin (File Upload - HIGH)**:
   - Upload file sai đuôi (`.exe`, `.sh`) hoặc quá dung lượng (> 20MB) $\rightarrow$ Báo lỗi ngay tại client.

7. **Thông báo lỗi Thân thiện (Error Feedback UX - MEDIUM)**:
   - Tuyệt đối không hiển thị lỗi thô (`500 Server Error`, `TypeError: undefined`).
   - Toast thông báo tự biến mất sau 3-5s hoặc có nút tắt.

8. **Keyboard & Responsive (Accessibility - MEDIUM)**:
   - Phím `Escape` đóng modal, phím `Enter` submit form.
