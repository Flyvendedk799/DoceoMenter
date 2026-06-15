import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  CaseStudyExportSchema,
  type CaseStudyExport,
  type CaptureManifestEntry,
  type QualityReport,
} from "@doceomenter/shared";
import type { RenderInput } from "./types.js";

export async function renderCaseStudyExport(
  input: RenderInput,
  quality: QualityReport,
  outPath: string,
): Promise<CaseStudyExport> {
  const payload = CaseStudyExportSchema.parse(buildCaseStudyExport(input, quality));
  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
  return payload;
}

export function buildCaseStudyExport(input: RenderInput, quality: QualityReport): CaseStudyExport {
  const { analysis, content, capture, generatedAt } = input;
  const repo = analysis.repo;
  const successful = capture.entries.filter((entry) => entry.status === "ok");
  const tags = Array.from(
    new Set([
      analysis.signals.framework && analysis.signals.framework !== "unknown"
        ? analysis.signals.framework
        : undefined,
      analysis.signals.hasFrontend ? "Frontend" : undefined,
      analysis.signals.hasBackend ? "Backend" : undefined,
      analysis.signals.hasCLI ? "CLI" : undefined,
      analysis.signals.isLibrary ? "Library" : undefined,
      ...Object.keys(analysis.languages).slice(0, 4),
    ].filter(Boolean) as string[]),
  );

  return {
    schemaVersion: "doceomenter.case-study.v1",
    generatedAt,
    repository: repo,
    portfolio: {
      title: repo.name,
      description: content.summary.oneLiner,
      longDescription: [content.concept.what, content.caseBrief.productNarrative].join("\n\n"),
      challenge: content.caseBrief.problem,
      approach: [content.technical.architecture, content.technical.dataFlow].join("\n\n"),
      tags,
      techStack: content.technical.stack.map((item) => item.technology),
      metrics: content.caseBrief.auditMetrics,
      media: successful.flatMap((entry) => mediaFromEntry(entry, input)),
    },
    quality,
  };
}

function mediaFromEntry(entry: CaptureManifestEntry, input: RenderInput): CaseStudyExport["portfolio"]["media"] {
  if (!entry.outputs) return [];
  const caption =
    input.content.captions.find((item) => item.shotId === entry.shotId)?.markdown ??
    ("caption" in entry.shot ? entry.shot.caption : "Captured project surface");
  const source = entry.shot.target;

  if (entry.outputs.mp4Path || entry.outputs.webmPath) {
    const videoPath = entry.outputs.mp4Path ?? entry.outputs.webmPath!;
    return [
      {
        type: "video",
        path: assetPath(videoPath, "videos"),
        caption,
        alt: `${input.analysis.repo.name} video capture: ${entry.shotId}`,
        shotId: entry.shotId,
        source,
      },
    ];
  }

  const imagePath = entry.outputs.webpPath ?? entry.outputs.pngPath ?? entry.outputs.posterPath;
  if (!imagePath) return [];
  return [
    {
      type: "image",
      path: assetPath(imagePath, "screenshots"),
      caption,
      alt: `${input.analysis.repo.name} screenshot: ${entry.shotId}`,
      shotId: entry.shotId,
      source,
    },
  ];
}

function assetPath(path: string, fallbackDir: "screenshots" | "videos"): string {
  const segments = path.split(/[/\\]/);
  const lastTwo = segments.slice(-2);
  if (lastTwo.length === 2 && (lastTwo[0] === "screenshots" || lastTwo[0] === "videos")) {
    return `assets/${lastTwo.join("/")}`;
  }
  return `assets/${fallbackDir}/${basename(path)}`;
}
