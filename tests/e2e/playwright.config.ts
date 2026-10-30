import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3010";

export default defineConfig({
  testDir: ".",
  testMatch: ["*.spec.ts"],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @doceomenter/web exec next dev -p 3010",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: "3010",
      DATA_ROOT: process.env.DATA_ROOT ?? "/tmp/doceomenter-runs",
      DOCEOMENTER_SECRET_KEY: process.env.DOCEOMENTER_SECRET_KEY ?? "doceomenter-local-dev-secret",
      CREDENTIALS_DIR: process.env.CREDENTIALS_DIR ?? "/tmp/doceomenter-credentials",
      ALLOW_LOCAL_CLI: process.env.ALLOW_LOCAL_CLI ?? "false",
      DOCEOMENTER_INPROCESS: "1",
      ANTHROPIC_API_KEY: process.env.E2E_ANTHROPIC_API_KEY ?? "",
    },
  },
});
