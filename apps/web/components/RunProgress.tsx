"use client";

import Link from "next/link";
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
  const elapsed = useElapsed(state.createdAt, isTerminal ? state.updatedAt : undefined);

  return (
    <section className="flex flex-col gap-8">
      <header
        className="flex flex-wrap items-end gap-5"
        style={{ animation: "dmRise .8s cubic-bezier(.16,1,.3,1) both" }}
      >
        <div className="flex min-w-[280px] flex-1 flex-col gap-3">
          <span className="font-mono text-[11px] uppercase tracking-eyebrow text-fg-faint">
            Run {state.runId}
          </span>
          <h1 className="m-0 break-all font-display text-[clamp(30px,5vw,58px)] font-normal leading-[1.02] tracking-[-.02em]">
            {displayRepo(state.spec.url)}
          </h1>
        </div>
        <span className={`dm-pill ${runStateClass(state.state)}`}>
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-current"
            style={state.state === "running" ? { animation: "dmPulse 2.4s ease-in-out infinite" } : undefined}
          />
          {labelForState(state.state)} · {elapsed}
        </span>
      </header>

      {/* A 2px rule is the whole progress indicator; the sweep inside it is what
          says the machine is still moving. */}
      <div
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${resolvedStages} of ${totalStages} stages resolved`}
        className="h-0.5 overflow-hidden rounded-sm bg-white/[.08]"
      >
        <div
          className="relative h-full overflow-hidden bg-[linear-gradient(90deg,#0E8C99,#5AD8E6)] transition-[width] duration-surface ease-house"
          style={{ width: `${progressPct}%` }}
        >
          {!isTerminal && (
            <div className="absolute inset-0 animate-bar bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent)]" />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11.5px] text-fg-faint">
        <span>{state.spec.ref ?? "main"}</span>
        <span>{state.spec.outputStyle ?? "standard"}</span>
        <span>{state.spec.includeVideo === false ? "screenshots" : "screenshots + video"}</span>
        <span>
          {resolvedStages}/{totalStages} stages
          {failedStages > 0 ? ` · ${failedStages} failed` : ""}
        </span>
        {state.provider && (
          <span className="text-fg-muted">
            {state.provider.fixture
              ? "fixtures — no credential configured"
              : `${state.provider.label} · ${state.provider.model}${
                  state.provider.plan ? ` · ${state.provider.plan}` : ""
                }`}
          </span>
        )}
      </div>

      {/* Capture and log are live instruments: once the run is over they have
          nothing left to say, and the finished pipeline reads better full width. */}
      <div
        className={`grid items-start gap-5 ${
          isTerminal ? "" : "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        }`}
      >
        <div className="dm-card min-w-0 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line px-6 py-5">
            <span className="dm-label">Pipeline</span>
            <span className="ml-auto font-mono text-[11px] text-fg-faint">
              {runningStage ? STAGE_LABEL[runningStage.name] : isTerminal ? "run complete" : "queued"}
            </span>
          </div>
          <ol className="m-0 list-none p-0">
            {state.stages.map((stage, index) => (
              <li
                key={stage.name}
                className={`flex items-center gap-3.5 border-b border-white/[.05] px-6 py-4 last:border-b-0 ${
                  stage.status === "running" ? "bg-accent/[.06]" : ""
                }`}
              >
                <span className="w-6 shrink-0 font-mono text-[11px] text-fg-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${stageDotClass(stage.status)}`}
                  style={stage.status === "running" ? { animation: "dmPulse 2s ease-in-out infinite" } : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[14.5px] ${
                      stage.status === "pending" || stage.status === "skipped" ? "text-fg-faint" : "text-fg"
                    }`}
                  >
                    {STAGE_LABEL[stage.name]}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-fg-muted">
                    {stage.message ?? defaultStageMessage(stage.status)}
                  </span>
                  {stage.status === "running" && typeof stage.pct === "number" ? (
                    <span className="mt-2 block h-px w-full overflow-hidden bg-white/[.08]">
                      <span
                        className="block h-full bg-accent transition-[width] duration-control ease-house"
                        style={{ width: `${Math.max(0, Math.min(100, stage.pct))}%` }}
                      />
                    </span>
                  ) : null}
                </span>
                <span className={`shrink-0 font-mono text-[11px] ${stageMetaClass(stage.status)}`}>
                  {stageMeta(stage)}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className={`min-w-0 flex-col gap-5 ${isTerminal ? "hidden" : "flex"}`}>
          <section className="dm-card flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
              <span className="dm-label">Live capture</span>
              <span className="ml-auto font-mono text-[11px] text-fg-faint">
                {Object.keys(thumbs).length} shot{Object.keys(thumbs).length === 1 ? "" : "s"}
              </span>
            </div>
            {Object.keys(thumbs).length === 0 ? (
              <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-sm border border-line bg-[repeating-linear-gradient(135deg,#171B20_0_10px,#14171B_10px_20px)]">
                <span className="font-mono text-[11px] tracking-[.14em] text-fg-faint">
                  {runningStage?.name === "capture" ? "chromium · capturing" : "no captures yet"}
                </span>
                {!isTerminal && (
                  <div className="absolute inset-x-0 h-[60px] bg-[linear-gradient(180deg,transparent,rgba(90,216,230,.16),transparent)] [animation:dmSweep_3.4s_linear_infinite]" />
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {Object.entries(thumbs).map(([id, src]) => (
                  <figure key={id} className="m-0 overflow-hidden rounded-sm border border-line bg-ink-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={id} className="aspect-video w-full object-cover" />
                    <figcaption className="truncate px-2 py-1.5 font-mono text-[10.5px] text-fg-faint">
                      {id}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>

          <section className="dm-well flex flex-col gap-1.5 rounded-[20px] px-5 py-5">
            <div className="mb-1 flex items-center gap-3">
              <span className="dm-label">Worker log</span>
              <span className="ml-auto font-mono text-[11px] text-fg-faint">{logs.length} lines</span>
            </div>
            <div
              ref={logRef}
              aria-live="polite"
              className="flex h-64 flex-col gap-[7px] overflow-auto text-[12px] leading-[1.6]"
            >
              {logs.length === 0 ? <span className="text-fg-faint">waiting for logs…</span> : null}
              {logs.map((line, index) => {
                const { time, message } = splitLogLine(line);
                return (
                  <div key={`${line}-${index}`} className="flex gap-3">
                    {time && <span className="shrink-0 text-[#3E464E]">{time}</span>}
                    <span className={`min-w-0 break-words ${logTone(message)}`}>{message}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {state.error ? (
        <p className="m-0 rounded-md border border-fail/30 bg-fail/[.08] px-5 py-4 text-[14px] leading-[1.6] text-fail">
          <span className="font-semibold">Error:</span> {state.error}
        </p>
      ) : null}

      {isTerminal && state.artifacts ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-4 border-t border-line pt-8">
            <h2 className="m-0 font-display text-[clamp(26px,3.4vw,38px)] font-normal leading-[1.05] tracking-[-.02em]">
              The case package is ready.
            </h2>
            <Link href={`/run/${state.runId}/outputs`} className="dm-btn ml-auto no-underline">
              Open case package
            </Link>
          </div>
          <QualitySummary runId={state.runId} state={state} />
          <ArtifactList runId={state.runId} state={state} />
        </div>
      ) : (
        <QualitySummary runId={state.runId} state={state} />
      )}
    </section>
  );
}

/** Ticks while the run is live, then freezes on the terminal stamp. */
function useElapsed(startedAt: string, frozenAt?: string) {
  const [now, setNow] = useState<number | undefined>();
  useEffect(() => {
    if (frozenAt) {
      setNow(new Date(frozenAt).getTime());
      return;
    }
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [frozenAt]);

  const start = new Date(startedAt).getTime();
  if (now === undefined || Number.isNaN(start)) return "—";
  const seconds = Math.max(0, Math.round((now - start) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** `https://github.com/acme/atlas-ui` reads better as `github.com/acme/atlas-ui`. */
function displayRepo(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Worker lines often already carry a stamp; keep it in its own faint column. */
function splitLogLine(line: string): { time?: string; message: string } {
  const match = /^\s*(?:\[)?(\d{2}:\d{2}(?::\d{2})?|\d{4}-\d{2}-\d{2}T[\d:.]+Z?)(?:\])?\s+(.*)$/s.exec(line);
  const stamp = match?.[1];
  if (!match || !stamp) return { message: line };
  return { time: stamp.includes("T") ? stamp.slice(11, 19) : stamp, message: match[2] ?? "" };
}

function logTone(message: string) {
  if (/\b(error|failed|fatal)\b/i.test(message)) return "text-fail";
  if (/\b(warn|degraded|skipped)\b/i.test(message)) return "text-warn";
  if (/^(capture|boot|render|export):/i.test(message)) return "text-accent";
  return "text-fg-muted";
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

/** Four states only: queued, running, done, failed — degraded borrows amber. */
function runStateClass(state: RunState["state"]) {
  switch (state) {
    case "done":
      return "border-accent/30 bg-accent/10 text-accent";
    case "partial":
      return "border-warn/30 bg-warn/10 text-warn";
    case "failed":
    case "cancelled":
      return "border-fail/30 bg-fail/10 text-fail";
    case "running":
      return "border-accent/30 bg-accent/10 text-accent";
    case "queued":
      return "border-white/10 bg-white/[.04] text-fg-faint";
  }
}

function stageDotClass(status: StageState["status"]) {
  switch (status) {
    case "done":
      return "bg-accent";
    case "degraded":
      return "bg-warn";
    case "failed":
      return "bg-fail";
    case "running":
      return "bg-accent";
    case "skipped":
      return "bg-white/25";
    case "pending":
      return "bg-white/[.18]";
  }
}

function stageMetaClass(status: StageState["status"]) {
  switch (status) {
    case "degraded":
      return "text-warn";
    case "failed":
      return "text-fail";
    default:
      return "text-fg-faint";
  }
}

/** Duration once a stage has both ends; otherwise the status word itself. */
function stageMeta(stage: StageState) {
  if (stage.startedAt && stage.finishedAt) {
    const ms = new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) {
      const label = ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
      return stage.status === "done" ? label : `${stage.status} · ${label}`;
    }
  }
  return stage.status;
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
