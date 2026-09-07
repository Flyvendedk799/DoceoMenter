import { z } from "zod";

/** A git ref (branch, tag, or commit SHA) safe to pass as an argv operand. */
export const GitRefSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[A-Za-z0-9._/-]+$/,
    "ref may only contain letters, numbers, '.', '_', '/' and '-'",
  )
  .refine((s) => !s.startsWith("-") && !s.includes(".."), "invalid ref");

/**
 * How a run is paid for.
 *
 * These are `ai-auth`'s provider ids, and the split they make is the one worth keeping: a
 * provider is not the same question as the wire it speaks. `claude-code` and `anthropic` both
 * talk to the Messages API, but the first bills a person's plan and the second bills a card,
 * and the credential each needs has nothing in common with the other's.
 *
 * `"claude"` is the id this app used before the two were distinguished, and it meant an
 * Anthropic API key. Runs persisted then still parse, as that.
 */
export const AI_PROVIDERS = ["anthropic", "claude-code", "openai", "codex"] as const;
export const AiProviderSchema = z.preprocess(
  (value) => (value === "claude" ? "anthropic" : value),
  z.enum(AI_PROVIDERS),
);
export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * A model id, checked for shape only.
 *
 * Which ids exist is the registry's business, and it moves faster than this schema should: a
 * hard-coded enum here would reject a model the provider shipped this morning. The characters
 * are constrained because the value reaches a URL and a log line.
 */
export const ModelIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, "invalid model id");

export const RunSpecSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (s) => /^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/.test(s),
      "URL must be of the form https://github.com/<owner>/<repo>",
    ),
  ref: GitRefSchema.optional(),
  outputStyle: z.enum(["concise", "standard", "deep"]).optional(),
  includeVideo: z.boolean().optional(),
  bootApp: z.boolean().optional(),
  provider: AiProviderSchema.optional(),
  model: ModelIdSchema.optional(),
  apiKey: z.string().min(1).max(400).optional(),
});
export type RunSpec = z.infer<typeof RunSpecSchema>;

export const RUN_SPEC_DEFAULTS = {
  ref: "main" as const,
  outputStyle: "standard" as const,
  includeVideo: true,
  bootApp: true,
  provider: "anthropic" as const,
};

export type ResolvedRunSpec = Required<
  Pick<RunSpec, "ref" | "outputStyle" | "includeVideo" | "bootApp" | "provider">
> &
  Pick<RunSpec, "url" | "apiKey" | "model">;

/**
 * A run id is exactly the 12 lowercase-hex chars produced by
 * `randomBytes(6).toString("hex")`. Validate before any value reaches the
 * filesystem so a crafted id (`../`, absolute path) can never escape the data
 * root.
 */
export const RUN_ID_RE = /^[0-9a-f]{12}$/;
export function isValidRunId(id: string): boolean {
  return RUN_ID_RE.test(id);
}

/**
 * Strip the BYOK provider key from a spec before it is persisted to disk or
 * returned to a client. The worker reads the live key from the in-memory job
 * payload, never from persisted run state.
 */
export function redactSpec(spec: RunSpec): RunSpec {
  if (spec.apiKey === undefined) return spec;
  const { apiKey: _omit, ...rest } = spec;
  return rest;
}

export function resolveRunSpec(spec: RunSpec): ResolvedRunSpec {
  return {
    url: spec.url,
    ref: spec.ref ?? RUN_SPEC_DEFAULTS.ref,
    outputStyle: spec.outputStyle ?? RUN_SPEC_DEFAULTS.outputStyle,
    includeVideo: spec.includeVideo ?? RUN_SPEC_DEFAULTS.includeVideo,
    bootApp: spec.bootApp ?? RUN_SPEC_DEFAULTS.bootApp,
    provider: spec.provider ?? RUN_SPEC_DEFAULTS.provider,
    model: spec.model,
    apiKey: spec.apiKey,
  };
}

export const InteractionSchema = z.union([
  z.object({ do: z.literal("click"), selector: z.string() }),
  z.object({ do: z.literal("fill"), selector: z.string(), text: z.string() }),
  z.object({ do: z.literal("hover"), selector: z.string() }),
  z.object({ do: z.literal("scrollTo"), selector: z.string() }),
  z.object({ do: z.literal("wait"), ms: z.number().int().min(0).max(10_000) }),
  z.object({ do: z.literal("press"), key: z.string() }),
]);
export type Interaction = z.infer<typeof InteractionSchema>;

const ViewportSchema = z.object({
  w: z.number().int().min(320).max(3840),
  h: z.number().int().min(240).max(2160),
});

/**
 * Shot ids become on-disk filenames and are interpolated into HTML/Markdown
 * asset references, so they must be restricted to a path- and markup-safe
 * charset (no quotes, slashes, angle brackets, whitespace).
 */
export const ShotIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/, "shot id must match [A-Za-z0-9._-]");

export const ShotSchema = z.union([
  z.object({
    id: ShotIdSchema,
    kind: z.literal("screenshot"),
    target: z.literal("live-app"),
    route: z.string(),
    viewport: ViewportSchema,
    waitFor: z.string().optional(),
    interactions: z.array(InteractionSchema).optional(),
    fullPage: z.boolean().optional(),
    caption: z.string(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({
    id: ShotIdSchema,
    kind: z.literal("screenshot"),
    target: z.literal("github-readme"),
    section: z.string().optional(),
    caption: z.string(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({
    id: ShotIdSchema,
    kind: z.literal("screenshot"),
    target: z.literal("code-architecture"),
    diagramSpec: z.object({
      mermaid: z.string().min(10),
    }),
    caption: z.string(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({
    id: ShotIdSchema,
    kind: z.literal("video"),
    target: z.literal("live-app"),
    route: z.string(),
    script: z.array(InteractionSchema).min(1),
    maxDurationMs: z.number().int().min(2000).max(30_000),
    caption: z.string(),
  }),
]);
export type Shot = z.infer<typeof ShotSchema>;

export const CapturePlanSchema = z.object({ shots: z.array(ShotSchema).min(1).max(10) });
export type CapturePlan = z.infer<typeof CapturePlanSchema>;

export const ConceptSchema = z.object({
  what: z.string().min(40),
  why: z.string().min(40),
  vision: z.string().min(20),
  audience: z.array(z.string()).min(1).max(5),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const TechnicalSchema = z.object({
  stack: z
    .array(z.object({ technology: z.string(), evidence: z.string() }))
    .min(1),
  architecture: z.string().min(40),
  dataFlow: z.string().min(20),
  keyModules: z
    .array(
      z.object({
        path: z.string(),
        role: z.string(),
        oneLineSummary: z.string(),
        citations: z.array(z.string()),
      }),
    )
    .min(1)
    .max(8),
  gettingStarted: z.array(z.string()).min(1),
});
export type Technical = z.infer<typeof TechnicalSchema>;

export const SummarySchema = z.object({
  oneLiner: z.string().min(3).max(140),
  tldr: z.array(z.string()).length(3),
});
export type Summary = z.infer<typeof SummarySchema>;

export const CaptionSchema = z.object({
  shotId: z.string(),
  markdown: z.string().min(5).max(500),
});
export type Caption = z.infer<typeof CaptionSchema>;

export const EvidenceConfidenceSchema = z.enum(["high", "medium", "low"]);

export const CaseBriefSchema = z.object({
  problem: z.string().min(40),
  productNarrative: z.string().min(60),
  audienceFit: z
    .array(
      z.object({
        audience: z.string().min(2),
        need: z.string().min(10),
        evidence: z.string().min(3),
      }),
    )
    .min(1)
    .max(5),
  evidence: z
    .array(
      z.object({
        claim: z.string().min(10),
        source: z.string().min(3),
        confidence: EvidenceConfidenceSchema,
      }),
    )
    .min(1)
    .max(8),
  mediaPlan: z
    .array(
      z.object({
        surface: z.string().min(2),
        purpose: z.string().min(10),
        captureId: z.string().optional(),
        evidence: z.string().min(3),
      }),
    )
    .min(1)
    .max(8),
  auditMetrics: z
    .array(
      z.object({
        label: z.string().min(2),
        value: z.string().min(1),
        evidence: z.string().min(3),
      }),
    )
    .min(1)
    .max(8),
  risksAndGaps: z
    .array(
      z.object({
        gap: z.string().min(6),
        impact: z.string().min(10),
        recommendation: z.string().min(10),
      }),
    )
    .min(1)
    .max(6),
});
export type CaseBrief = z.infer<typeof CaseBriefSchema>;

export const QualityCheckStatusSchema = z.enum(["pass", "degraded", "fail"]);

export const QualityReportSchema = z.object({
  status: QualityCheckStatusSchema,
  summary: z.string().min(10),
  checks: z
    .array(
      z.object({
        id: z.string().min(2),
        label: z.string().min(3),
        status: QualityCheckStatusSchema,
        detail: z.string().min(5),
        evidence: z.string().optional(),
      }),
    )
    .min(1),
  recommendations: z.array(z.string()).max(10),
});
export type QualityReport = z.infer<typeof QualityReportSchema>;

export const CaseStudyExportSchema = z.object({
  schemaVersion: z.literal("doceomenter.case-study.v1"),
  generatedAt: z.string(),
  repository: z.object({
    owner: z.string(),
    name: z.string(),
    ref: z.string(),
    commitSha: z.string(),
  }),
  portfolio: z.object({
    title: z.string(),
    description: z.string(),
    longDescription: z.string(),
    challenge: z.string(),
    approach: z.string(),
    tags: z.array(z.string()),
    techStack: z.array(z.string()),
    metrics: z.array(z.object({ label: z.string(), value: z.string(), evidence: z.string() })),
    media: z.array(
      z.object({
        type: z.enum(["image", "video"]),
        path: z.string(),
        caption: z.string(),
        alt: z.string(),
        shotId: z.string(),
        source: z.string(),
      }),
    ),
  }),
  quality: QualityReportSchema,
});
export type CaseStudyExport = z.infer<typeof CaseStudyExportSchema>;
