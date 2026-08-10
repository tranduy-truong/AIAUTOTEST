import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.js",
      "tests/integration/**/*.test.ts",
      "tests/integration/**/*.test.js"
    ],
    testTimeout: 120000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
