"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { KpiStrip } from "../../components/dashboard/KpiStrip";
import { ProviderStatusWidget } from "../../components/dashboard/ProviderStatusWidget";
import { FastRunLauncher } from "../../components/dashboard/FastRunLauncher";
import { RunsTable, shouldPoll } from "../../components/dashboard/RunsTable";
import {
  INITIAL_RUNS_FEED_STATE,
  RunsFeed,
  type RunsFeedState,
} from "../../components/dashboard/runsFeed";
import { MediaSpotlight } from "../../components/dashboard/MediaSpotlight";

export default function DashboardPage() {
  const [feed, setFeed] = useState<RunsFeedState>(INITIAL_RUNS_FEED_STATE);
  const { runs, total, metrics, loading, error } = feed;

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

  // One feed per mounted page: it drops responses that a newer request has superseded, and
  // polls every 10s only while some run is still queued or running.
  const feedRef = useRef<RunsFeed | null>(null);
  useEffect(() => {
    const runsFeed = new RunsFeed(setFeed);
    feedRef.current = runsFeed;
    return () => {
      runsFeed.dispose();
      if (feedRef.current === runsFeed) feedRef.current = null;
    };
  }, []);

  // Initial and reactive fetch on query / filter / pagination changes
  useEffect(() => {
    void feedRef.current?.setQuery({
      limit,
      offset,
      status: statusFilter,
      q: searchQuery,
      sortBy,
      sortOrder,
    });
  }, [limit, offset, statusFilter, searchQuery, sortBy, sortOrder, refreshTrigger]);

  // Whether active runs exist (queued or running), which is what keeps the feed polling
  const hasActiveRuns = feed.polling || shouldPoll(runs, metrics);

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
