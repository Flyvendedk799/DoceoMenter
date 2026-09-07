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
          file: "deck.html",
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
          file: "deck.pdf",
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
          file: "report.md",
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
          file: "case-study.json",
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
          file: "quality.json",
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
      file: "state.json",
      title: "Run metadata",
      description: "Raw state snapshot for debugging and reproducibility.",
      action: "Run metadata (JSON)",
      href: `/api/runs/${runId}/files/state.json`,
      primary: false,
      download: true,
      external: false,
    },
  ].filter(Boolean) as Array<{
    file: string;
    title: string;
    description: string;
    action: string;
    href: string | undefined;
    primary: boolean;
    download: boolean;
    external: boolean;
  }>;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-4 border-b border-line pb-3.5">
        <span className="dm-label">Generated outputs</span>
        <span className="ml-auto font-mono text-[11px] text-fg-faint">{artifacts.length} files</span>
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
        {artifacts.map((artifact) => (
          <article
            key={artifact.action}
            className={`dm-card dm-card-lift flex min-h-[186px] flex-col gap-3 p-6 ${
              artifact.primary ? "dm-card-active" : ""
            }`}
          >
            <span className="font-mono text-[11px] text-accent">{artifact.file}</span>
            <h4 className="m-0 text-[18px] font-semibold">{artifact.title}</h4>
            <p className="m-0 flex-1 text-[13.5px] leading-[1.6] text-fg-muted">{artifact.description}</p>
            {artifact.href ? (
              <a
                href={artifact.href}
                aria-label={artifact.action}
                download={artifact.download || undefined}
                target={artifact.external ? "_blank" : undefined}
                rel={artifact.external ? "noreferrer" : undefined}
                className="text-[13px] font-semibold text-fg no-underline transition-colors duration-micro hover:text-accent"
              >
                {artifact.action} →
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
