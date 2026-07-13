import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.NORTHSTAR_E2E_PORT || 3100);
const baseURL = process.env.NORTHSTAR_E2E_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results",
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.NORTHSTAR_E2E_BASE_URL
    ? undefined
    : {
        command: "node tests/e2e/start-server.mjs",
        url: `${baseURL}/login`,
        timeout: 120_000,
        reuseExistingServer: false,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          NORTHSTAR_E2E_PORT: String(port),
          NORTHSTAR_OPERATOR_RESET_TOKEN: "northstar-e2e-reset-token-2026",
        },
      },
});
