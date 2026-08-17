---
name: playwright-test-generator
description: Hướng dẫn và quy tắc sinh mã kiểm thử Playwright TypeScript chuẩn xác, xử lý strict mode violation, sai lệch ARIA role, fallback selector và web-first assertions.
---

# Kỹ năng Sinh Mã Kiểm Thử Playwright E2E

Kỹ năng này cung cấp các nguyên tắc cốt lõi giúp AI Generator sinh mã Playwright E2E chính xác 100%, không bị dính các lỗi kinh điển như **Strict Mode Violation**, **Sai lệch Role (Tab vs Button)**, hay **Session/Auth Conflict**.

---

## 1. Quy Tắc Xử Lý Locator Bền Vững (Universal Fallback Chaining with `.or()`)

### 1.1. Chuỗi Fallback Bắt Buộc Khi Click (`page.getByRole` / `page.getByText`)
Để phòng trường hợp không get đúng element hoặc dev thay đổi role giữa thẻ `button`, `tab`, `link`, `div`, `span`:
* **✅ BẮT BUỘC**: Luôn xâu chuỗi các điều kiện `.or(...)` và kết thúc bằng `.first()`:
  ```typescript
  // Click nút Thêm / Chuyển Tab / Thao tác:
  await page.getByRole('tab', { name: /Quá trình thay đổi/i })
    .or(page.getByRole('button', { name: /Quá trình thay đổi/i }))
    .or(page.getByText('Quá trình thay đổi'))
    .first()
    .click();
  ```

---

### 1.2. Chuỗi Fallback Bắt Buộc Khi Nhập Liệu (`page.getByPlaceholder` / `page.getByLabel`)
Để không bị trượt element khi label không bọc ô input hoặc placeholder bị đổi:
* **✅ BẮT BUỘC**:
  ```typescript
  // Nhập Tên đăng nhập:
  await page.getByPlaceholder(/tên đăng nhập/i)
    .or(page.getByLabel(/tên đăng nhập/i))
    .first()
    .fill('admin');

  // Nhập Mật khẩu:
  await page.getByPlaceholder(/mật khẩu/i)
    .or(page.getByLabel(/mật khẩu/i))
    .first()
    .fill('123123');
  ```

---

### 1.3. Tránh Lỗi `Strict Mode Violation` trên `getByText`
Khi một đoạn text xuất hiện ở nhiều vị trí (ví dụ: vừa ở tiêu đề `<h1>`, vừa ở trong bảng `<p>`):
* **❌ KHÔNG NÊN**:
  ```typescript
  await expect(page.getByText('Chùa Vĩnh Nghiêm', { exact: true })).toBeVisible();
  ```
* **✅ BẮT BUỘC**: Luôn gắn `.first()` khi kiểm tra sự tồn tại của văn bản:
  ```typescript
  await expect(page.getByText('Chùa Vĩnh Nghiêm').first()).toBeVisible();
  ```

---

### 1.3. Xử lý Dữ liệu Động & Tránh Lỗi Không Khớp Tuyệt Đối (Dynamic Data Matching)
Dữ liệu trong Database thực tế thường có khoảng trắng thừa, số thứ tự thêm phía sau (ví dụ: `BTS GHPGVN TP. Hồ Chí Minh333`).
* **❌ KHÔNG NÊN**: Dùng `{ exact: true }` cho các chuỗi dữ liệu dài:
  ```typescript
  // Dễ fail nếu text thực tế có thêm số đuôi hoặc khoảng trắng
  await expect(page.getByText('BTS GHPGVN TP. Hồ Chí Minh', { exact: true }).first()).toBeVisible();
  ```
* **✅ BẮT BUỘC**: Dùng Regular Expression `/.../i` hoặc so khớp từng phần (Partial Match):
  ```typescript
  // Linh hoạt, không phân biệt hoa thường và không bị lỗi vì số đuôi:
  await expect(page.getByText(/BTS GHPGVN TP\. Hồ Chí Minh/i).first()).toBeVisible();
  ```

---

### 1.4. Thao tác trên ô Nhập liệu (Form Input & Password)
* **TUYỆT ĐỐI KHÔNG** dùng `getByText()` để kiểm tra nội dung ô `<input>`. Thẻ input không chứa text content.
* **BẮT BUỘC** dùng:
  ```typescript
  // Điền dữ liệu
  await page.getByPlaceholder(/tên đăng nhập/i).fill('admin');

  // Kiểm tra giá trị đã điền
  await expect(page.getByPlaceholder(/tên đăng nhập/i)).toHaveValue('admin');

  // Kiểm tra trạng thái ẩn/hiện mật khẩu
  await expect(page.getByPlaceholder(/mật khẩu/i)).toHaveAttribute('type', 'password');
  await expect(page.getByPlaceholder(/mật khẩu/i)).toHaveAttribute('type', 'text');
  ```

---

### 1.5. Nút Thêm mới (+ Thêm / Thêm cơ sở)
Luôn dùng Regular Expression không phân biệt hoa thường để bắt trọn cả nút có dấu `+`:
```typescript
await page.getByRole('button', { name: /thêm/i }).click();
```

## 2. Kiểm Tra Chuyển Hướng Sau Đăng Nhập (Auth Navigation)
Không nên đoán mò URL chuyển hướng sang dashboard cụ thể. Cách kiểm tra rời trang đăng nhập chuẩn xác cho mọi dự án:
```typescript
// Bấm nút đăng nhập
await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click({ noWaitAfter: true });

// Chờ và kiểm tra đã rời khỏi trang đăng nhập
await expect(page).not.toHaveURL(/.*(dang-nhap|login).*/i);
```

---

## 3. Cấu Trúc File Test Chuẩn

```typescript
import { test, expect } from '@playwright/test';

test.describe('Tên Module Nghiệp Vụ', () => {
  test('TC_01 - Tên test case mô tả rõ ràng', async ({ page }) => {
    // 1. Mở trang
    await page.goto('https://example.com/login', { waitUntil: 'domcontentloaded' });

    // 2. Điền form
    await page.getByPlaceholder('Tên đăng nhập').fill('admin');
    await page.getByPlaceholder('Mật khẩu').fill('123456');
    await page.getByRole('button', { name: 'Đăng nhập' }).click({ noWaitAfter: true });

    // 3. Assertions an toàn
    await expect(page).not.toHaveURL(/.*login.*/i);
    await expect(page.getByText('Bảng điều khiển', { exact: true }).first()).toBeVisible();
  });
});
```
