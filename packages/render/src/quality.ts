import { writeFile } from "node:fs/promises";
import { QualityReportSchema, type QualityReport } from "@doceomenter/shared";
import type { RenderInput } from "./types.js";

type Check = QualityReport["checks"][number];

export async function renderQualityReport(input: RenderInput, outPath: string): Promise<QualityReport> {
  const report = QualityReportSchema.parse(buildQualityReport(input));
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");
  return report;
}

export function buildQualityReport(input: RenderInput): QualityReport {
  const { analysis, capture, content } = input;
  const successful = capture.entries.filter((entry) => entry.status === "ok");
  const liveSuccessful = successful.filter(
    (entry) => "target" in entry.shot && entry.shot.target === "live-app",
  );
  const mediaLinked = content.caseBrief.mediaPlan.filter((media) =>
    successful.some((entry) => entry.shotId === media.captureId),
  );

  const checks: Check[] = [
    mediaCoverageCheck(analysis.signals.hasFrontend, successful.length, liveSuccessful.length),
    {
      id: "case-brief-evidence",
      label: "Evidence register",
      status: content.caseBrief.evidence.length >= 3 ? "pass" : "degraded",
      detail:
        content.caseBrief.evidence.length >= 3
          ? `${content.caseBrief.evidence.length} evidence-backed claims supplied.`
          : "The case brief needs at least three explicit evidence-backed claims.",
      evidence: "content.caseBrief.evidence",
    },
    {
      id: "media-plan",
      label: "Media plan links to captures",
      status: mediaLinked.length > 0 ? "pass" : successful.length > 0 ? "degraded" : "fail",
      detail:
        mediaLinked.length > 0
          ? `${mediaLinked.length} media plan item(s) reference successful captures.`
          : "The media plan does not reference successful captures.",
      evidence: "content.caseBrief.mediaPlan",
    },
    {
      id: "audit-metrics",
      label: "Audit metrics",
      status: content.caseBrief.auditMetrics.length >= 3 ? "pass" : "degraded",
      detail:
        content.caseBrief.auditMetrics.length >= 3
          ? `${content.caseBrief.auditMetrics.length} non-outcome audit metric(s) supplied.`
          : "Add source-derived metrics such as file counts, entrypoints, scripts, and capture counts.",
      evidence: "content.caseBrief.auditMetrics",
    },
    unsupportedOutcomeCheck(input),
  ];

  const status = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "degraded")
      ? "degraded"
      : "pass";
  const recommendations = [
    ...checks
      .filter((check) => check.status !== "pass")
      .map((check) => `${check.label}: ${check.detail}`),
    ...content.caseBrief.risksAndGaps.map((gap) => gap.recommendation),
  ].slice(0, 10);

  return {
    status,
    summary:
      status === "pass"
        ? "Generated content passes the reference-grade evidence and media checks."
        : status === "degraded"
          ? "Generated content is usable, but one or more reference-grade checks need attention."
          : "Generated content is missing required evidence or media for a reference-grade artifact.",
    checks,
    recommendations,
  };
}

function mediaCoverageCheck(
  hasFrontend: boolean,
  successfulCount: number,
  liveSuccessfulCount: number,
): Check {
  if (hasFrontend && liveSuccessfulCount > 0) {
    return {
      id: "live-product-media",
      label: "Live product media",
      status: "pass",
      detail: `${liveSuccessfulCount} successful live-app capture(s) prove the runnable product surface.`,
      evidence: "capture.entries",
    };
  }
  if (hasFrontend && successfulCount > 0) {
    return {
      id: "live-product-media",
      label: "Live product media",
      status: "degraded",
      detail: "Captures succeeded, but none show a live-app surface.",
      evidence: "capture.entries",
    };
  }
  if (hasFrontend) {
    return {
      id: "live-product-media",
      label: "Live product media",
      status: "fail",
      detail: "Frontend projects need at least one successful live-app capture.",
      evidence: "capture.entries",
    };
  }
  return {
    id: "live-product-media",
    label: "Live product media",
    status: successfulCount > 0 ? "pass" : "degraded",
    detail:
      successfulCount > 0
        ? `${successfulCount} non-live capture(s) document the repository.`
        : "No captures succeeded; source-only artifacts should disclose that limitation.",
    evidence: "capture.entries",
  };
}

function unsupportedOutcomeCheck(input: RenderInput): Check {
  const text = [
    input.content.caseBrief.problem,
    input.content.caseBrief.productNarrative,
    ...input.content.caseBrief.evidence.map((entry) => entry.claim),
  ].join(" ");
  const suspicious = /\b(\+?\d+%|revenue|conversion|growth|users?|customers?|faster|performance|adoption)\b/i.test(text);
  if (!suspicious) {
    return {
      id: "no-invented-outcomes",
      label: "No unsupported outcomes",
      status: "pass",
      detail: "The case brief avoids unsupported outcome language.",
      evidence: "content.caseBrief",
    };
  }
  const hasOutcomeEvidence = input.content.caseBrief.evidence.some((entry) =>
    /\b(metric|analytics|benchmark|README|docs?|source)\b/i.test(`${entry.source} ${entry.claim}`),
  );
  return {
    id: "no-invented-outcomes",
    label: "No unsupported outcomes",
    status: hasOutcomeEvidence ? "degraded" : "fail",
    detail: hasOutcomeEvidence
      ? "Outcome-like language appears; reviewers should confirm the linked evidence."
      : "Outcome-like language appears without obvious supporting evidence.",
    evidence: "content.caseBrief",
  };
}
