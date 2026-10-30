import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock server-only so Next.js server components can be tested under Vitest
vi.mock("server-only", () => ({}));

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set a clean temp directory for runs before importing server modules
const testDataRoot = mkdtempSync(join(tmpdir(), "doceomenter-web-store-"));
process.env.DATA_ROOT = testDataRoot;
process.env.DOCEOMENTER_INPROCESS = "1";

vi.mock("@doceomenter/worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@doceomenter/worker")>();
  return {
    ...actual,
    runPipeline: vi.fn().mockResolvedValue({} as any),
  };
});

// Import route handlers after configuring env
import { GET, POST } from "./route.js";
import { getStore } from "../../../lib/server.js";
import { initialRunState } from "@doceomenter/worker";
import type { ListRunsResponse } from "@doceomenter/shared";

describe("/api/runs", () => {
  const store = getStore();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/runs", () => {
    it("returns 200 with runs and metrics", async () => {
      // Seed runs in the store
      const run1 = initialRunState("111122223333", { url: "https://github.com/facebook/react" });
      run1.createdAt = "2026-01-01T00:00:00.000Z";
      run1.updatedAt = "2026-01-01T00:01:00.000Z";
      run1.state = "done";
      run1.artifacts = { reportMd: "report.md" };

      const run2 = initialRunState("444455556666", { url: "https://github.com/vercel/next.js" });
      run2.createdAt = "2026-01-01T00:02:00.000Z";
      run2.updatedAt = "2026-01-01T00:03:00.000Z";
      run2.state = "running";

      await store.write(run1.runId, run1);
      await store.write(run2.runId, run2);

      const req = new Request("http://localhost:3000/api/runs");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = (await res.json()) as ListRunsResponse;

      expect(data).toHaveProperty("runs");
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("metrics");
      expect(data.runs.length).toBeGreaterThanOrEqual(2);

      const found1 = data.runs.find((r) => r.runId === "111122223333");
      expect(found1).toBeDefined();
      expect(found1?.durationMs).toBe(60_000);
      expect(found1?.artifacts?.reportMd).toBe("report.md");

      expect(data.metrics).toBeDefined();
      expect(data.metrics?.totalRuns).toBeGreaterThanOrEqual(2);
      expect(data.metrics?.runningRuns).toBeGreaterThanOrEqual(1);
    });

    it("parses query parameters and clamps limit and offset", async () => {
      const req = new Request(
        "http://localhost:3000/api/runs?limit=999&offset=-5&status=active&q=next.js&sortBy=duration&sortOrder=asc",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = (await res.json()) as ListRunsResponse;

      expect(data.limit).toBe(100); // clamped to max 100
      expect(data.offset).toBe(0); // clamped to >= 0
      expect(data.runs.every((r) => r.state === "queued" || r.state === "running")).toBe(true);
      expect(data.runs.every((r) => r.spec.url.includes("next.js"))).toBe(true);
    });

    it("handles includeMetrics=false query param", async () => {
      const req = new Request("http://localhost:3000/api/runs?includeMetrics=false");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = (await res.json()) as ListRunsResponse;
      expect(data.metrics).toBeUndefined();
    });
  });

  describe("POST /api/runs", () => {
    it("creates a new run and returns 200 with runId and sets account cookie", async () => {
      const req = new Request("http://localhost:3000/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://github.com/flyvendedk799/doceomenter",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const data = (await res.json()) as { runId: string };
      expect(data.runId).toMatch(/^[0-9a-f]{12}$/);

      // Verify the run was written to the store
      const persisted = await store.read(data.runId);
      expect(persisted).toBeDefined();
      expect(persisted?.runId).toBe(data.runId);
      expect(persisted?.spec.url).toBe("https://github.com/flyvendedk799/doceomenter");
      expect(persisted?.state).toBe("queued");

      // Verify account cookie is set on response
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
    });

    it("validates RunSpecSchema and returns 400 for invalid body", async () => {
      const req = new Request("http://localhost:3000/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "invalid-url",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const data = (await res.json()) as { error: string; fields?: string[] };
      expect(data.error).toBe("Invalid request body");
      expect(data.fields).toContain("url");
    });

    it("enforces MAX_INPROCESS_RUNS limit when server is busy", async () => {
      let resolvePipeline: (value?: any) => void = () => {};
      const deferred = new Promise<any>((resolve) => {
        resolvePipeline = resolve;
      });
      const { runPipeline } = await import("@doceomenter/worker");
      vi.mocked(runPipeline).mockImplementation(() => deferred);

      const makeReq = () =>
        new Request("http://localhost:3000/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://github.com/flyvendedk799/doceomenter" }),
        });

      // Fire 3 runs to reach MAX_INPROCESS_RUNS = 3
      const res1 = await POST(makeReq());
      const res2 = await POST(makeReq());
      const res3 = await POST(makeReq());
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      // The 4th run should receive 429
      const res4 = await POST(makeReq());
      expect(res4.status).toBe(429);
      const data4 = (await res4.json()) as { error: string };
      expect(data4.error).toMatch(/Server busy/);

      // Resolve pipelines to clean up
      resolvePipeline();
    });
  });
});
