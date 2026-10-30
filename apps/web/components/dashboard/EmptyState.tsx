"use client";

import React from "react";

export interface EmptyStateProps {
  type?: "no-runs" | "no-results";
  onLaunch?: () => void;
  onResetFilters?: () => void;
}

export function EmptyState({
  type = "no-runs",
  onLaunch,
  onResetFilters,
}: EmptyStateProps) {
  if (type === "no-results") {
    return (
      <div
        data-testid="empty-state-no-results"
        className="dm-card flex flex-col items-center justify-center py-16 px-6 text-center"
      >
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-ink-900 font-mono text-[18px] text-fg-muted">
          ∅
        </div>
        <h4 className="m-0 text-[16px] font-semibold text-fg">No matching operations</h4>
        <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-fg-muted">
          No pipeline runs matched your current search criteria or status filter.
        </p>
        {onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="dm-btn-secondary mt-5 h-10 px-5 text-[13px]"
          >
            Reset Filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="empty-state-no-runs"
      className="dm-card flex flex-col items-center justify-center py-16 px-6 text-center"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-accent/20 bg-accent/10 font-mono text-[18px] text-accent">
        ⚡
      </div>
      <h4 className="m-0 text-[18px] font-semibold text-fg">No operations executed yet</h4>
      <p className="mt-1.5 max-w-md text-[13.5px] leading-relaxed text-fg-muted">
        Your operations center is ready. Launch your first documentation pipeline using the Fast Run Launcher.
      </p>
      {onLaunch && (
        <button
          type="button"
          onClick={onLaunch}
          className="dm-btn mt-5 h-10 px-6 text-[13.5px]"
        >
          Launch First Run
        </button>
      )}
    </div>
  );
}
