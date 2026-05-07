"use client";

import type { RunState } from "@doceomenter/shared";

export function ArtifactList({ runId, state }: { runId: string; state: RunState }) {
  const a = state.artifacts;
  if (!a) return null;
  const link = (path: string | undefined) =>
    path ? `/api/runs/${runId}/files/${encodeURIComponent(path)}` : undefined;

  return (
    <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">Artifacts</h3>
      <div className="flex flex-wrap gap-2">
        {a.deckHtml && (
          <a
            href={link(a.deckHtml)}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
          >
            Open presentation ↗
          </a>
        )}
        {a.deckPdf && (
          <a
            href={link(a.deckPdf)}
            download
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
          >
            Download PDF
          </a>
        )}
        {a.reportMd && (
          <a
            href={link(a.reportMd)}
            download
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
          >
            Download Markdown
          </a>
        )}
        <a
          href={`/api/runs/${runId}/files/state.json`}
          download
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
        >
          Run metadata (JSON)
        </a>
      </div>
    </div>
  );
}
