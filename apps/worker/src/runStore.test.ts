import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore, initialRunState } from "./runStore.js";
import type { RunSpec } from "@doceomenter/shared";

function tmpStore(): RunStore {
  return new RunStore(mkdtempSync(join(tmpdir(), "doceomenter-store-")));
}

const spec: RunSpec = { url: "https://github.com/owner/repo", apiKey: "sk-secret" };

describe("RunStore", () => {
  it("round-trips state via an atomic write", async () => {
    const store = tmpStore();
    const state = initialRunState("aabbccddeeff", spec);
    await store.write("aabbccddeeff", state);
    const read = await store.read("aabbccddeeff");
    expect(read?.runId).toBe("aabbccddeeff");
    expect(read?.state).toBe("queued");
  });

  it("never persists the BYOK apiKey", async () => {
    const store = tmpStore();
    await store.write("aabbccddeeff", initialRunState("aabbccddeeff", spec));
    const read = await store.read("aabbccddeeff");
    expect(read?.spec.apiKey).toBeUndefined();
    expect(read?.spec.url).toBe("https://github.com/owner/repo");
  });

  it("returns undefined for a corrupt state file instead of throwing", async () => {
    const store = tmpStore();
    await store.write("aabbccddeeff", initialRunState("aabbccddeeff", spec));
    // Truncate/corrupt the persisted file (simulating a crash mid-write).
    writeFileSync(join(store.runDir("aabbccddeeff"), "state.json"), "{ not json");
    await expect(store.read("aabbccddeeff")).resolves.toBeUndefined();
  });

  it("returns undefined for an unknown run", async () => {
    const store = tmpStore();
    await expect(store.read("ffffffffffff")).resolves.toBeUndefined();
  });

  describe("list", () => {
    it("returns empty result if root does not exist", async () => {
      const store = new RunStore(join(tmpdir(), `nonexistent-store-${Date.now()}`));
      const result = await store.list();
      expect(result.runs).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.metrics?.totalRuns).toBe(0);
      expect(result.metrics?.successRatePct).toBe(0);
    });

    it("lists valid runs from directory and computes stageSummary and durationMs", async () => {
      const store = tmpStore();
      const run1 = initialRunState("111111111111", { url: "https://github.com/owner/alpha" });
      run1.createdAt = "2026-01-01T00:00:00.000Z";
      run1.updatedAt = "2026-01-01T00:01:00.000Z";
      run1.state = "running";
      run1.stages = [
        { name: "analyze", status: "done" },
        { name: "plan", status: "running" },
        { name: "boot", status: "pending" },
      ];

      const run2 = initialRunState("222222222222", { url: "https://github.com/owner/beta" });
      run2.createdAt = "2026-01-01T00:02:00.000Z";
      run2.updatedAt = "2026-01-01T00:04:00.000Z";
      run2.state = "done";
      run2.stages = [
        { name: "analyze", status: "done" },
        { name: "plan", status: "done" },
        { name: "boot", status: "degraded" },
        { name: "capture", status: "skipped" },
        { name: "evaluate", status: "failed" },
      ];
      run2.artifacts = {
        reportMd: "report.md",
        deckHtml: "deck.html",
      };

      await store.write("111111111111", run1);
      await store.write("222222222222", run2);

      const result = await store.list();
      expect(result.total).toBe(2);
      expect(result.runs.length).toBe(2);

      const item1 = result.runs.find((r) => r.runId === "111111111111")!;
      expect(item1.durationMs).toBe(60_000);
      expect(item1.stageSummary).toEqual({
        total: 3,
        resolved: 1,
        failed: 0,
        current: "plan",
      });

      const item2 = result.runs.find((r) => r.runId === "222222222222")!;
      expect(item2.durationMs).toBe(120_000);
      expect(item2.stageSummary).toEqual({
        total: 5,
        resolved: 4, // done (2) + degraded (1) + skipped (1)
        failed: 1,
        current: "capture", // last resolved stage since none is running
      });
      expect(item2.artifacts?.reportMd).toBe("report.md");
    });

    it("safely skips corrupt state.json and non-runId directories without throwing", async () => {
      const store = tmpStore();
      const valid = initialRunState("333333333333", spec);
      await store.write("333333333333", valid);

      // Create a corrupt run directory with invalid syntax
      const corruptDir = await store.ensure("444444444444");
      writeFileSync(join(corruptDir, "state.json"), "{ invalid json");

      // Create a directory that doesn't match 12-hex regex
      const nonHexDir = join(store.runDir("not-a-run-id"));
      await store.ensure("not-a-run-id");
      writeFileSync(join(nonHexDir, "state.json"), JSON.stringify(valid));

      // Create a run directory without state.json
      await store.ensure("555555555555");

      // Create a run directory with state.json containing "null"
      const nullDir = await store.ensure("666666666666");
      writeFileSync(join(nullDir, "state.json"), "null");

      // Create a run directory with empty object {}
      const emptyObjDir = await store.ensure("777777777777");
      writeFileSync(join(emptyObjDir, "state.json"), "{}");

      // Create a run directory with invalid non-array stages
      const invalidStagesDir = await store.ensure("888888888888");
      writeFileSync(
        join(invalidStagesDir, "state.json"),
        JSON.stringify({
          runId: "888888888888",
          spec: { url: "https://github.com/owner/repo" },
          state: "done",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
          stages: "not-an-array",
        }),
      );

      // Verify read() safely returns undefined for all corrupt shapes
      await expect(store.read("444444444444")).resolves.toBeUndefined();
      await expect(store.read("666666666666")).resolves.toBeUndefined();
      await expect(store.read("777777777777")).resolves.toBeUndefined();
      await expect(store.read("888888888888")).resolves.toBeUndefined();

      // Verify list() skips all invalid/corrupt runs and returns only the valid one
      const result = await store.list();
      expect(result.total).toBe(1);
      expect(result.runs[0]?.runId).toBe("333333333333");
    });

    it("filters by status including active and specific statuses", async () => {
      const store = tmpStore();
      const rQueued = initialRunState("100000000001", spec);
      rQueued.state = "queued";
      const rRunning = initialRunState("100000000002", spec);
      rRunning.state = "running";
      const rDone = initialRunState("100000000003", spec);
      rDone.state = "done";
      const rFailed = initialRunState("100000000004", spec);
      rFailed.state = "failed";
      const rPartial = initialRunState("100000000005", spec);
      rPartial.state = "partial";
      const rCancelled = initialRunState("100000000006", spec);
      rCancelled.state = "cancelled";

      await Promise.all([
        store.write(rQueued.runId, rQueued),
        store.write(rRunning.runId, rRunning),
        store.write(rDone.runId, rDone),
        store.write(rFailed.runId, rFailed),
        store.write(rPartial.runId, rPartial),
        store.write(rCancelled.runId, rCancelled),
      ]);

      const all = await store.list({ status: "all" });
      expect(all.total).toBe(6);

      const active = await store.list({ status: "active" });
      expect(active.total).toBe(2);
      expect(active.runs.map((r) => r.state).sort()).toEqual(["queued", "running"]);

      const done = await store.list({ status: "done" });
      expect(done.total).toBe(1);
      expect(done.runs[0]?.state).toBe("done");

      const partial = await store.list({ status: "partial" });
      expect(partial.total).toBe(1);
      expect(partial.runs[0]?.state).toBe("partial");

      const failed = await store.list({ status: "failed" });
      expect(failed.total).toBe(1);
      expect(failed.runs[0]?.state).toBe("failed");

      const cancelled = await store.list({ status: "cancelled" });
      expect(cancelled.total).toBe(1);
      expect(cancelled.runs[0]?.state).toBe("cancelled");
    });

    it("filters by search query q matching url or owner/repo case-insensitively", async () => {
      const store = tmpStore();
      const r1 = initialRunState("200000000001", { url: "https://github.com/facebook/react" });
      const r2 = initialRunState("200000000002", { url: "https://github.com/vercel/next.js" });
      const r3 = initialRunState("200000000003", { url: "https://github.com/facebook/jest" });

      await Promise.all([
        store.write(r1.runId, r1),
        store.write(r2.runId, r2),
        store.write(r3.runId, r3),
      ]);

      const resOwner = await store.list({ q: "FACEBOOK" });
      expect(resOwner.total).toBe(2);
      expect(resOwner.runs.map((r) => r.runId).sort()).toEqual(["200000000001", "200000000003"]);

      const resRepo = await store.list({ q: "next.js" });
      expect(resRepo.total).toBe(1);
      expect(resRepo.runs[0]?.runId).toBe("200000000002");

      const resSub = await store.list({ q: "github.com/facebook/react" });
      expect(resSub.total).toBe(1);
      expect(resSub.runs[0]?.runId).toBe("200000000001");
    });

    it("sorts by createdAt, updatedAt, duration (asc and desc)", async () => {
      const store = tmpStore();
      const r1 = initialRunState("300000000001", spec);
      r1.createdAt = "2026-01-01T10:00:00.000Z";
      r1.updatedAt = "2026-01-01T10:01:00.000Z"; // duration: 60s

      const r2 = initialRunState("300000000002", spec);
      r2.createdAt = "2026-01-01T11:00:00.000Z";
      r2.updatedAt = "2026-01-01T11:05:00.000Z"; // duration: 300s

      const r3 = initialRunState("300000000003", spec);
      r3.createdAt = "2026-01-01T12:00:00.000Z";
      r3.updatedAt = "2026-01-01T12:02:00.000Z"; // duration: 120s

      await Promise.all([
        store.write(r1.runId, r1),
        store.write(r2.runId, r2),
        store.write(r3.runId, r3),
      ]);

      // createdAt desc (default)
      const sortCreatedDesc = await store.list({ sortBy: "createdAt", sortOrder: "desc" });
      expect(sortCreatedDesc.runs.map((r) => r.runId)).toEqual([
        "300000000003",
        "300000000002",
        "300000000001",
      ]);

      // createdAt asc
      const sortCreatedAsc = await store.list({ sortBy: "createdAt", sortOrder: "asc" });
      expect(sortCreatedAsc.runs.map((r) => r.runId)).toEqual([
        "300000000001",
        "300000000002",
        "300000000003",
      ]);

      // updatedAt asc
      const sortUpdatedAsc = await store.list({ sortBy: "updatedAt", sortOrder: "asc" });
      expect(sortUpdatedAsc.runs.map((r) => r.runId)).toEqual([
        "300000000001",
        "300000000002",
        "300000000003",
      ]);

      // duration desc: r2 (300s), r3 (120s), r1 (60s)
      const sortDurationDesc = await store.list({ sortBy: "duration", sortOrder: "desc" });
      expect(sortDurationDesc.runs.map((r) => r.runId)).toEqual([
        "300000000002",
        "300000000003",
        "300000000001",
      ]);

      // duration asc: r1 (60s), r3 (120s), r2 (300s)
      const sortDurationAsc = await store.list({ sortBy: "duration", sortOrder: "asc" });
      expect(sortDurationAsc.runs.map((r) => r.runId)).toEqual([
        "300000000001",
        "300000000003",
        "300000000002",
      ]);
    });

    it("paginates with offset and limit", async () => {
      const store = tmpStore();
      for (let i = 1; i <= 5; i++) {
        const id = `40000000000${i}`;
        const run = initialRunState(id, spec);
        run.createdAt = `2026-01-0${i}T00:00:00.000Z`;
        await store.write(id, run);
      }

      // Sort desc by createdAt -> ids: 5, 4, 3, 2, 1
      const page1 = await store.list({ offset: 0, limit: 2 });
      expect(page1.total).toBe(5);
      expect(page1.limit).toBe(2);
      expect(page1.offset).toBe(0);
      expect(page1.runs.map((r) => r.runId)).toEqual(["400000000005", "400000000004"]);

      const page2 = await store.list({ offset: 2, limit: 2 });
      expect(page2.total).toBe(5);
      expect(page2.runs.map((r) => r.runId)).toEqual(["400000000003", "400000000002"]);

      const page3 = await store.list({ offset: 4, limit: 2 });
      expect(page3.total).toBe(5);
      expect(page3.runs.map((r) => r.runId)).toEqual(["400000000001"]);
    });

    it("accurately calculates aggregate RunMetrics across all runs", async () => {
      const store = tmpStore();

      // 1 queued
      const rQueued = initialRunState("500000000001", spec);
      rQueued.state = "queued";

      // 1 running
      const rRunning = initialRunState("500000000002", spec);
      rRunning.state = "running";

      // 2 done (duration 10s and 30s)
      const rDone1 = initialRunState("500000000003", spec);
      rDone1.state = "done";
      rDone1.createdAt = "2026-01-01T00:00:00.000Z";
      rDone1.updatedAt = "2026-01-01T00:00:10.000Z"; // 10,000ms
      rDone1.artifacts = { reportMd: "a.md", deckHtml: "a.html", deckPdf: "a.pdf" };

      const rDone2 = initialRunState("500000000004", spec);
      rDone2.state = "done";
      rDone2.createdAt = "2026-01-01T00:00:00.000Z";
      rDone2.updatedAt = "2026-01-01T00:00:30.000Z"; // 30,000ms
      rDone2.artifacts = { caseStudyJson: "cs.json", qualityJson: "q.json", zip: "a.zip" };

      // 1 partial (duration 20s)
      const rPartial = initialRunState("500000000005", spec);
      rPartial.state = "partial";
      rPartial.createdAt = "2026-01-01T00:00:00.000Z";
      rPartial.updatedAt = "2026-01-01T00:00:20.000Z"; // 20,000ms

      // 1 failed
      const rFailed = initialRunState("500000000006", spec);
      rFailed.state = "failed";

      // 1 cancelled
      const rCancelled = initialRunState("500000000007", spec);
      rCancelled.state = "cancelled";

      await Promise.all([
        store.write(rQueued.runId, rQueued),
        store.write(rRunning.runId, rRunning),
        store.write(rDone1.runId, rDone1),
        store.write(rDone2.runId, rDone2),
        store.write(rPartial.runId, rPartial),
        store.write(rFailed.runId, rFailed),
        store.write(rCancelled.runId, rCancelled),
      ]);

      const result = await store.list({ status: "done" }); // even when filtered by status
      expect(result.runs.length).toBe(2);
      expect(result.total).toBe(2);

      const metrics = result.metrics!;
      expect(metrics.totalRuns).toBe(7);
      expect(metrics.queuedRuns).toBe(1);
      expect(metrics.runningRuns).toBe(1);
      expect(metrics.doneRuns).toBe(2);
      expect(metrics.partialRuns).toBe(1);
      expect(metrics.failedRuns).toBe(1);
      expect(metrics.cancelledRuns).toBe(1);
      expect(metrics.activeRuns).toBe(2); // queued + running

      // totalTerminal = done(2) + partial(1) + failed(1) = 4
      // successRatePct = Math.round((2 / 4) * 1000) / 10 = 50.0
      expect(metrics.successRatePct).toBe(50);

      // avgDurationMs for done + partial: (10,000 + 30,000 + 20,000) / 3 = 20,000ms
      expect(metrics.avgDurationMs).toBe(20000);

      // totalArtifacts: 3 (from rDone1) + 3 (from rDone2) = 6
      expect(metrics.totalArtifacts).toBe(6);
    });

    it("respects includeMetrics = false", async () => {
      const store = tmpStore();
      const run = initialRunState("600000000001", spec);
      await store.write(run.runId, run);

      const result = await store.list({ includeMetrics: false });
      expect(result.metrics).toBeUndefined();
    });

    it("matches the search query against the branch/ref alone", async () => {
      const store = tmpStore();
      const onBranch = initialRunState("700000000001", {
        url: "https://github.com/owner/alpha",
        ref: "release-dashboard",
      });
      const onMain = initialRunState("700000000002", {
        url: "https://github.com/owner/beta",
        ref: "main",
      });
      await store.write(onBranch.runId, onBranch);
      await store.write(onMain.runId, onMain);

      const result = await store.list({ q: "Release-Dash" });
      expect(result.runs.map((r) => r.runId)).toEqual(["700000000001"]);
      expect(result.total).toBe(1);
    });

    it("scopes runs and metrics to ownerAccountId, and lists nothing for a null owner", async () => {
      const store = tmpStore();
      const mine = { ...initialRunState("800000000001", spec), ownerAccountId: "acct-mine" };
      mine.state = "done";
      const theirs = { ...initialRunState("800000000002", spec), ownerAccountId: "acct-theirs" };
      theirs.state = "failed";
      const legacy = initialRunState("800000000003", spec); // no owner recorded
      await store.write(mine.runId, mine);
      await store.write(theirs.runId, theirs);
      await store.write(legacy.runId, legacy);

      const own = await store.list({ ownerAccountId: "acct-mine" });
      expect(own.runs.map((r) => r.runId)).toEqual(["800000000001"]);
      expect(own.metrics?.totalRuns).toBe(1);
      expect(own.metrics?.failedRuns).toBe(0);
      // The owner id is a server-side scoping key and never part of a list row.
      expect(own.runs[0]).not.toHaveProperty("ownerAccountId");

      const anonymous = await store.list({ ownerAccountId: null });
      expect(anonymous.runs).toEqual([]);
      expect(anonymous.metrics?.totalRuns).toBe(0);

      const unscoped = await store.list();
      expect(unscoped.total).toBe(3);
    });

    it("re-reads only runs whose state changed since the last listing", async () => {
      const store = tmpStore();
      const a = initialRunState("900000000001", spec);
      const b = initialRunState("900000000002", spec);
      await store.write(a.runId, a);
      await store.write(b.runId, b);

      const readSpy = vi.spyOn(store, "read");
      await store.list();
      expect(readSpy).toHaveBeenCalledTimes(2);

      readSpy.mockClear();
      await store.list({ limit: 1 });
      expect(readSpy).not.toHaveBeenCalled();

      // A write through the store invalidates that run only.
      a.state = "running";
      await store.write(a.runId, a);
      readSpy.mockClear();
      const afterWrite = await store.list();
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(readSpy).toHaveBeenCalledWith("900000000001");
      expect(afterWrite.runs.find((r) => r.runId === a.runId)?.state).toBe("running");

      // A write from another process (straight to disk) is caught by the size/mtime check.
      const external = { ...b, state: "failed" as const, error: "worker crashed while booting" };
      writeFileSync(join(store.runDir(b.runId), "state.json"), JSON.stringify(external));
      readSpy.mockClear();
      const afterExternal = await store.list();
      expect(readSpy).toHaveBeenCalledWith("900000000002");
      expect(afterExternal.runs.find((r) => r.runId === b.runId)?.state).toBe("failed");
    });
  });
});
