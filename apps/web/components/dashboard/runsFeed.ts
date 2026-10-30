import type { ListRunsResponse, RunListItem, RunMetrics } from "./types";
import { POLLING_INTERVAL_MS, shouldPoll } from "./RunsTable";

export type RunsQuery = {
  limit: number;
  offset: number;
  status: "all" | "active" | "done" | "partial" | "failed";
  q: string;
  sortBy: "createdAt" | "updatedAt" | "duration";
  sortOrder: "asc" | "desc";
};

export type RunsFeedState = {
  runs: RunListItem[];
  total: number;
  metrics: RunMetrics | null;
  loading: boolean;
  error: string | null;
  /** True while the feed is re-fetching on an interval because some run is still active. */
  polling: boolean;
};

export const INITIAL_RUNS_FEED_STATE: RunsFeedState = {
  runs: [],
  total: 0,
  metrics: null,
  loading: true,
  error: null,
  polling: false,
};

export function runsUrl(query: RunsQuery): string {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  params.set("offset", String(query.offset));
  if (query.status !== "all") params.set("status", query.status);
  if (query.q.trim()) params.set("q", query.q.trim());
  params.set("sortBy", query.sortBy);
  params.set("sortOrder", query.sortOrder);
  params.set("includeMetrics", "true");
  return `/api/runs?${params.toString()}`;
}

type Timers = {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
};

/**
 * The dashboard's run list: fetches for the current controls, polls while any run is active,
 * and stops once none is.
 *
 * Only the newest request may update the page. Each request aborts the one before it and
 * carries a sequence number, so a slow poll for "All" that lands after a request for "Failed"
 * is dropped instead of replacing the rows while "Failed" stays selected.
 */
export class RunsFeed {
  private query: RunsQuery | null = null;
  private seq = 0;
  private inflight: AbortController | null = null;
  private timer: unknown = null;
  private disposed = false;
  private state: RunsFeedState = INITIAL_RUNS_FEED_STATE;

  constructor(
    private readonly onChange: (state: RunsFeedState) => void,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly intervalMs: number = POLLING_INTERVAL_MS,
    private readonly timers: Timers = {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    },
  ) {}

  /** Load for new controls (or reload the same ones). Shows the loading state. */
  setQuery(query: RunsQuery): Promise<void> {
    this.query = query;
    return this.load(false);
  }

  dispose(): void {
    this.disposed = true;
    this.inflight?.abort();
    this.inflight = null;
    this.stopPolling();
  }

  private async load(isPoll: boolean): Promise<void> {
    if (this.disposed || !this.query) return;
    const seq = ++this.seq;
    this.inflight?.abort();
    const controller = new AbortController();
    this.inflight = controller;
    const url = runsUrl(this.query);
    if (!isPoll) this.update({ loading: true, error: null });

    try {
      const res = await this.fetchImpl(url, {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Failed to fetch runs: HTTP ${res.status}`);
      const data = (await res.json()) as ListRunsResponse;
      if (!this.isCurrent(seq)) return;
      const runs = data.runs || [];
      const metrics = data.metrics ?? this.state.metrics;
      this.update({
        runs,
        total: data.total ?? 0,
        metrics,
        loading: false,
        error: null,
      });
      this.syncPolling(shouldPoll(runs, metrics));
    } catch (err) {
      if (!this.isCurrent(seq)) return;
      this.update({ loading: false, error: (err as Error).message });
    } finally {
      if (this.inflight === controller) this.inflight = null;
    }
  }

  private isCurrent(seq: number): boolean {
    return !this.disposed && seq === this.seq;
  }

  private syncPolling(active: boolean): void {
    if (active && this.timer === null) {
      this.timer = this.timers.setInterval(() => void this.load(true), this.intervalMs);
      this.update({ polling: true });
    } else if (!active && this.timer !== null) {
      this.stopPolling();
      this.update({ polling: false });
    }
  }

  private stopPolling(): void {
    if (this.timer !== null) {
      this.timers.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private update(patch: Partial<RunsFeedState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
}
