import { test, expect } from '@playwright/test';

const BASE_URL = 'https://hcm.mobifone.vn/qly-dttg';

test.describe('Đăng nhập', () => {
  test('TC_01 - Đăng nhập thành công với tài khoản admin và mật khẩu 123123', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('admin');
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).not.toHaveURL(/.*(dang-nhap|login).*/i);
  });

  test('TC_02 - Đăng nhập thất bại vì sai mật khẩu', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('admin');
    await page.getByPlaceholder('Nhập mật khẩu').fill('1231234');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByText('Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động.')).toBeVisible();
  });

  test('TC_03 - Đăng nhập thất bại vì sai username', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('admin1');
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByText('Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động.')).toBeVisible();
  });

  test('TC_04 - Đăng nhập thất bại vì bỏ trống mật khẩu', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('admin');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByText('Vui lòng nhập mật khẩu')).toBeVisible();
  });

  test('TC_05 - Đăng nhập thất bại vì bỏ trống username', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByText('Vui lòng nhập tên đăng nhập')).toBeVisible();
  });

  test('TC_06 - Đăng nhập thất bại vì sai username (Test chữ hoa)', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByPlaceholder('Nhập tên đăng nhập').fill('Admin');
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByText('Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động.')).toBeVisible();
  });

  test('TC_07 - Đăng nhập thất bại vì bỏ trống cả 2 trường', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByText('Vui lòng nhập tên đăng nhập')).toBeVisible();
    await expect(page.getByText('Vui lòng nhập mật khẩu')).toBeVisible();
  });

  test('TC_08 - Kiểm tra tính năng ẩn/hiện mật khẩu', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    await page.locator('.lucide-eye, .lucide-eye-off, [data-align="inline-end"], [class*="eye"]').first().click();
    await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'text');
    await page.locator('.lucide-eye, .lucide-eye-off, [data-align="inline-end"], [class*="eye"]').first().click();
    await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'password');
  });

  test('TC_09 - Xử lý khoảng trắng thừa ở Username', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByPlaceholder('Nhập tên đăng nhập').fill(' admin ');
    await page.getByPlaceholder('Nhập mật khẩu').fill('123123');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page).not.toHaveURL(/.*(dang-nhap|login).*/i);
  });

  test('TC_10 - Kiểm tra chống tấn công SQL Injection', async ({ page }) => {
    await page.goto(`${BASE_URL}/dang-nhap`);
    await page.getByPlaceholder('Nhập tên đăng nhập').fill("OR '1'='1");
    await page.getByPlaceholder('Nhập mật khẩu').fill("OR '1'='1");
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(page.getByText('Thông tin đăng nhập không chính xác hoặc tài khoản không còn hoạt động.')).toBeVisible();
  });
});
