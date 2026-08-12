import fs from 'fs';
import { defineConfig, devices } from "@playwright/test";

// Tu dong inject storageState neu .auth/storage-state.json da ton tai
const storageState = fs.existsSync('.auth/storage-state.json')
  ? '.auth/storage-state.json'
  : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    trace: "on-first-retry",
    headless: !!process.env.CI,
    ...(storageState ? { storageState } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
