import fs from "fs";
import { defineConfig, devices } from "@playwright/test";

// Tu dong inject storageState neu .auth/storage-state.json da ton tai
const storageStatePath = fs.existsSync(".auth/storage-state.json")
  ? ".auth/storage-state.json"
  : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  expect: {
    timeout: 10000, // Timeout cho expect chờ server phản hồi
  },
  fullyParallel: false, // Chạy tuần tự các file để hạn chế xung đột session/race condition
  forbidOnly: !!process.env.CI,
  retries: 1, // Tự động chạy lại lần 2 nếu lần 1 bị fail do timeout mạng/server
  workers: process.env.CI ? 1 : 2, // Hạn chế số worker song song để tránh rate limit server
  reporter: process.env.CI ? "github" : "html",
  use: {
    actionTimeout: 15000, // Timeout cho các action click, fill, select
    navigationTimeout: 30000, // Timeout cho chuyển hướng trang
    trace: "on-first-retry",
    headless: !!process.env.CI,
    storageState: storageStatePath,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

