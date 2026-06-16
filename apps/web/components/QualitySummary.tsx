"use client";

import { useEffect, useMemo, useState } from "react";
import type { CaseStudyExport, QualityReport, RunState } from "@doceomenter/shared";

type LoadedQuality = {
  quality?: QualityReport;
  caseStudy?: CaseStudyExport;
  error?: string;
  loading: boolean;
};

const STATUS_LABEL: Record<QualityReport["status"], string> = {
  pass: "Pass",
  degraded: "Degraded",
  fail: "Fail",
};

export function QualitySummary({ runId, state }: { runId: string; state: RunState }) {
  const [loaded, setLoaded] = useState<LoadedQuality>({ loading: false });
  const artifacts = state.artifacts;
  const qualityPath = artifacts?.qualityJson;
  const caseStudyPath = artifacts?.caseStudyJson;

  useEffect(() => {
    if (!qualityPath && !caseStudyPath) {
      setLoaded({ loading: false });
      return;
    }

    const controller = new AbortController();
    setLoaded((current) => ({ ...current, loading: true, error: undefined }));

    async function load() {
      try {
        const [quality, caseStudy] = await Promise.all([
          qualityPath
            ? fetch(fileUrl(runId, qualityPath), { signal: controller.signal }).then((res) => {
                if (!res.ok) throw new Error(`Quality report returned HTTP ${res.status}`);
                return res.json() as Promise<QualityReport>;
              })
            : Promise.resolve(undefined),
          caseStudyPath
            ? fetch(fileUrl(runId, caseStudyPath), { signal: controller.signal }).then((res) => {
                if (!res.ok) throw new Error(`Case export returned HTTP ${res.status}`);
                return res.json() as Promise<CaseStudyExport>;
              })
            : Promise.resolve(undefined),
        ]);
        if (!controller.signal.aborted) {
          setLoaded({ quality, caseStudy, loading: false });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoaded({ loading: false, error: (error as Error).message });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [caseStudyPath, qualityPath, runId]);

  const checkCounts = useMemo(() => {
    const checks = loaded.quality?.checks ?? [];
    return {
      pass: checks.filter((check) => check.status === "pass").length,
      degraded: checks.filter((check) => check.status === "degraded").length,
      fail: checks.filter((check) => check.status === "fail").length,
      total: checks.length,
    };
  }, [loaded.quality?.checks]);

  if (!qualityPath && !caseStudyPath) {
    return null;
  }

  const quality = loaded.quality;
  const caseStudy = loaded.caseStudy;

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Reference readiness
            </h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {quality?.summary ?? (loaded.loading ? "Loading quality report..." : "Quality report pending.")}
            </p>
          </div>
          {quality ? (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(quality.status)}`}>
              {STATUS_LABEL[quality.status]}
            </span>
          ) : null}
        </div>

        {quality ? (
          <>
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                <span>Quality mix</span>
                <span>{checkCounts.total} checks</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <span
                  className="bg-emerald-500"
                  style={{ width: pct(checkCounts.pass, checkCounts.total) }}
                />
                <span
                  className="bg-amber-400"
                  style={{ width: pct(checkCounts.degraded, checkCounts.total) }}
                />
                <span
                  className="bg-red-500"
                  style={{ width: pct(checkCounts.fail, checkCounts.total) }}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <Metric label="Pass" value={checkCounts.pass} tone="text-emerald-700 dark:text-emerald-300" />
                <Metric label="Degraded" value={checkCounts.degraded} tone="text-amber-700 dark:text-amber-300" />
                <Metric label="Fail" value={checkCounts.fail} tone="text-red-700 dark:text-red-300" />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {quality.checks.slice(0, 5).map((check) => (
                <div
                  key={check.id}
                  className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/70"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{check.label}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass(check.status)}`}>
                      {STATUS_LABEL[check.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{check.detail}</p>
                </div>
              ))}
            </div>

            {quality.recommendations.length > 0 ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/70 dark:bg-amber-950/30">
                <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-300">
                  Next refinements
                </h4>
                <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900 dark:text-amber-200">
                  {quality.recommendations.slice(0, 3).map((recommendation) => (
                    <li key={recommendation}>{recommendation}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}

        {loaded.error ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300">
            {loaded.error}
          </p>
        ) : null}
      </div>

      {caseStudy ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Case export preview
              </h3>
              <p
                data-testid="case-export-title"
                className="mt-2 break-words text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
              >
                {caseStudy.portfolio.title}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">
              v1
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {caseStudy.portfolio.description}
          </p>

          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            {caseStudy.portfolio.metrics.slice(0, 4).map((metric) => (
              <div
                key={`${metric.label}-${metric.value}`}
                className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/70"
              >
                <dt className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
                  {metric.label}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            {caseStudy.portfolio.techStack.slice(0, 8).map((tech) => (
              <span
                key={tech}
                className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
              >
                {tech}
              </span>
            ))}
          </div>

          <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-400">
            {caseStudy.portfolio.media.length} media assets prepared for publishing.
          </div>
        </div>
      ) : loaded.loading ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          Loading case export preview...
        </div>
      ) : null}
    </section>
  );
}

function fileUrl(runId: string, path: string) {
  return `/api/runs/${runId}/files/${encodeURIComponent(path)}`;
}

function pct(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function statusClass(status: QualityReport["status"]) {
  switch (status) {
    case "pass":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
    case "degraded":
      return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
    case "fail":
      return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300";
  }
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-950/70">
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-zinc-500">{label}</div>
    </div>
  );
}
