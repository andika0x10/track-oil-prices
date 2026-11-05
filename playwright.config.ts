import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4321",
    browserName: "chromium",
    headless: true,
  },
  reporter: "list",
  workers: 1,
});
