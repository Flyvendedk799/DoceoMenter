"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { RunListItem } from "./types";

export interface MediaSpotlightProps {
  runs?: RunListItem[];
}

interface SpotlightItem {
  runId: string;
  repoName: string;
  ref: string;
  status: string;
  previewUrl: string;
  outputsUrl: string;
}

export function MediaSpotlight({ runs = [] }: MediaSpotlightProps) {
  const [activeItem, setActiveItem] = useState<SpotlightItem | null>(null);

  // Filter completed runs (done or partial)
  const completedRuns = runs.filter(
    (r) => r.state === "done" || r.state === "partial"
  );

  const spotlightItems: SpotlightItem[] = completedRuns.slice(0, 6).map((run) => {
    let repoName = run.spec.url;
    try {
      const parsed = new URL(run.spec.url);
      repoName = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
    } catch {
      // Keep original url if not parseable
    }

    return {
      runId: run.runId,
      repoName,
      ref: run.spec.ref || "main",
      status: run.state,
      previewUrl: `/api/runs/${encodeURIComponent(run.runId)}/files/deck.html`,
      outputsUrl: `/run/${run.runId}/outputs`,
    };
  });

  return (
    <section className="flex flex-col gap-4" data-testid="media-spotlight">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="dm-eyebrow text-accent block">CAPTURED EVIDENCE</span>
          <h3 className="m-0 text-[18px] font-semibold text-fg">Recent Media &amp; Decks</h3>
        </div>
        <span className="font-mono text-[11px] text-fg-faint">
          {spotlightItems.length > 0
            ? `Showing ${spotlightItems.length} recent capture${spotlightItems.length > 1 ? "s" : ""}`
            : "No captures"}
        </span>
      </div>

      {spotlightItems.length === 0 ? (
        <div
          data-testid="media-spotlight-empty"
          className="dm-card flex flex-col items-center justify-center p-8 text-center text-fg-muted"
        >
          <div className="mb-2 h-10 w-10 rounded-full border border-line bg-white/[0.03] flex items-center justify-center font-mono text-[16px] text-accent">
            ◻
          </div>
          <p className="m-0 font-medium text-fg text-[14px]">No media captures yet</p>
          <p className="mt-1 max-w-md text-[13px] text-fg-muted">
            Completed runs will automatically surface generated presentation decks, reports, and visual assets here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {spotlightItems.map((item) => (
            <div
              key={item.runId}
              data-testid={`spotlight-card-${item.runId}`}
              className="dm-card dm-card-lift group relative overflow-hidden flex flex-col"
            >
              {/* Preview window */}
              <div className="relative aspect-[16/10] bg-ink-900 border-b border-line overflow-hidden">
                <iframe
                  src={item.previewUrl}
                  title={`Slide preview for ${item.repoName}`}
                  tabIndex={-1}
                  className="pointer-events-none absolute inset-0 h-full w-full scale-[0.6] origin-top-left border-0"
                  style={{ width: "166.6%", height: "166.6%" }}
                />
                <div className="absolute inset-0 bg-ink-900/20 group-hover:bg-transparent transition-colors" />

                <button
                  type="button"
                  onClick={() => setActiveItem(item)}
                  aria-label={`Inspect ${item.repoName} preview in lightbox`}
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-ink-900/60"
                >
                  <span className="dm-btn-secondary h-8 px-3 text-[12px]">
                    Preview Lightbox
                  </span>
                </button>
              </div>

              {/* Card Meta */}
              <div className="p-3.5 flex flex-col gap-1.5 flex-1 justify-between bg-ink-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] font-semibold text-fg truncate">
                    {item.repoName}
                  </span>
                  <span
                    className={`dm-pill h-5 px-2 text-[9px] uppercase tracking-wider ${
                      item.status === "done"
                        ? "border-accent/30 bg-accent/10 text-accent"
                        : "border-warn/30 bg-warn/[.08] text-warn"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-fg-faint">
                  <span>ref: {item.ref}</span>
                  <Link
                    href={item.outputsUrl}
                    className="text-accent hover:text-accent-bright no-underline font-medium"
                  >
                    View Outputs →
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox Modal */}
      {activeItem && (
        <div
          data-testid="media-lightbox"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-8"
        >
          <div className="dm-card relative flex flex-col w-full max-w-4xl max-h-[90vh] overflow-hidden bg-ink-850 border-line shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5 bg-ink-900">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[13px] font-semibold text-fg">
                  {activeItem.repoName}
                </span>
                <span className="font-mono text-[11px] text-fg-faint">
                  Run {activeItem.runId}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={activeItem.outputsUrl}
                  className="dm-btn-secondary h-8 px-3 text-[12px] no-underline"
                >
                  Case Package →
                </Link>
                <a
                  href={activeItem.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="dm-btn h-8 px-3 text-[12px] no-underline"
                >
                  Full Screen Deck
                </a>
                <button
                  type="button"
                  onClick={() => setActiveItem(null)}
                  className="dm-btn-ghost h-8 w-8 p-0 text-[18px] text-fg-muted hover:text-fg"
                  aria-label="Close lightbox"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="relative aspect-[16/10] w-full bg-ink-900 overflow-hidden">
              <iframe
                src={activeItem.previewUrl}
                title={`Full slide preview for ${activeItem.repoName}`}
                className="h-full w-full border-0"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
