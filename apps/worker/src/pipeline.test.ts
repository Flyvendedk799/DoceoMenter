import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "./pipeline.js";
import { RunStore, initialRunState } from "./runStore.js";
import { RunEventBus } from "./eventBus.js";
import { loadConfig } from "./config.js";
import type { RunSpec } from "@doceomenter/shared";

let dataRoot = "";
let bareRepo = "";
let fixtureWork = "";

beforeAll(async () => {
  // Build a tiny static fixture and turn it into a local bare git repo so
  // git clone works with file:// URLs (we'll plug it in as a github.com URL
  // via env var override for the test).
  dataRoot = mkdtempSync(join(tmpdir(), "doceomenter-data-"));
  fixtureWork = mkdtempSync(join(tmpdir(), "doceomenter-fix-"));
  await writeFile(
    join(fixtureWork, "index.html"),
    `<!DOCTYPE html><html><head><title>Static Fixture</title>
    <style>body{font-family:sans-serif;padding:48px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;margin:0;min-height:100vh}h1{font-size:64px;margin:0 0 24px}p{font-size:20px;line-height:1.6}.card{background:rgba(255,255,255,.1);padding:32px;border-radius:16px;max-width:520px;backdrop-filter:blur(10px)}</style>
    </head><body><div class="card"><h1>Static Fixture</h1><p>This is a tiny static site used by DoceoMenter's integration test. It exists so the capture engine has something colorful and varied to screenshot.</p><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p></div></body></html>`,
  );
  await writeFile(
    join(fixtureWork, "README.md"),
    `# Static Fixture\n\nA tiny single-page HTML used by DoceoMenter's integration test. It exists so the capture engine has something colorful and varied to screenshot during pipeline verification.\n\n## Why\n\nIt is intentionally minimal: a single \`index.html\` with inline CSS, no build step, no dependencies.\n\n## Layout\n\n- \`index.html\` — the entire site.\n- \`README.md\` — this file.\n`,
  );
  await execa("git", ["init", "-b", "main"], { cwd: fixtureWork });
  await execa("git", ["add", "."], { cwd: fixtureWork });
  await execa(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "tag.gpgsign=false",
      "-c",
      "user.email=test@test.local",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      "init",
    ],
    { cwd: fixtureWork },
  );
  bareRepo = mkdtempSync(join(tmpdir(), "doceomenter-bare-"));
  await rm(bareRepo, { recursive: true, force: true });
  await mkdir(bareRepo, { recursive: true });
  await execa("git", ["clone", "--bare", fixtureWork, bareRepo]);
});

afterAll(async () => {
  await rm(dataRoot, { recursive: true, force: true });
  await rm(fixtureWork, { recursive: true, force: true });
  await rm(bareRepo, { recursive: true, force: true });
});

describe("pipeline (static-site fixture)", () => {
  it("runs end-to-end and produces report.md, deck.html, deck.pdf", async () => {
    process.env.DATA_ROOT = dataRoot;
    process.env.RUN_MODE = "in-process";
    delete process.env.ANTHROPIC_API_KEY; // force fixture client

    const config = loadConfig();
    const store = new RunStore(config.DATA_ROOT);
    const bus = new RunEventBus(store);

    const spec: RunSpec = {
      url: `https://github.com/local/static-fixture`, // satisfies regex
      ref: "main",
    };
    const runId = "test-static-1";
    await store.write(runId, initialRunState(runId, spec));

    // Monkey-patch: clone stage uses git clone <url>; we override the URL by
    // using a thin git wrapper via GIT_CONFIG_GLOBAL... simpler approach:
    // pass the bareRepo as the URL directly (URL validation is strict, so
    // we bypass via the worker's config). The cleanest way is to expose the
    // url override via env. For this test we patch process.env to hold the
    // override and read it in the test pipeline.
    process.env.TEST_OVERRIDE_REPO_URL = `file://${bareRepo}`;

    // Patch the spec's URL to file:// directly — the schema allows http/https
    // but the cloneRepo function only invokes git clone <url>. We bypass
    // schema validation for this internal test.
    const result = await runPipeline({
      runId,
      spec: { ...spec, url: `file://${bareRepo}` },
      config,
      store,
      bus,
    });

    expect(["done", "partial"]).toContain(result.state);
    const dir = store.runDir(runId);
    expect(statSync(join(dir, "report.md")).size).toBeGreaterThan(600);
    expect(statSync(join(dir, "deck.html")).size).toBeGreaterThan(2000);
    // PDF may fail in some environments; if produced, it should be non-trivial.
    try {
      const pdfSize = statSync(join(dir, "deck.pdf")).size;
      expect(pdfSize).toBeGreaterThan(2000);
    } catch {
      // PDF render may have been degraded; pipeline state should reflect that.
      expect(result.state).toBe("partial");
    }
    // At least one screenshot must exist.
    const md = readFileSync(join(dir, "report.md"), "utf-8");
    expect(md).toMatch(/!\[.*]\(\.\/assets\/screenshots\/.*\.png\)/);
  }, 120_000);
});
