import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3010";

// The dev server is started on the port of the URL the tests wait for, so a custom
// E2E_BASE_URL (e.g. http://127.0.0.1:3020) boots there instead of on 3010 and timing out.
const parsedBaseURL = new URL(baseURL);
const port =
  parsedBaseURL.port || (parsedBaseURL.protocol === "https:" ? "443" : "80");

// Only start a server for a local URL; a remote E2E_BASE_URL, or E2E_SKIP_WEBSERVER=1, means
// the server is managed elsewhere (e.g. scripts/start-stack.sh or a deployed stack).
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "[::1]"]);
const startWebServer =
  process.env.E2E_SKIP_WEBSERVER !== "1" && LOCAL_HOSTS.has(parsedBaseURL.hostname);

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
  webServer: startWebServer
    ? {
        command: `pnpm --filter @doceomenter/web exec next dev -p ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PORT: port,
          DATA_ROOT: process.env.DATA_ROOT ?? "/tmp/doceomenter-runs",
          DOCEOMENTER_SECRET_KEY: process.env.DOCEOMENTER_SECRET_KEY ?? "doceomenter-local-dev-secret",
          CREDENTIALS_DIR: process.env.CREDENTIALS_DIR ?? "/tmp/doceomenter-credentials",
          ALLOW_LOCAL_CLI: process.env.ALLOW_LOCAL_CLI ?? "false",
          DOCEOMENTER_INPROCESS: "1",
          ANTHROPIC_API_KEY: process.env.E2E_ANTHROPIC_API_KEY ?? "",
        },
      }
    : undefined,
});
