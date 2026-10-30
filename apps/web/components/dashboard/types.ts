import type { RunSpec, RunState, StageName, TerminalState } from "@doceomenter/shared";

export type ListRunsOptions = {
  limit?: number; // default 20, max 100
  offset?: number; // default 0
  status?: "all" | "active" | "queued" | "running" | "done" | "partial" | "failed" | "cancelled";
  q?: string; // substring match on url or owner/repo
  sortBy?: "createdAt" | "updatedAt" | "duration"; // default createdAt
  sortOrder?: "asc" | "desc"; // default desc
  includeMetrics?: boolean; // default true
};

export type RunStageSummary = {
  total: number;
  resolved: number; // done + degraded + skipped
  failed: number;
  current?: StageName;
};

export type RunListItem = {
  runId: string;
  spec: RunSpec;
  state: "queued" | "running" | TerminalState;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  provider?: RunState["provider"];
  artifacts?: RunState["artifacts"];
  error?: string;
  stageSummary: RunStageSummary;
};

export type RunMetrics = {
  totalRuns: number;
  queuedRuns: number;
  runningRuns: number;
  doneRuns: number;
  partialRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  activeRuns: number;
  successRatePct: number;
  avgDurationMs: number;
  totalArtifacts: number;
};

export type ListRunsResponse = {
  runs: RunListItem[];
  total: number;
  limit: number;
  offset: number;
  metrics?: RunMetrics;
};
