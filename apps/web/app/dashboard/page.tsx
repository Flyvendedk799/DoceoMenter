"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ListRunsResponse, RunListItem, RunMetrics } from "../../components/dashboard/types";
import { KpiStrip } from "../../components/dashboard/KpiStrip";
import { ProviderStatusWidget } from "../../components/dashboard/ProviderStatusWidget";
import { FastRunLauncher } from "../../components/dashboard/FastRunLauncher";
import { RunsTable, shouldPoll, POLLING_INTERVAL_MS } from "../../components/dashboard/RunsTable";
import { MediaSpotlight } from "../../components/dashboard/MediaSpotlight";

export default function DashboardPage() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Pagination state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "done" | "partial" | "failed">("all");
  const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt" | "duration">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);

  // Fast Run Launcher drawer toggle
  const [launcherOpen, setLauncherOpen] = useState(false);

  // Refresh trigger counter
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchRuns = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      params.set("includeMetrics", "true");

      const res = await fetch(`/api/runs?${params.toString()}`, {
        credentials: "same-origin",
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch runs: HTTP ${res.status}`);
      }

      const data = (await res.json()) as ListRunsResponse;
      setRuns(data.runs || []);
      setTotal(data.total ?? 0);
      if (data.metrics) {
        setMetrics(data.metrics);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, [limit, offset, statusFilter, searchQuery, sortBy, sortOrder]);

  // Initial and reactive fetch on query / filter / pagination changes
  useEffect(() => {
    void fetchRuns(false);
  }, [fetchRuns, refreshTrigger]);

  // Determine if active runs exist (queued or running)
  const hasActiveRuns = shouldPoll(runs, metrics);

  // Auto-polling: 10 seconds interval when active runs exist
  const fetchRunsRef = useRef(fetchRuns);
  fetchRunsRef.current = fetchRuns;

  useEffect(() => {
    if (!hasActiveRuns) return;

    const intervalId = setInterval(() => {
      void fetchRunsRef.current(true);
    }, 10000);

    return () => clearInterval(intervalId);
  }, [hasActiveRuns]);

  const handleRunCreated = useCallback((_runId: string) => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearchQuery("");
    setStatusFilter("all");
    setSortBy("createdAt");
    setSortOrder("desc");
    setOffset(0);
  }, []);

  return (
    <main className="min-h-screen bg-ink-900 text-fg" data-testid="dashboard-page">
      <div className="mx-auto max-w-[1240px] px-5 pb-28 pt-10 sm:px-7 flex flex-col gap-8">
        {/* Operations Hub Header */}
        <header className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="dm-eyebrow text-accent block">00 — OPERATIONS HUB</span>
            <h1 className="m-0 mt-1 font-display text-[clamp(28px,4vw,44px)] font-normal leading-tight tracking-[-0.02em]">
              Documentation Operations
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Live Sync Status Pill */}
            {hasActiveRuns ? (
              <div
                data-testid="live-polling-badge"
                className="dm-pill border-accent/40 bg-accent/10 text-accent font-mono text-[11px] gap-2"
              >
                <span
                  className="h-2 w-2 rounded-full bg-accent animate-pulse"
                  style={{ animation: "dmPulse 1.8s ease-in-out infinite" }}
                />
                <span>Live polling (10s)</span>
              </div>
            ) : (
              <div
                data-testid="idle-sync-badge"
                className="dm-pill border-white/10 bg-white/[0.03] text-fg-faint font-mono text-[11px]"
              >
                <span>Synced</span>
              </div>
            )}

            {/* Fast Run Launcher Toggle */}
            <button
              type="button"
              data-testid="header-launcher-toggle"
              onClick={() => setLauncherOpen((prev) => !prev)}
              aria-expanded={launcherOpen}
              className="dm-btn h-10 px-4 text-[13px] font-semibold"
            >
              {launcherOpen ? "Close Launcher –" : "+ Fast Run Launcher"}
            </button>
          </div>
        </header>

        {/* Global Error Banner */}
        {error && (
          <div
            data-testid="dashboard-fetch-error"
            className="rounded-sm border border-fail/30 bg-fail/[.08] px-4 py-3 text-[13.5px] text-fail"
          >
            Failed to load dashboard data: {error}
          </div>
        )}

        {/* Fast Run Launcher Component */}
        <FastRunLauncher
          isOpen={launcherOpen}
          onToggle={() => setLauncherOpen((prev) => !prev)}
          onRunCreated={handleRunCreated}
        />

        {/* Operational KPI Strip */}
        <KpiStrip metrics={metrics} />

        {/* AI Provider Readiness Status */}
        <ProviderStatusWidget />

        {/* Media Spotlight */}
        <MediaSpotlight runs={runs} />

        {/* Runs Operations Table */}
        <section aria-label="Pipeline Operations Table">
          <div className="mb-3">
            <span className="dm-eyebrow text-accent block">EXECUTED PIPELINES</span>
            <h2 className="m-0 text-[18px] font-semibold text-fg">Active &amp; Historical Runs</h2>
          </div>
          <RunsTable
            runs={runs}
            total={total}
            metrics={metrics}
            loading={loading}
            searchQuery={searchQuery}
            onSearchChange={(q) => {
              setSearchQuery(q);
              setOffset(0);
            }}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
            limit={limit}
            onLimitChange={setLimit}
            offset={offset}
            onOffsetChange={setOffset}
            onResetFilters={handleResetFilters}
            onLaunchClick={() => setLauncherOpen(true)}
          />
        </section>
      </div>
    </main>
  );
}
