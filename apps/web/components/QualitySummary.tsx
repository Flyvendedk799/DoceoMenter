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
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-4 border-b border-line pb-3.5">
        <span className="dm-label">Reference readiness</span>
        <span className="max-w-[60ch] text-[13px] leading-[1.6] text-fg-muted">
          {quality?.summary ?? (loaded.loading ? "Loading quality report…" : "Quality report pending.")}
        </span>
        {quality ? (
          <span className={`dm-pill ml-auto ${statusClass(quality.status)}`}>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
            {STATUS_LABEL[quality.status]}
          </span>
        ) : null}
      </div>

      {loaded.error ? (
        <p className="m-0 rounded-md border border-fail/30 bg-fail/[.08] px-4 py-3 text-[13.5px] text-fail">
          {loaded.error}
        </p>
      ) : null}

      {/* Audit metrics as a hairline strip — serif numbers, mono labels. */}
      {(caseStudy || quality) && (
        <div className="dm-grid-hair [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          {(caseStudy?.portfolio.metrics ?? []).slice(0, 3).map((metric) => (
            <Tile
              key={`${metric.label}-${metric.value}`}
              label={metric.label}
              value={metric.value}
              note={metric.evidence}
            />
          ))}
          {quality ? (
            <Tile
              label="Gate"
              value={STATUS_LABEL[quality.status]}
              note={`${checkCounts.pass} pass · ${checkCounts.degraded} degraded · ${checkCounts.fail} fail`}
              tone={quality.status}
            />
          ) : null}
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {quality ? (
          <div className="dm-card min-w-0 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line px-6 py-5">
              <span className="dm-label">Quality gate</span>
              <span className="ml-auto font-mono text-[11px] text-fg-faint">
                {checkCounts.total} checks
              </span>
            </div>
            {quality.checks.map((check) => (
              <div
                key={check.id}
                className="flex items-start gap-3.5 border-b border-white/[.05] px-6 py-4 last:border-b-0"
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(check.status)}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px]">{check.label}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-[1.55] text-fg-muted">
                    {check.detail}
                  </span>
                </span>
                <span
                  className={`shrink-0 font-mono text-[11px] uppercase tracking-[.12em] ${textClass(
                    check.status,
                  )}`}
                >
                  {STATUS_LABEL[check.status]}
                </span>
              </div>
            ))}
            {quality.recommendations.length > 0 ? (
              <div className="border-t border-warn/25 bg-warn/[.07] px-6 py-5">
                <span className="font-mono text-[11px] tracking-label text-warn">
                  NEXT REFINEMENTS
                </span>
                <ul className="m-0 mt-2.5 list-none space-y-1.5 p-0 text-[13px] leading-[1.6] text-[#D8C9A6]">
                  {quality.recommendations.slice(0, 3).map((recommendation) => (
                    <li key={recommendation}>{recommendation}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {caseStudy ? (
          <div className="dm-card flex min-w-0 flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
              <span className="dm-label">Case export preview</span>
              <span className="ml-auto font-mono text-[11px] text-fg-faint">
                {caseStudy.schemaVersion.split(".").pop()}
              </span>
            </div>
            <p
              data-testid="case-export-title"
              className="m-0 break-words font-display text-[26px] leading-[1.3] tracking-[-.01em]"
            >
              {caseStudy.portfolio.title}
            </p>
            <p className="m-0 text-[14px] leading-[1.65] text-fg-muted">
              {caseStudy.portfolio.description}
            </p>
            <div className="flex flex-wrap gap-2">
              {caseStudy.portfolio.techStack.slice(0, 10).map((tech) => (
                <span
                  key={tech}
                  className="rounded-pill border border-white/[.12] px-3 py-1.5 font-mono text-[11px] text-fg-muted"
                >
                  {tech}
                </span>
              ))}
            </div>
            <p className="m-0 font-mono text-[11px] text-fg-faint">
              {caseStudy.portfolio.media.length} media assets prepared for publishing
            </p>
          </div>
        ) : loaded.loading ? (
          <div className="dm-card p-6 text-[13.5px] text-fg-faint">Loading case export preview…</div>
        ) : null}
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: QualityReport["status"];
}) {
  return (
    <div className="flex flex-col gap-2 px-6 py-5">
      <span className="font-mono text-[10.5px] uppercase tracking-label text-fg-faint">{label}</span>
      <span className={`font-display text-[38px] leading-none ${tone ? textClass(tone) : "text-fg"}`}>
        {value}
      </span>
      <span className="text-[12.5px] leading-[1.5] text-fg-muted">{note}</span>
    </div>
  );
}

function fileUrl(runId: string, path: string) {
  return `/api/runs/${runId}/files/${encodeURIComponent(path)}`;
}

function statusClass(status: QualityReport["status"]) {
  switch (status) {
    case "pass":
      return "border-accent/30 bg-accent/10 text-accent";
    case "degraded":
      return "border-warn/30 bg-warn/10 text-warn";
    case "fail":
      return "border-fail/30 bg-fail/10 text-fail";
  }
}

function dotClass(status: QualityReport["status"]) {
  switch (status) {
    case "pass":
      return "bg-accent";
    case "degraded":
      return "bg-warn";
    case "fail":
      return "bg-fail";
  }
}

function textClass(status: QualityReport["status"]) {
  switch (status) {
    case "pass":
      return "text-accent";
    case "degraded":
      return "text-warn";
    case "fail":
      return "text-fail";
  }
}
