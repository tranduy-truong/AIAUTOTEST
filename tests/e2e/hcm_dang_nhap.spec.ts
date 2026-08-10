import { test, expect } from '@playwright/test';

const BASE_URL = 'https://hcm.mobifone.vn/qly-dttg/dang-nhap';

test.describe('E2E Test Suite', () => {
  test('TC_01 - Đăng nhập thành công', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Nhập 'admin' vào ô 'Nhập tên đăng nhập'
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('admin');
    // - Nhập '123123' vào ô 'Nhập mật khẩu'
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    // - Bấm nút 'Đăng nhập'
    await page.getByText('Đăng nhập').click();
    // - Kiểm tra: URL không còn chứa 'dang-nhap'
    await expect(page).not.toHaveURL(/.*dang-nhap.*/i);
  });

  test('TC_02 - Đăng nhập thất bại vì sai mật khẩu', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Nhập 'admin' vào ô 'Nhập tên đăng nhập'
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('admin');
    // - Nhập '1231234' vào ô 'Nhập mật khẩu'
    await page.getByPlaceholder('Nhập mật khẩu').fill('1231234');
    // - Bấm nút 'Đăng nhập'
    await page.getByText('Đăng nhập').click();
    // - Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."
    await expect(page.getByText('Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động.')).toBeVisible();
  });

  test('TC_03 - Đăng nhập thất bại vì sai username', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Nhập 'admin123' vào ô 'Nhập tên đăng nhập'
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('admin123');
    // - Nhập '123123' vào ô 'Nhập mật khẩu'
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    // - Bấm nút 'Đăng nhập'
    await page.getByText('Đăng nhập').click();
    // - Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."
    await expect(page.getByText('Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động.')).toBeVisible();
  });

  test('TC_04 - Đăng nhập thất bại vì bỏ trống mật khẩu', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Nhập 'admin' vào ô 'Nhập tên đăng nhập'
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('admin');
    // - Bấm nút 'Đăng nhập'
    await page.getByText('Đăng nhập').click();
    // - Kiểm tra: Có xuất hiện: "Vui lòng nhập mật khẩu"
    await expect(page.getByText('Vui lòng nhập mật khẩu')).toBeVisible();
  });

  test('TC_05 - Đăng nhập thất bại vì bỏ trống username', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Nhập '123123' vào ô 'Nhập mật khẩu'
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    // - Bấm nút 'Đăng nhập'
    await page.getByText('Đăng nhập').click();
    // - Kiểm tra: Có thông báo: "Vui lòng nhập tên đăng nhập"
    await expect(page.getByText('Vui lòng nhập tên đăng nhập')).toBeVisible();
  });

  test('TC_06 - Đăng nhập thất bại vì sai username (Test chữ hoa)', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Nhập 'Admin' vào ô 'Nhập tên đăng nhập'
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('Admin');
    // - Nhập '123123' vào ô 'Nhập mật khẩu'
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    // - Bấm nút 'Đăng nhập'
    await page.getByText('Đăng nhập').click();
    // - Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."
    await expect(page.getByText('Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động.')).toBeVisible();
  });

  test('TC_07 - Đăng nhập thất bại vì bỏ trống cả 2 trường', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Bấm nút 'Đăng nhập'
    await page.getByText('Đăng nhập').click();
    // - Kiểm tra: Có cả 2 thông báo: "Vui lòng nhập tên đăng nhập" và "Vui lòng nhập mật khẩu" cùng lúc
    await expect(page.locator('body')).toContainText('Có cả 2 thông báo: "Vui lòng nhập tên đăng nhập" và "Vui lòng nhập mật khẩu" cùng lúc');
  });

  test('TC_08 - Kiểm tra tính năng ẩn/hiện mật khẩu (Icon con mắt)', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Nhập '123123' vào ô 'Nhập mật khẩu' (mặc định hiển thị dạng chấm tròn ••••••)
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    // - Bấm vào icon Con mắt ở góc phải ô Mật khẩu
    await page.locator('.lucide-eye, .lucide-eye-off, [class*="eye"]').first().click();
    // - Kiểm tra: Mật khẩu chuyển sang dạng văn bản đọc được ('123123')
    await expect(page.locator('body')).toContainText('Mật khẩu chuyển sang dạng văn bản đọc được (\'123123\')');
    // - Bấm icon Con mắt thêm một lần nữa
    await page.locator('.lucide-eye, .lucide-eye-off, [class*="eye"]').first().click();
    // - Kiểm tra: Mật khẩu quay lại dạng ẩn (••••••)
    await expect(page.locator('body')).toContainText('Mật khẩu quay lại dạng ẩn (••••••)');
  });

  test('TC_09 - Xử lý khoảng trắng thừa ở Username (Trim space)', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Nhập ' admin ' vào ô 'Nhập tên đăng nhập'
    await page.getByPlaceholder('Nhập tên đăng nhập').fill(' admin ');
    // - Nhập '123123' vào ô 'Nhập mật khẩu'
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    // - Bấm nút 'Đăng nhập'
    await page.getByText('Đăng nhập').click();
    // - Kiểm tra: URL không còn chứa 'dang-nhap'
    await expect(page).not.toHaveURL(/.*dang-nhap.*/i);
  });

  test('TC_10 - Kiểm tra chống tấn công SQL Injection', async ({ page }) => {
    // - Mở URL
    await page.goto('https://hcm.mobifone.vn/qly-dttg/dang-nhap');
    await page.waitForLoadState('networkidle');
    // - Bấm nút 'Đăng nhập'
    await page.getByText('Đăng nhập').click();
    // - Kiểm tra: Có thông báo: "Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động."
    await expect(page.getByText('Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động.')).toBeVisible();
  });

});
