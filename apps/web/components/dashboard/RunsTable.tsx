"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import type { RunListItem, RunMetrics } from "./types";
import { StatusBadge } from "./StatusBadge";
import { ProgressBar } from "./ProgressBar";
import { ArtifactMenu } from "./ArtifactMenu";
import { EmptyState } from "./EmptyState";
import { formatDurationMs } from "./KpiStrip";

export interface RunsTableProps {
  runs: RunListItem[];
  total: number;
  metrics?: RunMetrics | null;
  loading?: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: "all" | "active" | "done" | "partial" | "failed";
  onStatusFilterChange: (status: "all" | "active" | "done" | "partial" | "failed") => void;
  sortBy: "createdAt" | "updatedAt" | "duration";
  onSortByChange: (sort: "createdAt" | "updatedAt" | "duration") => void;
  sortOrder: "asc" | "desc";
  onSortOrderChange: (order: "asc" | "desc") => void;
  limit: number;
  onLimitChange: (limit: number) => void;
  offset: number;
  onOffsetChange: (offset: number) => void;
  onResetFilters?: () => void;
  onLaunchClick?: () => void;
}

export function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    const then = new Date(dateStr).getTime();
    if (isNaN(then)) return dateStr;
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - then) / 1000));
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

export function debounce<T extends (...args: any[]) => void>(fn: T, delay = 300) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return function (...args: Parameters<T>) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

export const POLLING_INTERVAL_MS = 10000;

export function shouldPoll(runs: RunListItem[], metrics?: RunMetrics | null): boolean {
  return Boolean(
    (metrics && metrics.activeRuns > 0) ||
    runs.some((r) => r.state === "queued" || r.state === "running")
  );
}

export function RunsTable({
  runs,
  total,
  metrics,
  loading = false,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  limit,
  onLimitChange,
  offset,
  onOffsetChange,
  onResetFilters,
  onLaunchClick,
}: RunsTableProps) {
  const [localQuery, setLocalQuery] = useState(searchQuery);

  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localQuery !== searchQuery) {
        onSearchChange(localQuery);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localQuery, searchQuery, onSearchChange]);

  const statusPills: Array<{
    id: "all" | "active" | "done" | "partial" | "failed";
    label: string;
    count: number;
  }> = [
    { id: "all", label: "All", count: metrics?.totalRuns ?? total },
    {
      id: "active",
      label: "Active",
      count: metrics?.activeRuns ?? runs.filter((r) => r.state === "queued" || r.state === "running").length,
    },
    {
      id: "done",
      label: "Done",
      count: metrics?.doneRuns ?? runs.filter((r) => r.state === "done").length,
    },
    {
      id: "partial",
      label: "Partial",
      count: metrics?.partialRuns ?? runs.filter((r) => r.state === "partial").length,
    },
    {
      id: "failed",
      label: "Failed",
      count: metrics?.failedRuns ?? runs.filter((r) => r.state === "failed").length,
    },
  ];

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  const isFiltered = Boolean(searchQuery.trim() || statusFilter !== "all");

  return (
    <div className="flex flex-col gap-4" data-testid="runs-table-container">
      {/* Search, Status Pills, Sort Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-1.5" data-testid="status-pills">
          {statusPills.map((pill) => {
            const active = statusFilter === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                data-testid={`status-pill-${pill.id}`}
                onClick={() => {
                  onStatusFilterChange(pill.id);
                  onOffsetChange(0);
                }}
                className={`dm-pill h-8 gap-2 cursor-pointer transition-colors ${
                  active
                    ? "border-accent/40 bg-accent/15 text-accent font-semibold"
                    : "border-line bg-ink-800 text-fg-muted hover:border-white/20 hover:text-fg"
                }`}
              >
                <span>{pill.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                    active ? "bg-accent/20 text-accent" : "bg-white/[0.06] text-fg-faint"
                  }`}
                >
                  {pill.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search bar & Sorting */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search Bar */}
          <div className="relative min-w-[240px] flex-1 sm:w-64">
            <input
              type="text"
              data-testid="runs-search-input"
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              placeholder="Search repository or ref…"
              className="dm-input h-9 text-[12.5px] pr-8"
            />
            {localQuery && (
              <button
                type="button"
                onClick={() => {
                  setLocalQuery("");
                  onSearchChange("");
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-fg-faint hover:text-fg"
              >
                ✕
              </button>
            )}
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5">
            <select
              data-testid="runs-sort-select"
              value={`${sortBy}:${sortOrder}`}
              onChange={(e) => {
                const [sb, so] = e.target.value.split(":") as [
                  "createdAt" | "updatedAt" | "duration",
                  "asc" | "desc",
                ];
                onSortByChange(sb);
                onSortOrderChange(so);
                onOffsetChange(0);
              }}
              className="dm-input h-9 cursor-pointer text-[12px] font-mono px-3 w-auto"
            >
              <option value="createdAt:desc" className="bg-ink-800 text-fg">Newest first</option>
              <option value="createdAt:asc" className="bg-ink-800 text-fg">Oldest first</option>
              <option value="duration:desc" className="bg-ink-800 text-fg">Duration (longest)</option>
              <option value="duration:asc" className="bg-ink-800 text-fg">Duration (shortest)</option>
              <option value="updatedAt:desc" className="bg-ink-800 text-fg">Recently updated</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table / Empty State */}
      {runs.length === 0 ? (
        isFiltered ? (
          <EmptyState
            type="no-results"
            onResetFilters={() => {
              setLocalQuery("");
              onResetFilters?.();
            }}
          />
        ) : (
          <EmptyState type="no-runs" onLaunch={onLaunchClick} />
        )
      ) : (
        <div className="dm-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left" data-testid="runs-table">
              <thead>
                <tr className="border-b border-line bg-ink-850 font-mono text-[11px] uppercase tracking-wider text-fg-faint">
                  <th className="py-3 px-4">Repository &amp; Ref</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 min-w-[150px]">Progress</th>
                  <th className="py-3 px-4">Provider &amp; Model</th>
                  <th className="py-3 px-4">Duration &amp; Started</th>
                  <th className="py-3 px-4 text-right">Direct Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-ink-800 text-[13px]">
                {runs.map((run) => {
                  let repoName = run.spec.url;
                  try {
                    const parsed = new URL(run.spec.url);
                    repoName = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
                  } catch {}

                  const resolved = run.stageSummary?.resolved ?? 0;
                  const totalStages = run.stageSummary?.total ?? 10;
                  const isDoneOrPartial = run.state === "done" || run.state === "partial";
                  const providerLabel = run.provider?.label ?? run.spec.provider ?? "AI Provider";
                  const isFixture = run.provider?.fixture ?? (!run.provider?.model && !run.spec.provider);
                  const modelLabel = isFixture ? "fixture mode" : (run.provider?.model || "fixture mode");

                  return (
                    <tr
                      key={run.runId}
                      data-testid={`run-row-${run.runId}`}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Repository & Ref */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col gap-1">
                          <a
                            href={run.spec.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[13px] font-semibold text-fg hover:text-accent transition-colors no-underline truncate max-w-[240px]"
                            title={run.spec.url}
                          >
                            {repoName}
                          </a>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[10.5px] text-fg-faint bg-white/[0.04] px-1.5 py-0.5 rounded border border-line">
                              {run.spec.ref || "main"}
                            </span>
                            <span className="font-mono text-[10px] uppercase text-accent/80 bg-accent/[0.08] px-1.5 py-0.5 rounded border border-accent/20">
                              {run.spec.outputStyle || "standard"}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <StatusBadge status={run.state} />
                      </td>

                      {/* Progress */}
                      <td className="py-3.5 px-4">
                        <ProgressBar
                          resolved={resolved}
                          total={totalStages}
                          className="max-w-[180px]"
                        />
                      </td>

                      {/* Provider & Model */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-fg text-[12.5px]">
                            {providerLabel}
                          </span>
                          <span className="dm-pill h-5 px-2 text-[10px] w-fit font-mono border-white/10 bg-white/[0.03] text-fg-muted">
                            {modelLabel}
                          </span>
                        </div>
                      </td>

                      {/* Duration & Started */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1 font-mono text-[12px]">
                          <span className="text-fg font-medium">
                            {formatDurationMs(run.durationMs)}
                          </span>
                          <span className="text-[11px] text-fg-faint" title={run.createdAt}>
                            {formatRelativeTime(run.createdAt)}
                          </span>
                        </div>
                      </td>

                      {/* Direct Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/run/${run.runId}`}
                            className="dm-btn h-8 px-3 text-[12px] no-underline font-medium"
                          >
                            Open Run →
                          </Link>
                          {isDoneOrPartial ? (
                            <Link
                              href={`/run/${run.runId}/outputs`}
                              className="dm-btn-secondary h-8 px-3 text-[12px] no-underline font-medium"
                            >
                              Case Package
                            </Link>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="dm-btn-secondary h-8 px-3 text-[12px] opacity-40 cursor-not-allowed"
                            >
                              Case Package
                            </button>
                          )}
                          <ArtifactMenu runId={run.runId} disabled={!isDoneOrPartial} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div
            data-testid="pagination-controls"
            className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 bg-ink-850 font-mono text-[12px] text-fg-muted"
          >
            <div className="flex items-center gap-2">
              <span>
                {`Showing ${Math.min(offset + 1, total)}–${Math.min(offset + limit, total)} of ${total} runs`}
              </span>
              {loading && <span className="text-accent animate-pulse">syncing…</span>}
            </div>

            <div className="flex items-center gap-3">
              {/* Page size selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-fg-faint">Rows:</span>
                <select
                  data-testid="page-size-select"
                  value={limit}
                  onChange={(e) => {
                    onLimitChange(Number(e.target.value));
                    onOffsetChange(0);
                  }}
                  className="dm-input h-7 w-auto py-0 px-2 text-[11px] font-mono cursor-pointer"
                >
                  <option value={10} className="bg-ink-800 text-fg">10</option>
                  <option value={20} className="bg-ink-800 text-fg">20</option>
                  <option value={50} className="bg-ink-800 text-fg">50</option>
                  <option value={100} className="bg-ink-800 text-fg">100</option>
                </select>
              </div>

              {/* Page navigation */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="pagination-prev"
                  disabled={!hasPrev}
                  onClick={() => onOffsetChange(Math.max(0, offset - limit))}
                  className="dm-btn-secondary h-7 px-2.5 text-[11px]"
                >
                  Previous
                </button>
                <span className="px-2 text-fg-soft">
                  {`${currentPage} / ${totalPages}`}
                </span>
                <button
                  type="button"
                  data-testid="pagination-next"
                  disabled={!hasNext}
                  onClick={() => onOffsetChange(offset + limit)}
                  className="dm-btn-secondary h-7 px-2.5 text-[11px]"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
