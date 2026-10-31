import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

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
import { GET as GET_RUN } from "./[id]/route.js";
import { getStore } from "../../../lib/server.js";
import { initialRunState } from "@doceomenter/worker";
import { ACCOUNT_COOKIE, getAuthRuntime, newAccountId } from "@doceomenter/auth";
import type { ListRunsResponse, RunSpec, RunState } from "@doceomenter/shared";

/** A browser's signed account cookie, exactly as the app would have issued it. */
async function accountCookie(accountId: string): Promise<string> {
  const runtime = await getAuthRuntime();
  return `${ACCOUNT_COOKIE}=${encodeURIComponent(runtime.session.sign(accountId))}`;
}

describe("/api/runs", () => {
  const store = getStore();
  const ownerId = newAccountId();
  let ownerCookie = "";
  const owned = (runId: string, spec: RunSpec): RunState => ({
    ...initialRunState(runId, spec),
    ownerAccountId: ownerId,
  });
  const asOwner = (url: string) => new Request(url, { headers: { cookie: ownerCookie } });

  beforeAll(async () => {
    ownerCookie = await accountCookie(ownerId);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/runs", () => {
    it("returns 200 with runs and metrics", async () => {
      // Seed runs in the store
      const run1 = owned("111122223333", { url: "https://github.com/facebook/react" });
      run1.createdAt = "2026-01-01T00:00:00.000Z";
      run1.updatedAt = "2026-01-01T00:01:00.000Z";
      run1.state = "done";
      run1.artifacts = { reportMd: "report.md" };

      const run2 = owned("444455556666", { url: "https://github.com/vercel/next.js" });
      run2.createdAt = "2026-01-01T00:02:00.000Z";
      run2.updatedAt = "2026-01-01T00:03:00.000Z";
      run2.state = "running";

      await store.write(run1.runId, run1);
      await store.write(run2.runId, run2);

      const req = asOwner("http://localhost:3000/api/runs");
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
      // Seed matching and nonmatching runs with distinct query and durations
      const matchShort = owned("777700000001", {
        url: "https://github.com/filter-test-org/match-alpha",
      });
      matchShort.state = "queued";
      matchShort.createdAt = "2026-01-01T00:00:00.000Z";
      matchShort.updatedAt = "2026-01-01T00:00:10.000Z"; // duration: 10s

      const matchLong = owned("777700000002", {
        url: "https://github.com/filter-test-org/match-beta",
      });
      matchLong.state = "running";
      matchLong.createdAt = "2026-01-01T00:00:00.000Z";
      matchLong.updatedAt = "2026-01-01T00:00:30.000Z"; // duration: 30s

      const nonMatchStatus = owned("777700000003", {
        url: "https://github.com/filter-test-org/match-gamma",
      });
      nonMatchStatus.state = "done";
      nonMatchStatus.createdAt = "2026-01-01T00:00:00.000Z";
      nonMatchStatus.updatedAt = "2026-01-01T00:00:20.000Z";

      const nonMatchQuery = owned("777700000004", {
        url: "https://github.com/other-org/unrelated",
      });
      nonMatchQuery.state = "running";
      nonMatchQuery.createdAt = "2026-01-01T00:00:00.000Z";
      nonMatchQuery.updatedAt = "2026-01-01T00:00:20.000Z";

      await Promise.all([
        store.write(matchShort.runId, matchShort),
        store.write(matchLong.runId, matchLong),
        store.write(nonMatchStatus.runId, nonMatchStatus),
        store.write(nonMatchQuery.runId, nonMatchQuery),
      ]);

      const req = asOwner(
        "http://localhost:3000/api/runs?limit=999&offset=-5&status=active&q=filter-test-org&sortBy=duration&sortOrder=asc",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = (await res.json()) as ListRunsResponse;

      expect(data.limit).toBe(100); // clamped to max 100
      expect(data.offset).toBe(0); // clamped to >= 0
      expect(data.runs.length).toBe(2);
      expect(data.runs.map((r) => r.runId)).toEqual(["777700000001", "777700000002"]);
      expect(data.runs[0]?.durationMs).toBe(10_000);
      expect(data.runs[1]?.durationMs).toBe(30_000);
      expect(data.runs[0]?.durationMs).toBeLessThanOrEqual(data.runs[1]?.durationMs!);
      expect(data.runs.every((r) => r.state === "queued" || r.state === "running")).toBe(true);
      expect(data.runs.every((r) => r.spec.url.includes("filter-test-org"))).toBe(true);
    });

    it("handles includeMetrics=false query param", async () => {
      const req = asOwner("http://localhost:3000/api/runs?includeMetrics=false");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = (await res.json()) as ListRunsResponse;
      expect(data.metrics).toBeUndefined();
    });

    it("lists nothing for a caller without an account cookie, and mints no cookie", async () => {
      await store.write("abab00000001", owned("abab00000001", { url: "https://github.com/acme/private" }));

      const res = await GET(new Request("http://localhost:3000/api/runs"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as ListRunsResponse;
      expect(data.runs).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.metrics?.totalRuns).toBe(0);
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    it("never lists or counts another browser's runs", async () => {
      await store.write("abab00000002", owned("abab00000002", { url: "https://github.com/acme/mine" }));
      const strangerRun = {
        ...initialRunState("abab00000003", { url: "https://github.com/acme/theirs" }),
        ownerAccountId: newAccountId(),
      };
      await store.write(strangerRun.runId, strangerRun);

      const res = await GET(asOwner("http://localhost:3000/api/runs?limit=100"));
      const data = (await res.json()) as ListRunsResponse;
      const ids = data.runs.map((r) => r.runId);
      expect(ids).toContain("abab00000002");
      expect(ids).not.toContain("abab00000003");
      expect(data.metrics?.totalRuns).toBe(data.total);

      const stranger = await GET(
        new Request("http://localhost:3000/api/runs?limit=100", {
          headers: { cookie: await accountCookie(strangerRun.ownerAccountId) },
        }),
      );
      const strangerData = (await stranger.json()) as ListRunsResponse;
      expect(strangerData.runs.map((r) => r.runId)).toEqual(["abab00000003"]);
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

    it("ties the run to the caller's account: listed for them, owner id never returned", async () => {
      const res = await POST(
        new Request("http://localhost:3000/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: ownerCookie },
          body: JSON.stringify({ url: "https://github.com/flyvendedk799/owned-run" }),
        }),
      );
      expect(res.status).toBe(200);
      const { runId } = (await res.json()) as { runId: string };
      expect((await store.read(runId))?.ownerAccountId).toBe(ownerId);

      const listed = (await (
        await GET(asOwner("http://localhost:3000/api/runs?limit=100&q=owned-run"))
      ).json()) as ListRunsResponse;
      expect(listed.runs.map((r) => r.runId)).toEqual([runId]);
      expect(listed.runs[0]).not.toHaveProperty("ownerAccountId");

      const single = await GET_RUN(new Request(`http://localhost:3000/api/runs/${runId}`), {
        params: { id: runId },
      });
      const body = (await single.json()) as RunState;
      expect(body.runId).toBe(runId);
      expect(body).not.toHaveProperty("ownerAccountId");
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
