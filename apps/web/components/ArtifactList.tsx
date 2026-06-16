"use client";

import type { RunState } from "@doceomenter/shared";

export function ArtifactList({ runId, state }: { runId: string; state: RunState }) {
  const a = state.artifacts;
  if (!a) return null;
  const link = (path: string | undefined) =>
    path ? `/api/runs/${runId}/files/${encodeURIComponent(path)}` : undefined;

  const artifacts = [
    a.deckHtml
      ? {
          title: "Presentation",
          description: "Browser-ready HTML deck for stakeholder review.",
          action: "Open presentation",
          href: link(a.deckHtml),
          primary: true,
          download: false,
          external: true,
        }
      : undefined,
    a.deckPdf
      ? {
          title: "PDF deck",
          description: "Portable slide export for sharing and archival.",
          action: "Download PDF",
          href: link(a.deckPdf),
          primary: false,
          download: true,
          external: false,
        }
      : undefined,
    a.reportMd
      ? {
          title: "Markdown report",
          description: "Editable case write-up with evidence and captures.",
          action: "Download Markdown",
          href: link(a.reportMd),
          primary: false,
          download: true,
          external: false,
        }
      : undefined,
    a.caseStudyJson
      ? {
          title: "Portfolio export",
          description: "Structured case data for publishing workflows.",
          action: "Case export (JSON)",
          href: link(a.caseStudyJson),
          primary: false,
          download: true,
          external: false,
        }
      : undefined,
    a.qualityJson
      ? {
          title: "Quality report",
          description: "Pass, degraded, and fail checks for the case package.",
          action: "Quality report",
          href: link(a.qualityJson),
          primary: false,
          download: true,
          external: false,
        }
      : undefined,
    {
      title: "Run metadata",
      description: "Raw state snapshot for debugging and reproducibility.",
      action: "Run metadata (JSON)",
      href: `/api/runs/${runId}/files/state.json`,
      primary: false,
      download: true,
      external: false,
    },
  ].filter(Boolean) as Array<{
    title: string;
    description: string;
    action: string;
    href: string | undefined;
    primary: boolean;
    download: boolean;
    external: boolean;
  }>;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Generated outputs
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Download the final package or inspect the source data.
          </p>
        </div>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {artifacts.length} files
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {artifacts.map((artifact) => (
          <article
            key={artifact.action}
            className="flex min-h-40 flex-col justify-between rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/70"
          >
            <div>
              <h4 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {artifact.title}
              </h4>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {artifact.description}
              </p>
            </div>
            {artifact.href ? (
              <a
                href={artifact.href}
                aria-label={artifact.action}
                download={artifact.download || undefined}
                target={artifact.external ? "_blank" : undefined}
                rel={artifact.external ? "noreferrer" : undefined}
                className={`mt-4 inline-flex h-10 items-center justify-center rounded-md px-3 text-sm font-semibold transition ${
                  artifact.primary
                    ? "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
                    : "border border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600"
                }`}
              >
                {artifact.action}
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
