import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  fullyParallel: false, // Chạy tuần tự các file hoặc hạn chế race condition
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2, // Hạn chế số worker song song để tránh rate limit server
  reporter: process.env.CI ? "github" : "html",
  use: {
    trace: "on-first-retry",
    headless: !!process.env.CI,
    // Không dùng storageState (mỗi testcase độc lập với tài khoản/mật khẩu riêng)
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
