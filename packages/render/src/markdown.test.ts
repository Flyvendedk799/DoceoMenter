import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { renderMarkdown } from "./markdown.js";
import type { RenderInput } from "./types.js";

const baseInput: RenderInput = {
  runId: "abc123",
  generatedAt: "2026-05-06T00:00:00Z",
  analysis: {
    repo: { owner: "octocat", name: "demo", ref: "main", commitSha: "abc1234567" },
    sizeBytes: 1000,
    fileCount: 5,
    languages: { TypeScript: 1000 },
    manifests: { nodePkg: { name: "demo", scripts: { dev: "vite" }, deps: [], devDeps: ["vite"] } },
    entrypoints: ["src/main.tsx"],
    fileIndex: [],
    signals: { hasFrontend: true, hasBackend: false, hasCLI: false, isLibrary: false, framework: "vite" },
  },
  content: {
    concept: {
      what: "A demo app to verify the pipeline. Detected as a small Vite React project.",
      why: "Built to exercise the screenshot capture path during integration tests.",
      vision: "vision not stated in source",
      audience: ["Engineers working on DoceoMenter"],
    },
    capturePlan: { shots: [] },
    technical: {
      stack: [{ technology: "Vite", evidence: "package.json" }],
      architecture: "A simple SPA with no backend; bundled by Vite and rendered into #app.",
      dataFlow: "User loads index.html → bundle executes → DOM mounted into #app.",
      keyModules: [{ path: "src/main.tsx", role: "entry", oneLineSummary: "App bootstrap.", citations: ["src/main.tsx:1"] }],
      gettingStarted: ["pnpm install", "pnpm dev"],
    },
    captions: [{ shotId: "live-home", markdown: "The home view of the app." }],
    summary: { oneLiner: "A tiny demo Vite app", tldr: ["A.", "B.", "C."] },
  },
  capture: {
    entries: [
      {
        shotId: "live-home",
        shot: { id: "live-home", kind: "screenshot", target: "live-app", route: "/", viewport: { w: 1440, h: 900 }, caption: "Home", importance: 1 },
        status: "ok",
        outputs: { pngPath: "/tmp/screenshots/live-home.png", width: 1440, height: 900, bytes: 100, sha256: "x" },
      },
    ],
  },
  assetsBasePath: "./assets",
};

describe("renderMarkdown", () => {
  it("produces a non-empty markdown report with all required sections", async () => {
    const dir = mkdtempSync(join(tmpdir(), "doceomenter-md-"));
    const out = join(dir, "report.md");
    await renderMarkdown(baseInput, out);
    const md = readFileSync(out, "utf-8");
    expect(md).toContain("# demo");
    expect(md).toMatch(/## TL;DR/);
    expect(md).toMatch(/## Concept/);
    expect(md).toMatch(/## Vision/);
    expect(md).toMatch(/## In motion/);
    expect(md).toMatch(/## Tech stack/);
    expect(md).toMatch(/## Getting started/);
    expect(md).toMatch(/!\[.*]\(\.\/assets\/screenshots\/live-home\.png\)/);
    expect(md.length).toBeGreaterThan(600);
  });
});
