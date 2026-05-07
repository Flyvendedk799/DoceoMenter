"use client";

import { useEffect, useRef, useState } from "react";
import type { RunEvent, RunState, StageState } from "@doceomenter/shared";
import { ArtifactList } from "./ArtifactList";

const STAGE_LABEL: Record<StageState["name"], string> = {
  clone: "Cloning repository",
  analyze: "Static analysis",
  "draft-concept": "Claude — concept & vision draft",
  "detect-runtime": "Detecting project type",
  boot: "Booting project",
  capture: "Playwright capture (screenshots + video)",
  "draft-technical": "Claude — technical write-up",
  "post-process": "Post-processing assets",
  render: "Rendering Markdown / HTML / PDF",
};

export function RunProgress({ initial }: { initial: RunState }) {
  const [state, setState] = useState<RunState>(initial);
  const [logs, setLogs] = useState<string[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${initial.runId}/events`);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as RunEvent;
        if (event.type === "stage") {
          setState((s) => ({
            ...s,
            stages: s.stages.map((st) => (st.name === event.stage.name ? event.stage : st)),
            updatedAt: new Date().toISOString(),
          }));
        } else if (event.type === "log") {
          setLogs((l) => [...l.slice(-200), event.line]);
        } else if (event.type === "asset" && event.thumbnailUrl) {
          setThumbs((t) => ({ ...t, [event.shotId]: event.thumbnailUrl! }));
        } else if (event.type === "done") {
          setState((s) => ({ ...s, state: "done", artifacts: event.artifacts }));
        } else if (event.type === "error") {
          setState((s) => ({ ...s, state: "failed", error: event.error }));
        }
      } catch {}
    };
    es.onerror = () => {
      // SSE will auto-reconnect; nothing to do here.
    };
    return () => es.close();
  }, [initial.runId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs.length]);

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium">
          Run <code className="rounded bg-zinc-100 px-1 py-0.5 text-sm dark:bg-zinc-800">{state.runId}</code>
        </h2>
        <span className="text-sm text-zinc-500">{state.state}</span>
      </header>
      <ol className="space-y-1">
        {state.stages.map((s) => (
          <li key={s.name} className="flex items-center gap-3 text-sm">
            <span aria-hidden className="w-5 text-center">
              {iconFor(s.status)}
            </span>
            <span className="flex-1">{STAGE_LABEL[s.name]}</span>
            <span className="text-zinc-500">{s.message}</span>
          </li>
        ))}
      </ol>
      <div
        ref={logRef}
        aria-live="polite"
        className="h-48 overflow-auto rounded-md bg-zinc-900 p-3 font-mono text-xs text-zinc-200"
      >
        {logs.length === 0 ? <span className="opacity-60">waiting for logs…</span> : null}
        {logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      {Object.keys(thumbs).length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {Object.entries(thumbs).map(([id, src]) => (
            <img key={id} src={src} alt={id} className="rounded shadow" />
          ))}
        </div>
      )}
      {state.state === "done" || state.state === "partial" ? (
        <ArtifactList runId={state.runId} state={state} />
      ) : null}
      {state.error && <p className="text-sm text-red-600">Error: {state.error}</p>}
    </section>
  );
}

function iconFor(status: StageState["status"]): string {
  switch (status) {
    case "pending":
      return "·";
    case "running":
      return "●";
    case "done":
      return "✓";
    case "skipped":
      return "—";
    case "degraded":
      return "△";
    case "failed":
      return "×";
  }
}
