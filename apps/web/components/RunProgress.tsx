"use client";

import { useEffect, useRef, useState } from "react";
import type { RunEvent, RunState, StageState } from "@doceomenter/shared";
import { ArtifactList } from "./ArtifactList";
import { QualitySummary } from "./QualitySummary";

const STAGE_LABEL: Record<StageState["name"], string> = {
  clone: "Cloning repository",
  analyze: "Static analysis",
  "draft-concept": "Concept & vision draft",
  "detect-runtime": "Detecting project type",
  boot: "Booting project",
  capture: "Playwright capture (screenshots + video)",
  "draft-technical": "Technical write-up",
  "post-process": "Post-processing assets",
  "quality-check": "Quality gate + case export",
  render: "Rendering Markdown / HTML / PDF",
};

const TERMINAL = new Set<RunState["state"]>(["done", "partial", "failed", "cancelled"]);

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
          setState((s) => ({ ...s, state: event.state, artifacts: event.artifacts }));
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

  const totalStages = state.stages.length;
  const resolvedStages = state.stages.filter((stage) =>
    ["done", "skipped", "degraded"].includes(stage.status),
  ).length;
  const failedStages = state.stages.filter((stage) => stage.status === "failed").length;
  const runningStage = state.stages.find((stage) => stage.status === "running");
  const progressPct = totalStages ? Math.round((resolvedStages / totalStages) * 100) : 0;
  const isTerminal = TERMINAL.has(state.state);

  return (
    <section className="space-y-6">
      <header className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Active case run
            </p>
            <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
              Run{" "}
              <code className="rounded-md bg-zinc-100 px-2 py-1 text-xl dark:bg-zinc-800 sm:text-2xl">
                {state.runId}
              </code>
            </h1>
            <p className="mt-3 break-all text-sm text-zinc-600 dark:text-zinc-400">
              {state.spec.url}
            </p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-sm font-semibold ${runStateClass(state.state)}`}>
            {labelForState(state.state)}
          </span>
        </div>

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <RunMeta label="Ref" value={state.spec.ref ?? "main"} />
          <RunMeta label="Depth" value={state.spec.outputStyle ?? "standard"} />
          <RunMeta label="Media" value={state.spec.includeVideo === false ? "Screenshots" : "Screenshots + video"} />
          <RunMeta label="Updated" value={formatStamp(state.updatedAt)} />
          {state.provider && (
            <RunMeta
              label="Paid for by"
              value={
                state.provider.fixture
                  ? "Fixtures — no credential configured"
                  : `${state.provider.label} · ${state.provider.model}${
                      state.provider.plan ? ` · ${state.provider.plan}` : ""
                    }`
              }
            />
          )}
        </dl>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-zinc-500">
            <span>{runningStage ? STAGE_LABEL[runningStage.name] : isTerminal ? "Run complete" : "Queued"}</span>
            <span>
              {resolvedStages}/{totalStages} stages
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <div className="min-w-0 space-y-6">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Pipeline</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {failedStages > 0
                    ? `${failedStages} stage failed`
                    : `${resolvedStages} stages resolved`}
                </p>
              </div>
              <div className="grid grid-cols-3 overflow-hidden rounded-md border border-zinc-200 text-center text-xs dark:border-zinc-800">
                <div className="px-3 py-2">
                  <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                    {resolvedStages}
                  </div>
                  <div className="text-zinc-500">Resolved</div>
                </div>
                <div className="border-x border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <div className="font-semibold text-sky-700 dark:text-sky-300">
                    {state.stages.filter((stage) => stage.status === "running").length}
                  </div>
                  <div className="text-zinc-500">Running</div>
                </div>
                <div className="px-3 py-2">
                  <div className="font-semibold text-zinc-700 dark:text-zinc-300">
                    {state.stages.filter((stage) => stage.status === "pending").length}
                  </div>
                  <div className="text-zinc-500">Pending</div>
                </div>
              </div>
            </div>

            <ol className="mt-5 grid gap-2">
              {state.stages.map((stage) => (
                <li
                  key={stage.name}
                  className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/70"
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${stageDotClass(stage.status)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                          {STAGE_LABEL[stage.name]}
                        </p>
                        <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${stageBadgeClass(stage.status)}`}>
                          {stage.status}
                        </span>
                      </div>
                      <p className="mt-1 min-h-5 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                        {stage.message ?? defaultStageMessage(stage.status)}
                      </p>
                      {stage.status === "running" && typeof stage.pct === "number" ? (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-sky-500 transition-all"
                            style={{ width: `${Math.max(0, Math.min(100, stage.pct))}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-zinc-950 shadow-sm dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Worker log
              </h2>
              <span className="text-xs text-zinc-500">{logs.length} lines</span>
            </div>
            <div
              ref={logRef}
              aria-live="polite"
              className="h-64 overflow-auto p-4 font-mono text-xs leading-5 text-zinc-200"
            >
              {logs.length === 0 ? <span className="text-zinc-500">waiting for logs...</span> : null}
              {logs.map((line, index) => (
                <div key={`${line}-${index}`} className="break-words">
                  {line}
                </div>
              ))}
            </div>
          </section>

          {Object.keys(thumbs).length > 0 && (
            <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Live capture thumbnails
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {Object.entries(thumbs).map(([id, src]) => (
                  <figure key={id} className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                    <img src={src} alt={id} className="aspect-video w-full object-cover" />
                    <figcaption className="truncate px-2 py-1.5 text-xs text-zinc-500">{id}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-6">
          <QualitySummary runId={state.runId} state={state} />
          {isTerminal && state.artifacts ? <ArtifactList runId={state.runId} state={state} /> : null}
          {state.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300">
              <span className="font-semibold">Error:</span> {state.error}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function RunMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/70">
      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">{label}</dt>
      <dd className="mt-1 truncate font-medium text-zinc-950 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

function labelForState(state: RunState["state"]) {
  switch (state) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "done":
      return "Done";
    case "partial":
      return "Partial";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function runStateClass(state: RunState["state"]) {
  switch (state) {
    case "done":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
    case "partial":
      return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
    case "failed":
    case "cancelled":
      return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300";
    case "running":
      return "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300";
    case "queued":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

function stageDotClass(status: StageState["status"]) {
  switch (status) {
    case "done":
      return "bg-emerald-500";
    case "degraded":
      return "bg-amber-400";
    case "failed":
      return "bg-red-500";
    case "running":
      return "bg-sky-500";
    case "skipped":
      return "bg-zinc-400";
    case "pending":
      return "bg-zinc-300 dark:bg-zinc-700";
  }
}

function stageBadgeClass(status: StageState["status"]) {
  switch (status) {
    case "pending":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    case "running":
      return "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300";
    case "done":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
    case "skipped":
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    case "degraded":
      return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
    case "failed":
      return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300";
  }
}

function defaultStageMessage(status: StageState["status"]) {
  switch (status) {
    case "pending":
      return "Waiting for earlier stages.";
    case "running":
      return "In progress.";
    case "done":
      return "Completed.";
    case "skipped":
      return "Skipped for this repository.";
    case "degraded":
      return "Completed with caveats.";
    case "failed":
      return "Needs attention.";
  }
}

function formatStamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return value.replace("T", " ").slice(0, 19);
}
