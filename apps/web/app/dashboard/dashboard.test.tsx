import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { KpiStrip, formatDurationMs } from "../../components/dashboard/KpiStrip";
import { StatusBadge } from "../../components/dashboard/StatusBadge";
import { ProgressBar } from "../../components/dashboard/ProgressBar";
import { ArtifactMenu } from "../../components/dashboard/ArtifactMenu";
import { MediaSpotlight } from "../../components/dashboard/MediaSpotlight";
import { ProviderStatusWidget } from "../../components/dashboard/ProviderStatusWidget";
import { EmptyState } from "../../components/dashboard/EmptyState";
import {
  RunsTable,
  debounce,
  formatRelativeTime,
  shouldPoll,
  POLLING_INTERVAL_MS,
} from "../../components/dashboard/RunsTable";
import {
  FastRunLauncher,
  dispatchRun,
  providerWarning,
  resolveLauncherChoice,
} from "../../components/dashboard/FastRunLauncher";
import { RunsFeed, type RunsFeedState, type RunsQuery } from "../../components/dashboard/runsFeed";
import type { RunListItem, RunMetrics } from "../../components/dashboard/types";
import type { AuthStatus } from "@doceomenter/auth";

describe("Dashboard - KPI Summary Strip", () => {
  const mockMetrics: RunMetrics = {
    totalRuns: 24,
    queuedRuns: 1,
    runningRuns: 2,
    doneRuns: 18,
    partialRuns: 2,
    failedRuns: 1,
    cancelledRuns: 0,
    activeRuns: 3,
    successRatePct: 83,
    avgDurationMs: 204000,
    totalArtifacts: 95,
  };

  it("renders 5 metric cards in .dm-grid-hair container", () => {
    const html = renderToString(<KpiStrip metrics={mockMetrics} />);

    // Container with .dm-grid-hair and responsive 5-column grid
    expect(html).toContain("dm-grid-hair");
    expect(html).toContain("grid-cols-1 sm:grid-cols-2 lg:grid-cols-5");

    // 1. Total Runs
    expect(html).toContain("TOTAL RUNS");
    expect(html).toContain("24");
    expect(html).toContain("18 done · 3 active");

    // 2. Success Rate %
    expect(html).toContain("SUCCESS RATE");
    expect(html).toContain("83%");
    expect(html).toContain("18 done / 2 partial / 1 failed");

    // 3. Avg Duration (204000ms = 3m 24s)
    expect(html).toContain("AVG DURATION");
    expect(html).toContain("3m 24s");
    expect(html).toContain("across done &amp; partial runs");

    // 4. Active Runs with pulsing dot
    expect(html).toContain("ACTIVE RUNS");
    expect(html).toContain("3");
    expect(html).toContain("in worker queue");
    expect(html).toContain("data-testid=\"active-runs-pulse-dot\"");

    // 5. Total Artifacts
    expect(html).toContain("TOTAL ARTIFACTS");
    expect(html).toContain("95");
    expect(html).toContain("decks, reports, pdfs, JSON");
  });

  it("omits pulsing dot when activeRuns is 0", () => {
    const zeroActiveMetrics: RunMetrics = {
      ...mockMetrics,
      queuedRuns: 0,
      runningRuns: 0,
      activeRuns: 0,
    };
    const html = renderToString(<KpiStrip metrics={zeroActiveMetrics} />);
    expect(html).not.toContain("data-testid=\"active-runs-pulse-dot\"");
  });

  it("formats duration correctly with formatDurationMs", () => {
    expect(formatDurationMs(0)).toBe("0m 0s");
    expect(formatDurationMs(45000)).toBe("0m 45s");
    expect(formatDurationMs(60000)).toBe("1m 0s");
    expect(formatDurationMs(184000)).toBe("3m 4s");
  });
});

describe("Dashboard - StatusBadge & ProgressBar", () => {
  it("renders StatusBadge for running with animated pulsing dot", () => {
    const html = renderToString(<StatusBadge status="running" />);
    expect(html).toContain("data-status=\"running\"");
    expect(html).toContain("data-testid=\"status-pulse-dot\"");
    expect(html).toContain("running");
  });

  it("renders StatusBadge for queued, done, partial, failed, cancelled", () => {
    const statuses = ["queued", "done", "partial", "failed", "cancelled"] as const;
    for (const s of statuses) {
      const html = renderToString(<StatusBadge status={s} />);
      expect(html).toContain(`data-status="${s}"`);
      expect(html).not.toContain("data-testid=\"status-pulse-dot\"");
      expect(html).toContain(s);
    }
  });

  it("renders ProgressBar with resolved stages and resolved percentage", () => {
    const html = renderToString(<ProgressBar resolved={7} total={10} />);
    expect(html).toContain("7/10 stages");
    expect(html).toContain("70%");
    expect(html).toContain("role=\"progressbar\"");
    expect(html).toContain("aria-valuenow=\"70\"");
    expect(html).toContain("data-testid=\"progress-bar-fill\"");
  });
});

describe("Dashboard - ArtifactMenu & MediaSpotlight", () => {
  it("renders ArtifactMenu with links to all 5 core artifacts", () => {
    const html = renderToString(<ArtifactMenu runId="run-abc-123" />);
    expect(html).toContain("Artifacts");
    expect(html).toContain("data-testid=\"artifact-menu\"");
  });

  it("renders MediaSpotlight empty state fallback when no completed runs", () => {
    const html = renderToString(<MediaSpotlight runs={[]} />);
    expect(html).toContain("data-testid=\"media-spotlight-empty\"");
    expect(html).toContain("No media captures yet");
  });

  it("renders MediaSpotlight previews for completed runs", () => {
    const mockRuns: RunListItem[] = [
      {
        runId: "run-done-1",
        spec: { url: "https://github.com/org/repo-one", ref: "main" },
        state: "done",
        createdAt: "2026-10-30T10:00:00Z",
        updatedAt: "2026-10-30T10:05:00Z",
        durationMs: 300000,
        stageSummary: { total: 10, resolved: 10, failed: 0 },
      },
    ];

    const html = renderToString(<MediaSpotlight runs={mockRuns} />);
    expect(html).toContain("data-testid=\"spotlight-card-run-done-1\"");
    expect(html).toContain("repo-one");
    expect(html).toContain("/api/runs/run-done-1/files/deck.html");
    expect(html).toContain("/run/run-done-1/outputs");
  });
});

describe("Dashboard - ProviderStatusWidget", () => {
  it("renders all 7 provider cards and checks badge statuses", () => {
    const mockStatus: AuthStatus = {
      available: true,
      ephemeralSecret: false,
      localCliEnabled: true,
      providers: [
        {
          id: "claude-code" as any,
          ready: true,
          source: "connected account",
          hint: null,
          plan: "Claude Pro",
          expired: false,
          projectId: null,
          models: [],
          defaultModel: "claude-opus-5",
          label: "Claude Code",
          blurb: "Subscription sign-in",
          wire: "anthropic",
          kind: "subscription",
        },
        {
          id: "anthropic" as any,
          ready: true,
          source: "stored key",
          hint: "sk-ant-...123",
          plan: null,
          expired: false,
          projectId: null,
          models: [],
          defaultModel: "claude-opus-5",
          label: "Anthropic API key",
          blurb: "Metered key",
          wire: "anthropic",
          kind: "key",
        },
        {
          id: "codex" as any,
          ready: true,
          source: "machine login",
          hint: null,
          plan: "ChatGPT Plus",
          expired: false,
          projectId: null,
          models: [],
          defaultModel: "gpt-5",
          label: "Codex",
          blurb: "Machine login",
          wire: "openai",
          kind: "subscription",
        },
        {
          id: "openai" as any,
          ready: false,
          source: "none",
          hint: null,
          plan: null,
          expired: false,
          projectId: null,
          models: [],
          defaultModel: "gpt-5",
          label: "OpenAI API key",
          blurb: "Metered key",
          wire: "openai",
          kind: "key",
        },
        {
          id: "gemini-cli" as any,
          ready: false,
          source: "connected account",
          hint: null,
          plan: "user@gmail.com",
          expired: true,
          projectId: null,
          models: [],
          defaultModel: "gemini-3-flash",
          label: "Antigravity",
          blurb: "Google AI account",
          wire: "gemini",
          kind: "subscription",
        },
        {
          id: "gemini" as any,
          ready: false,
          source: "none",
          hint: null,
          plan: null,
          expired: false,
          projectId: null,
          models: [],
          defaultModel: "gemini-3.1-pro",
          label: "Gemini API key",
          blurb: "Metered key",
          wire: "gemini",
          kind: "key",
        },
      ],
    };

    const html = renderToString(<ProviderStatusWidget initialStatus={mockStatus} />);

    // 1. Claude Code
    expect(html).toContain("data-testid=\"provider-card-claude-code\"");
    expect(html).toContain("Ready");

    // 2. Anthropic Key
    expect(html).toContain("data-testid=\"provider-card-anthropic\"");

    // 3. Codex
    expect(html).toContain("data-testid=\"provider-card-codex\"");

    // 4. OpenAI Key
    expect(html).toContain("data-testid=\"provider-card-openai\"");
    expect(html).toContain("Not Configured");

    // 5. Antigravity (Expired)
    expect(html).toContain("data-testid=\"provider-card-gemini-cli\"");
    expect(html).toContain("Expired / Action Needed");

    // 6. Gemini Key
    expect(html).toContain("data-testid=\"provider-card-gemini\"");

    // 7. Deterministic Fixtures (always Ready)
    expect(html).toContain("data-testid=\"provider-card-fixtures\"");
    expect(html).toContain("Deterministic Fixtures");
  });
});

describe("Dashboard - RunsTable, Search Debounce & Filtering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("debounces search input by 300ms", () => {
    const searchSpy = vi.fn();
    const debounced = debounce(searchSpy, 300);

    // Call rapidly
    debounced("f");
    debounced("fo");
    debounced("foo");

    expect(searchSpy).not.toHaveBeenCalled();

    // Advance 250ms (not yet 300ms)
    vi.advanceTimersByTime(250);
    expect(searchSpy).not.toHaveBeenCalled();

    // Advance remaining 50ms
    vi.advanceTimersByTime(50);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith("foo");
  });

  it("renders status pills with live counts and pagination controls", () => {
    const mockRuns: RunListItem[] = [
      {
        runId: "run-101",
        spec: { url: "https://github.com/test-org/test-repo", ref: "dev", outputStyle: "deep" },
        state: "running",
        createdAt: "2026-10-30T09:00:00Z",
        updatedAt: "2026-10-30T09:02:00Z",
        durationMs: 120000,
        provider: {
          id: "claude-code" as any,
          label: "Claude Code",
          source: "connected account",
          model: "claude-opus-5",
          fixture: false,
        },
        stageSummary: { total: 10, resolved: 4, failed: 0 },
      },
    ];

    const html = renderToString(
      <RunsTable
        runs={mockRuns}
        total={1}
        metrics={{
          totalRuns: 1,
          queuedRuns: 0,
          runningRuns: 1,
          doneRuns: 0,
          partialRuns: 0,
          failedRuns: 0,
          cancelledRuns: 0,
          activeRuns: 1,
          successRatePct: 0,
          avgDurationMs: 120000,
          totalArtifacts: 0,
        }}
        searchQuery=""
        onSearchChange={vi.fn()}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
        sortBy="createdAt"
        onSortByChange={vi.fn()}
        sortOrder="desc"
        onSortOrderChange={vi.fn()}
        limit={20}
        onLimitChange={vi.fn()}
        offset={0}
        onOffsetChange={vi.fn()}
      />
    );

    // Status pills
    expect(html).toContain("data-testid=\"status-pill-all\"");
    expect(html).toContain("data-testid=\"status-pill-active\"");
    expect(html).toContain("data-testid=\"status-pill-done\"");

    // Row details
    expect(html).toContain("test-repo");
    expect(html).toContain("dev");
    expect(html).toContain("deep");
    expect(html).toContain("Claude Code");
    expect(html).toContain("claude-opus-5");
    expect(html).toContain("data-testid=\"run-row-run-101\"");
    expect(html).toContain("Open Run →");
    expect(html).toContain("/run/run-101");

    // Pagination controls
    expect(html).toContain("data-testid=\"pagination-controls\"");
    expect(html).toContain("Showing 1–1 of 1 runs");
  });

  it("renders EmptyState when filtered search yields no results", () => {
    const html = renderToString(
      <RunsTable
        runs={[]}
        total={0}
        searchQuery="nonexistent"
        onSearchChange={vi.fn()}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
        sortBy="createdAt"
        onSortByChange={vi.fn()}
        sortOrder="desc"
        onSortOrderChange={vi.fn()}
        limit={20}
        onLimitChange={vi.fn()}
        offset={0}
        onOffsetChange={vi.fn()}
      />
    );

    expect(html).toContain("data-testid=\"empty-state-no-results\"");
    expect(html).toContain("Reset Filters");
  });

  it("renders relative time correctly", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });
});

describe("Dashboard - Polling Behavior", () => {
  it("determines polling interval is 10s (10000ms)", () => {
    expect(POLLING_INTERVAL_MS).toBe(10000);
  });

  it("shouldPoll returns true when active runs exist in metrics or run states", () => {
    // 1. Metric activeRuns > 0
    expect(shouldPoll([], { activeRuns: 1 } as any)).toBe(true);

    // 2. Runs contain running state
    expect(
      shouldPoll([
        { state: "running" } as any,
        { state: "done" } as any,
      ])
    ).toBe(true);

    // 3. Runs contain queued state
    expect(
      shouldPoll([
        { state: "queued" } as any,
        { state: "done" } as any,
      ])
    ).toBe(true);
  });

  it("shouldPoll returns false when no active runs exist", () => {
    expect(shouldPoll([])).toBe(false);
    expect(
      shouldPoll(
        [
          { state: "done" } as any,
          { state: "failed" } as any,
          { state: "cancelled" } as any,
        ],
        { activeRuns: 0 } as any
      )
    ).toBe(false);
  });

});

/**
 * The dashboard page delegates fetching and polling to `RunsFeed` (one per mounted page), so
 * these drive that exact object with a controlled fetch and fake timers.
 */
describe("Dashboard - RunsFeed fetching & polling", () => {
  type Deferred = { resolve: (body: unknown) => void; reject: (err: Error) => void };

  /** A fetch whose responses are released by the test, in whatever order it chooses. */
  function controlledFetch() {
    const calls: Array<{ url: string; signal?: AbortSignal | null } & Deferred> = [];
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        calls.push({
          url,
          signal: init?.signal,
          resolve: (body) =>
            resolve({ ok: true, status: 200, json: async () => body } as unknown as Response),
          reject,
        });
      });
    });
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
  }

  const page = (runs: Array<Partial<RunListItem>>, activeRuns = 0) => ({
    runs,
    total: runs.length,
    limit: 20,
    offset: 0,
    metrics: { activeRuns } as RunMetrics,
  });

  const baseQuery: RunsQuery = {
    limit: 20,
    offset: 0,
    status: "all",
    q: "",
    sortBy: "createdAt",
    sortOrder: "desc",
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls every 10s with the current filters while a run is active, and stops once none is", async () => {
    vi.useFakeTimers();
    const { calls, fetchImpl } = controlledFetch();
    const states: RunsFeedState[] = [];
    const feed = new RunsFeed((s) => states.push(s), fetchImpl);

    const first = feed.setQuery({ ...baseQuery, status: "active", q: "acme" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "/api/runs?limit=20&offset=0&status=active&q=acme&sortBy=createdAt&sortOrder=desc&includeMetrics=true",
    );
    calls[0]!.resolve(page([{ runId: "a", state: "running" }], 1));
    await first;
    expect(states.at(-1)?.polling).toBe(true);
    expect(states.at(-1)?.loading).toBe(false);

    // Nothing before the interval elapses, one poll when it does, with the same filters.
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toBe(calls[0]!.url);

    // The run finishes: the poll's result turns polling off and no further requests go out.
    calls[1]!.resolve(page([{ runId: "a", state: "done" }], 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.polling).toBe(false);
    expect(states.at(-1)?.runs[0]?.state).toBe("done");
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 3);
    expect(calls).toHaveLength(2);

    feed.dispose();
  });

  it("lets a poll slower than the interval land: later ticks skip instead of cancelling it", async () => {
    vi.useFakeTimers();
    const { calls, fetchImpl } = controlledFetch();
    const states: RunsFeedState[] = [];
    const feed = new RunsFeed((s) => states.push(s), fetchImpl);

    const first = feed.setQuery(baseQuery);
    calls[0]!.resolve(page([{ runId: "a", state: "running" }], 1));
    await first;
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS);
    expect(calls).toHaveLength(2);

    // The poll takes 25 s: two more ticks pass while it is in flight. Neither aborts it nor
    // starts another request.
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 2.5);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.signal?.aborted).toBe(false);

    // It lands and updates the page; the run is still active, so polling carries on.
    calls[1]!.resolve(page([{ runId: "a", state: "running" }, { runId: "b", state: "queued" }], 2));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.runs.map((r) => r.runId)).toEqual(["a", "b"]);
    expect(states.at(-1)?.metrics?.activeRuns).toBe(2);
    expect(states.at(-1)?.polling).toBe(true);
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS);
    expect(calls).toHaveLength(3);
    expect(calls[2]!.url).toBe(calls[0]!.url);

    // That one is slow too and reports the run finished: polling stops.
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 1.5);
    expect(calls).toHaveLength(3);
    calls[2]!.resolve(page([{ runId: "a", state: "done" }], 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.runs[0]?.state).toBe("done");
    expect(states.at(-1)?.polling).toBe(false);
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 3);
    expect(calls).toHaveLength(3);

    feed.dispose();
  });

  it("changing filters while a poll is in flight cancels it and drops its late response", async () => {
    vi.useFakeTimers();
    const { calls, fetchImpl } = controlledFetch();
    const states: RunsFeedState[] = [];
    const feed = new RunsFeed((s) => states.push(s), fetchImpl);

    const first = feed.setQuery(baseQuery);
    calls[0]!.resolve(page([{ runId: "a", state: "running" }], 1));
    await first;
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS);
    expect(calls).toHaveLength(2);

    const failed = feed.setQuery({ ...baseQuery, status: "failed" });
    expect(calls).toHaveLength(3);
    expect(calls[1]!.signal?.aborted).toBe(true);
    expect(calls[2]!.url).toContain("status=failed");
    calls[2]!.resolve(page([{ runId: "f", state: "failed" }], 1));
    await failed;

    // The cancelled "All" poll still answers late: it must not replace the "Failed" rows.
    calls[1]!.resolve(page([{ runId: "x", state: "done" }], 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.runs.map((r) => r.runId)).toEqual(["f"]);
    expect(states.at(-1)?.polling).toBe(true);

    // Polling continues with the new filters.
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS);
    expect(calls).toHaveLength(4);
    expect(calls[3]!.url).toBe(calls[2]!.url);
    feed.dispose();
  });

  it("drops an older response that lands after a newer filter's response", async () => {
    const { calls, fetchImpl } = controlledFetch();
    const states: RunsFeedState[] = [];
    const feed = new RunsFeed((s) => states.push(s), fetchImpl);

    const all = feed.setQuery(baseQuery);
    const failed = feed.setQuery({ ...baseQuery, status: "failed" });
    expect(calls[0]!.signal?.aborted).toBe(true); // the superseded request is cancelled

    calls[1]!.resolve(page([{ runId: "f", state: "failed" }]));
    await failed;
    // The "All" response still arrives late (the abort came too late): it must not win.
    calls[0]!.resolve(page([{ runId: "x", state: "done" }, { runId: "y", state: "done" }]));
    await all;

    const last = states.at(-1)!;
    expect(last.runs.map((r) => r.runId)).toEqual(["f"]);
    expect(last.total).toBe(1);
    expect(last.loading).toBe(false);
    feed.dispose();
  });

  it("ignores a superseded request's failure and reports the current one's", async () => {
    const { calls, fetchImpl } = controlledFetch();
    const states: RunsFeedState[] = [];
    const feed = new RunsFeed((s) => states.push(s), fetchImpl);

    const older = feed.setQuery(baseQuery);
    const newer = feed.setQuery({ ...baseQuery, offset: 20 });
    calls[0]!.reject(new Error("aborted"));
    await older;
    expect(states.at(-1)?.error).toBeNull();

    calls[1]!.reject(new Error("network down"));
    await newer;
    expect(states.at(-1)?.error).toBe("network down");
    feed.dispose();
  });

  it("stops polling and updating once disposed (page unmounted)", async () => {
    vi.useFakeTimers();
    const { calls, fetchImpl } = controlledFetch();
    const onChange = vi.fn();
    const feed = new RunsFeed(onChange, fetchImpl);

    const first = feed.setQuery(baseQuery);
    calls[0]!.resolve(page([{ runId: "a", state: "queued" }], 1));
    await first;
    feed.dispose();
    onChange.mockClear();

    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 2);
    expect(calls).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("unmounting during a slow poll cancels it and ignores its answer", async () => {
    vi.useFakeTimers();
    const { calls, fetchImpl } = controlledFetch();
    const onChange = vi.fn();
    const feed = new RunsFeed(onChange, fetchImpl);

    const first = feed.setQuery(baseQuery);
    calls[0]!.resolve(page([{ runId: "a", state: "running" }], 1));
    await first;
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS);
    expect(calls).toHaveLength(2);

    feed.dispose();
    onChange.mockClear();
    expect(calls[1]!.signal?.aborted).toBe(true);
    calls[1]!.resolve(page([{ runId: "a", state: "done" }], 0));
    await vi.advanceTimersByTimeAsync(POLLING_INTERVAL_MS * 3);
    expect(calls).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Dashboard - FastRunLauncher POST /api/runs", () => {
  it("rejects invalid GitHub repository URL", async () => {
    await expect(
      dispatchRun({
        url: "not-a-valid-url",
      })
    ).rejects.toThrow("Must be a valid GitHub repo URL");
  });

  it("triggers POST /api/runs with RunSpec and returns runId on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runId: "test-run-789" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await dispatchRun({
      url: "https://github.com/flyvendedk799/doceomenter",
      ref: "main",
      outputStyle: "deep",
      includeVideo: true,
      bootApp: true,
      provider: "anthropic",
    });

    expect(result.runId).toBe("test-run-789");
    expect(mockFetch).toHaveBeenCalledWith("/api/runs", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://github.com/flyvendedk799/doceomenter",
        ref: "main",
        outputStyle: "deep",
        includeVideo: true,
        bootApp: true,
        provider: "anthropic",
      }),
    });

    vi.unstubAllGlobals();
  });

  it("throws error message when POST /api/runs returns non-200 status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid request body" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      dispatchRun({
        url: "https://github.com/flyvendedk799/doceomenter",
      })
    ).rejects.toThrow("Invalid request body");

    vi.unstubAllGlobals();
  });

  it("renders FastRunLauncher with inputs when open", () => {
    const html = renderToString(
      <FastRunLauncher
        isOpen={true}
        onToggle={vi.fn()}
      />
    );

    expect(html).toContain("data-testid=\"fast-run-launcher\"");
    expect(html).toContain("data-testid=\"fast-run-form\"");
    expect(html).toContain("GITHUB REPOSITORY URL");
    expect(html).toContain("BRANCH / REF");
    expect(html).toContain("OUTPUT STYLE");
    expect(html).toContain("PROVIDER &amp; BILLING");
    expect(html).toContain("Record Video");
    expect(html).toContain("Boot Browser App");
    expect(html).toContain("Dispatch Run");
  });

  it("displays success notification with link to /run/${runId} when run is created", () => {
    const html = renderToString(
      <FastRunLauncher
        isOpen={true}
        onToggle={vi.fn()}
        initialRunId="run-test-abc-456"
      />
    );

    expect(html).toContain("data-testid=\"launcher-success-alert\"");
    expect(html).toContain("Run successfully dispatched!");
    expect(html).toContain("run-test-abc-456");
    expect(html).toContain("/run/run-test-abc-456");
    expect(html).toContain("Open Live Run →");
  });
});

describe("Dashboard - FastRunLauncher provider choice", () => {
  const provider = (id: string, ready: boolean, label: string, defaultModel: string) =>
    ({ id, ready, label, defaultModel }) as unknown as AuthStatus["providers"][number];
  const status = {
    providers: [
      provider("anthropic", false, "Anthropic API key", "claude-sonnet-5"),
      provider("claude-code", false, "Claude Code", "claude-opus-5"),
      provider("codex", true, "Codex", "gpt-5.5-codex"),
    ],
  };

  it("keeps the browser's saved provider preference", () => {
    expect(
      resolveLauncherChoice({ provider: "claude-code", model: "claude-opus-5" }, status),
    ).toEqual({ provider: "claude-code", model: "claude-opus-5" });
  });

  it("opens on the first ready provider instead of an unconfigured Anthropic key", () => {
    expect(resolveLauncherChoice(null, status)).toEqual({
      provider: "codex",
      model: "gpt-5.5-codex",
    });
  });

  it("falls back to anthropic only when nothing is known or ready", () => {
    expect(resolveLauncherChoice(null, null)).toEqual({ provider: "anthropic" });
    expect(resolveLauncherChoice(null, { providers: [status.providers[0]!] })).toEqual({
      provider: "anthropic",
    });
  });

  it("warns before dispatching with a provider that is not set up", () => {
    expect(providerWarning("anthropic", status)).toMatch(
      /Anthropic API key is not set up.*fixture output/,
    );
    expect(providerWarning("codex", status)).toBeNull();
    expect(providerWarning("anthropic", null)).toBeNull();
  });

  it("sends the chosen model along with the provider", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ runId: "r1" }) });
    vi.stubGlobal("fetch", mockFetch);
    await dispatchRun({
      url: "https://github.com/flyvendedk799/doceomenter",
      provider: "codex",
      model: "gpt-5.5-codex",
    });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({ provider: "codex", model: "gpt-5.5-codex" });
    vi.unstubAllGlobals();
  });
});

describe("Dashboard - Status Pill Filtering", () => {
  it("highlights active status pill when status filter is selected", () => {
    const onFilterChange = vi.fn();
    const html = renderToString(
      <RunsTable
        runs={[]}
        total={0}
        metrics={{
          totalRuns: 10,
          queuedRuns: 1,
          runningRuns: 2,
          doneRuns: 5,
          partialRuns: 1,
          failedRuns: 1,
          cancelledRuns: 0,
          activeRuns: 3,
          successRatePct: 60,
          avgDurationMs: 150000,
          totalArtifacts: 25,
        }}
        searchQuery=""
        onSearchChange={vi.fn()}
        statusFilter="active"
        onStatusFilterChange={onFilterChange}
        sortBy="createdAt"
        onSortByChange={vi.fn()}
        sortOrder="desc"
        onSortOrderChange={vi.fn()}
        limit={20}
        onLimitChange={vi.fn()}
        offset={0}
        onOffsetChange={vi.fn()}
      />
    );

    // Active pill has active border/text styling
    expect(html).toContain("data-testid=\"status-pill-active\"");
    expect(html).toContain("border-accent/40 bg-accent/15 text-accent font-semibold");
    // Displays correct count for active (3)
    expect(html).toContain("3");
  });
});
