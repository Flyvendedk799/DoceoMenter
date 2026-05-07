import { test, expect } from "@playwright/test";

/**
 * Full-stack end-to-end smoke test.
 *
 * Assumes the stack is already running:
 *   - redis-server on 127.0.0.1:6379
 *   - worker process (apps/worker)
 *   - Next.js dev/prod server on E2E_BASE_URL (default http://127.0.0.1:3010)
 *
 * The repo URL it submits is read from E2E_REPO_URL — defaults to a small public
 * GitHub repo so the test is hermetic against a real Anthropic call OR the
 * deterministic fixture client (when ANTHROPIC_API_KEY is unset).
 */

const REPO_URL = process.env.E2E_REPO_URL ?? "https://github.com/sindresorhus/slugify";

test("home → run → artifacts", async ({ page, baseURL }) => {
  await page.goto(baseURL!);
  await expect(page.getByRole("heading", { name: "DoceoMenter" })).toBeVisible();

  // Fill the URL and submit.
  await page.getByLabel("GitHub repository URL").fill(REPO_URL);
  await page.getByRole("button", { name: "Generate" }).click();

  // We should land on /run/<id> with the progress UI.
  await page.waitForURL(/\/run\/[a-f0-9]+$/, { timeout: 15_000 });
  await expect(page.getByText(/^Run /)).toBeVisible();

  // Wait for the deck button to appear (state goes done|partial).
  await expect(page.getByRole("link", { name: /Open presentation/ })).toBeVisible({
    timeout: 90_000,
  });

  // The Markdown download should be present too.
  const mdLink = page.getByRole("link", { name: "Download Markdown" });
  await expect(mdLink).toBeVisible();

  // Fetch the markdown via the URL the link points at — it must be non-empty.
  const href = await mdLink.getAttribute("href");
  expect(href).toBeTruthy();
  const res = await page.context().request.get(new URL(href!, baseURL!).toString());
  expect(res.ok()).toBe(true);
  const body = await res.text();
  expect(body.length).toBeGreaterThan(400);
  expect(body).toMatch(/## TL;DR|## Concept/);
});
