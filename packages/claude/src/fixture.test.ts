import { describe, expect, it } from "vitest";
import {
  CapturePlanSchema,
  CaptionSchema,
  ConceptSchema,
  SummarySchema,
  TechnicalSchema,
  type Analysis,
  type CaptureManifest,
} from "@doceomenter/shared";
import { createFixtureClient } from "./fixture.js";

const baseAnalysis: Analysis = {
  repo: { owner: "octocat", name: "demo", ref: "main", commitSha: "abc1234" },
  sizeBytes: 1024 * 200,
  fileCount: 60,
  languages: { TypeScript: 12000, CSS: 3000 },
  manifests: {
    nodePkg: {
      name: "demo",
      scripts: { dev: "vite", build: "vite build" },
      deps: ["react", "react-dom"],
      devDeps: ["vite", "typescript"],
    },
  },
  entrypoints: ["src/main.tsx", "index.html"],
  readme: {
    path: "README.md",
    firstNHeadings: ["Demo", "Getting started"],
    rawTrimmed: "# Demo\nA tiny demo app to show off the pipeline. It does X and Y.",
  },
  fileIndex: [
    { path: "package.json", bytes: 400 },
    { path: "src/main.tsx", bytes: 220 },
    { path: "index.html", bytes: 180 },
    { path: "README.md", bytes: 80 },
  ],
  signals: { hasFrontend: true, hasBackend: false, hasCLI: false, isLibrary: false, framework: "vite" },
};

describe("fixture claude client", () => {
  it("produces a schema-valid concept and capture plan", async () => {
    const client = createFixtureClient();
    const { concept, capturePlan } = await client.draftConceptAndPlan(baseAnalysis, {
      includeVideo: true,
      outputStyle: "standard",
    });
    expect(ConceptSchema.parse(concept)).toBeTruthy();
    expect(CapturePlanSchema.parse(capturePlan)).toBeTruthy();
    // hasFrontend → at least one live-app shot
    expect(
      capturePlan.shots.some((s) => s.kind === "screenshot" && s.target === "live-app"),
    ).toBe(true);
    // includeVideo → at most one video, but at least one when hasFrontend
    expect(capturePlan.shots.filter((s) => s.kind === "video").length).toBeGreaterThanOrEqual(1);
    // fileCount > 50 → architecture diagram
    expect(
      capturePlan.shots.some((s) => s.kind === "screenshot" && s.target === "code-architecture"),
    ).toBe(true);
  });

  it("library-only repo: no live-app shot", async () => {
    const client = createFixtureClient();
    const { capturePlan } = await client.draftConceptAndPlan(
      {
        ...baseAnalysis,
        signals: { ...baseAnalysis.signals, hasFrontend: false, isLibrary: true },
      },
      { includeVideo: false, outputStyle: "standard" },
    );
    expect(
      capturePlan.shots.every((s) => !(s.kind === "screenshot" && s.target === "live-app")),
    ).toBe(true);
  });

  it("technical pass returns one caption per successful capture and a valid summary", async () => {
    const client = createFixtureClient();
    const { capturePlan } = await client.draftConceptAndPlan(baseAnalysis, {
      includeVideo: false,
      outputStyle: "standard",
    });
    const manifest: CaptureManifest = {
      entries: capturePlan.shots.map((shot, i) => ({
        shotId: shot.id,
        shot,
        status: i % 2 === 0 ? "ok" : "failed",
        failureReason: i % 2 === 0 ? undefined : "simulated",
      })),
    };
    const { technical, captions, summary } = await client.draftTechnicalAndCaptions(
      baseAnalysis,
      (await client.draftConceptAndPlan(baseAnalysis, { includeVideo: false, outputStyle: "standard" })).concept,
      capturePlan,
      manifest,
    );
    expect(TechnicalSchema.parse(technical)).toBeTruthy();
    expect(SummarySchema.parse(summary)).toBeTruthy();
    const okCount = manifest.entries.filter((e) => e.status === "ok").length;
    expect(captions.length).toBe(okCount);
    for (const c of captions) expect(CaptionSchema.parse(c)).toBeTruthy();
  });
});
