"use client";

import React from "react";
import type { RunMetrics } from "./types";

export interface KpiStripProps {
  metrics?: RunMetrics | null;
}

export function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0 || isNaN(ms)) return "0m 0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function KpiStrip({ metrics }: KpiStripProps) {
  const m: RunMetrics = metrics ?? {
    totalRuns: 0,
    queuedRuns: 0,
    runningRuns: 0,
    doneRuns: 0,
    partialRuns: 0,
    failedRuns: 0,
    cancelledRuns: 0,
    activeRuns: 0,
    successRatePct: 0,
    avgDurationMs: 0,
    totalArtifacts: 0,
  };

  const formattedAvgDuration = formatDurationMs(m.avgDurationMs);

  return (
    <section aria-label="Operations KPIs" data-testid="kpi-strip">
      <div className="dm-grid-hair grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        {/* Card 1: Total Runs */}
        <div data-testid="kpi-total-runs" className="flex flex-col justify-between p-5 sm:p-6">
          <span className="dm-label text-fg-faint">TOTAL RUNS</span>
          <div className="mt-3">
            <span className="font-mono text-[32px] font-semibold leading-none text-fg">
              {m.totalRuns.toLocaleString()}
            </span>
            <span className="mt-2 block text-[12px] text-fg-muted">
              {`${m.doneRuns} done · ${m.activeRuns} active`}
            </span>
          </div>
        </div>

        {/* Card 2: Success Rate % */}
        <div data-testid="kpi-success-rate" className="flex flex-col justify-between p-5 sm:p-6">
          <span className="dm-label text-fg-faint">SUCCESS RATE</span>
          <div className="mt-3">
            <span className="font-mono text-[32px] font-semibold leading-none text-accent">
              {`${m.successRatePct}%`}
            </span>
            <span className="mt-2 block text-[12px] text-fg-muted truncate">
              {`${m.doneRuns} done / ${m.partialRuns} partial / ${m.failedRuns} failed`}
            </span>
          </div>
        </div>

        {/* Card 3: Avg Duration */}
        <div data-testid="kpi-avg-duration" className="flex flex-col justify-between p-5 sm:p-6">
          <span className="dm-label text-fg-faint">AVG DURATION</span>
          <div className="mt-3">
            <span className="font-mono text-[32px] font-semibold leading-none text-fg">
              {formattedAvgDuration}
            </span>
            <span className="mt-2 block text-[12px] text-fg-muted">
              across done &amp; partial runs
            </span>
          </div>
        </div>

        {/* Card 4: Active Runs */}
        <div data-testid="kpi-active-runs" className="flex flex-col justify-between p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="dm-label text-fg-faint">ACTIVE RUNS</span>
            {m.activeRuns > 0 && (
              <span
                data-testid="active-runs-pulse-dot"
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-accent animate-pulse"
                style={{ animation: "dmPulse 2s ease-in-out infinite" }}
              />
            )}
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[32px] font-semibold leading-none text-fg">
                {m.activeRuns}
              </span>
            </div>
            <span className="mt-2 block text-[12px] text-fg-muted">
              in worker queue
            </span>
          </div>
        </div>

        {/* Card 5: Total Artifacts */}
        <div data-testid="kpi-total-artifacts" className="flex flex-col justify-between p-5 sm:p-6">
          <span className="dm-label text-fg-faint">TOTAL ARTIFACTS</span>
          <div className="mt-3">
            <span className="font-mono text-[32px] font-semibold leading-none text-fg">
              {m.totalArtifacts.toLocaleString()}
            </span>
            <span className="mt-2 block text-[12px] text-fg-muted">
              decks, reports, pdfs, JSON
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
