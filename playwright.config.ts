import fs from "fs";
import { defineConfig, devices } from "@playwright/test";

// Tu dong inject storageState neu .auth/storage-state.json da ton tai
const storageStatePath = fs.existsSync(".auth/storage-state.json")
  ? ".auth/storage-state.json"
  : undefined;

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
    storageState: storageStatePath,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

