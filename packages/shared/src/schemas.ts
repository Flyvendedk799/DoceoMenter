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
export const AI_PROVIDERS = [
  "anthropic",
  "claude-code",
  "openai",
  "codex",
  "gemini",
  "gemini-cli",
] as const;
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

const DEFAULT_VIEWPORT = { w: 1440, h: 900 } as const;
const DEFAULT_VIDEO_MS = 8_000;

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

const ImportanceSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const KIND_ALIASES: Record<string, string> = {
  screenshot: "screenshot",
  image: "screenshot",
  screen: "screenshot",
  still: "screenshot",
  photo: "screenshot",
  video: "video",
  recording: "video",
  clip: "video",
};

const TARGET_ALIASES: Record<string, string> = {
  "live-app": "live-app",
  live_app: "live-app",
  liveapp: "live-app",
  app: "live-app",
  ui: "live-app",
  frontend: "live-app",
  "github-readme": "github-readme",
  github_readme: "github-readme",
  readme: "github-readme",
  // Gemini invents file-shot targets (c71f7cb4085c shots.3) — map to readme capture.
  code: "github-readme",
  "code-snippet": "github-readme",
  codesnippet: "github-readme",
  source: "github-readme",
  "source-file": "github-readme",
  "code-architecture": "code-architecture",
  code_architecture: "code-architecture",
  architecture: "code-architecture",
  diagram: "code-architecture",
  mermaid: "code-architecture",
};

const INTERACTION_DO: Record<string, string> = {
  click: "click",
  fill: "fill",
  type: "fill",
  input: "fill",
  hover: "hover",
  scrollto: "scrollTo",
  scroll: "scrollTo",
  wait: "wait",
  sleep: "wait",
  delay: "wait",
  pause: "wait",
  press: "press",
  key: "press",
  keypress: "press",
};

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function coerceInteraction(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const it: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const rawDo = String(it.do ?? it.action ?? it.type ?? it.op ?? "")
    .trim()
    .toLowerCase();
  const mapped = INTERACTION_DO[rawDo];
  if (!mapped) return null;
  it.do = mapped;
  delete it.action;
  delete it.type;
  delete it.op;

  const ms = asFiniteNumber(it.ms);
  if (ms !== undefined) it.ms = Math.min(10_000, Math.max(0, Math.round(ms)));

  if (mapped === "wait" && (it.ms === undefined || it.ms === null)) it.ms = 500;
  if (mapped === "fill" && typeof it.text !== "string") {
    it.text = typeof it.value === "string" ? it.value : "";
  }
  if (mapped === "press" && typeof it.key !== "string") {
    it.key = typeof it.value === "string" ? it.value : "Enter";
  }
  if (
    (mapped === "click" || mapped === "fill" || mapped === "hover" || mapped === "scrollTo") &&
    typeof it.selector !== "string"
  ) {
    it.selector = "body";
  }
  return it;
}

function coerceInteractionList(list: unknown): Record<string, unknown>[] | undefined {
  if (list === undefined || list === null) return undefined;
  const arr = Array.isArray(list) ? list : [list];
  const out = arr.map(coerceInteraction).filter((x): x is Record<string, unknown> => x !== null);
  return out;
}

/**
 * Coerce quirks common from Antigravity / Gemini tool JSON before Zod:
 * stringy numbers, omitted viewport / maxDurationMs, aliases for kind/target,
 * invented interaction verbs, and slightly messy shot ids. Without this, Zod
 * unions collapse to opaque "Invalid input" (runs ca2585f3357f, 79c6c7cbc18c).
 */
export function normalizeShotInput(raw: unknown): unknown {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return raw;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const s: Record<string, unknown> = { ...(value as Record<string, unknown>) };

  if (typeof s.id === "string") {
    const cleaned = s.id
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    s.id = cleaned.length > 0 ? cleaned : "shot";
  } else if (s.id === undefined || s.id === null) {
    s.id = "shot";
  } else {
    s.id = String(s.id)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "shot";
  }

  // Gemini often uses media/isVideo instead of kind (ServerHoster run 4365360911b5).
  if (s.kind === undefined || s.kind === null) {
    if (s.isVideo === true || s.is_video === true) s.kind = "video";
    else if (typeof s.media === "string") s.kind = s.media;
  }
  if (typeof s.kind === "string") {
    const key = s.kind.trim().toLowerCase().replace(/\s+/g, "");
    s.kind = KIND_ALIASES[key] ?? s.kind.trim().toLowerCase();
  }
  if (typeof s.target === "string") {
    const key = s.target.trim().toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
    const compact = key.replace(/-/g, "");
    s.target =
      TARGET_ALIASES[key] ??
      TARGET_ALIASES[compact] ??
      s.target.trim().toLowerCase();
  }
  if (typeof s.mermaid === "string" && s.diagramSpec === undefined) {
    s.diagramSpec = s.mermaid;
  }
  if (
    (s.target === undefined || s.target === null) &&
    (typeof s.diagramSpec === "string" ||
      (s.diagramSpec && typeof s.diagramSpec === "object") ||
      typeof s.mermaid === "string")
  ) {
    s.target = "code-architecture";
  }
  if (s.kind === undefined || s.kind === null) {
    s.kind = "screenshot";
  }
  if (s.target === "code-architecture") {
    s.kind = "screenshot";
  }
  if (s.target === "github-readme") {
    s.kind = "screenshot";
  }

  const importance = asFiniteNumber(s.importance);
  if (importance !== undefined) {
    s.importance = Math.min(3, Math.max(1, Math.round(importance)));
  } else if (s.importance === undefined || s.importance === null) {
    s.importance = 2;
  }

  if (s.viewport && typeof s.viewport === "object" && !Array.isArray(s.viewport)) {
    const v = { ...(s.viewport as Record<string, unknown>) };
    if (v.w === undefined && v.width !== undefined) v.w = v.width;
    if (v.h === undefined && v.height !== undefined) v.h = v.height;
    const w = asFiniteNumber(v.w);
    const h = asFiniteNumber(v.h);
    if (w !== undefined) v.w = w;
    if (h !== undefined) v.h = h;
    s.viewport = v;
  }

  if (typeof s.route !== "string" || s.route.trim() === "") {
    if (s.target === "live-app") s.route = "/";
  } else if (!s.route.startsWith("/")) {
    s.route = `/${s.route}`;
  }

  if (typeof s.caption !== "string" || s.caption.trim() === "") {
    const fromTitle = typeof s.title === "string" ? s.title.trim() : "";
    const fromDesc = typeof s.description === "string" ? s.description.trim() : "";
    s.caption = fromDesc || fromTitle || (typeof s.id === "string" ? s.id : "Capture");
  }

  if (typeof s.fullPage === "string") {
    const t = s.fullPage.trim().toLowerCase();
    if (t === "true" || t === "1" || t === "yes") s.fullPage = true;
    else if (t === "false" || t === "0" || t === "no") s.fullPage = false;
  }

  if (typeof s.diagramSpec === "string") {
    s.diagramSpec = { mermaid: s.diagramSpec };
  } else if (s.diagramSpec && typeof s.diagramSpec === "object" && !Array.isArray(s.diagramSpec)) {
    const d = { ...(s.diagramSpec as Record<string, unknown>) };
    if (typeof d.mermaid !== "string" && typeof d.diagram === "string") d.mermaid = d.diagram;
    if (typeof d.mermaid === "string" && d.mermaid.trim().length < 10) {
      d.mermaid = `${d.mermaid.trim()}\n%% padded`;
    }
    s.diagramSpec = d;
  }
  if (
    s.target === "code-architecture" &&
    (s.diagramSpec === undefined || s.diagramSpec === null)
  ) {
    s.diagramSpec = { mermaid: "flowchart TD\n  A[App] --> B[Core]" };
  }

  if (s.kind === "screenshot" && s.target === "live-app" && (s.viewport === undefined || s.viewport === null)) {
    s.viewport = { ...DEFAULT_VIEWPORT };
  }

  const maxMs = asFiniteNumber(s.maxDurationMs);
  if (maxMs !== undefined) s.maxDurationMs = Math.min(30_000, Math.max(2_000, Math.round(maxMs)));
  if (s.kind === "video" && (s.maxDurationMs === undefined || s.maxDurationMs === null)) {
    s.maxDurationMs = DEFAULT_VIDEO_MS;
  }

  if (s.interactions !== undefined) {
    const list = coerceInteractionList(s.interactions);
    s.interactions = list && list.length > 0 ? list : undefined;
  }
  if (s.script !== undefined) {
    const list = coerceInteractionList(s.script);
    s.script = list && list.length > 0 ? list : undefined;
  }
  if (s.kind === "video" && (!Array.isArray(s.script) || s.script.length === 0)) {
    s.script = [{ do: "wait", ms: 1000 }];
  }

  return s;
}

function shotsFromUnknown(raw: unknown): unknown[] | undefined {
  if (typeof raw === "string") {
    try {
      return shotsFromUnknown(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const values = Object.values(raw as Record<string, unknown>);
    if (values.length > 0 && values.every((v) => v && typeof v === "object")) return values;
  }
  return undefined;
}

export function normalizeCapturePlanInput(raw: unknown): unknown {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return raw;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const o = { ...(value as Record<string, unknown>) };
  const shots = shotsFromUnknown(o.shots);
  if (shots) {
    o.shots = shots.map(normalizeShotInput).slice(0, 10);
  }
  return o;
}

export const ShotSchema = z.union([
  z.object({
    id: ShotIdSchema,
    kind: z.literal("screenshot"),
    target: z.literal("live-app"),
    route: z.string(),
    viewport: ViewportSchema.default(DEFAULT_VIEWPORT),
    waitFor: z.string().optional(),
    interactions: z.array(InteractionSchema).optional(),
    fullPage: z.boolean().optional(),
    caption: z.string(),
    importance: ImportanceSchema,
  }),
  z.object({
    id: ShotIdSchema,
    kind: z.literal("screenshot"),
    target: z.literal("github-readme"),
    section: z.string().optional(),
    caption: z.string(),
    importance: ImportanceSchema,
  }),
  z.object({
    id: ShotIdSchema,
    kind: z.literal("screenshot"),
    target: z.literal("code-architecture"),
    diagramSpec: z.object({
      mermaid: z.string().min(10),
    }),
    caption: z.string(),
    importance: ImportanceSchema,
  }),
  z.object({
    id: ShotIdSchema,
    kind: z.literal("video"),
    target: z.literal("live-app"),
    route: z.string(),
    script: z.array(InteractionSchema).min(1),
    maxDurationMs: z.number().int().min(2000).max(30_000).default(DEFAULT_VIDEO_MS),
    caption: z.string(),
  }),
]);
export type Shot = z.infer<typeof ShotSchema>;

const CapturePlanObjectSchema = z.object({
  shots: z.array(ShotSchema).min(1).max(10),
});
export type CapturePlan = z.infer<typeof CapturePlanObjectSchema>;

/** Preprocess + object schema. Explicit `ZodType` so `z.preprocess` does not widen output to `unknown`. */
export const CapturePlanSchema: z.ZodType<CapturePlan> = z.preprocess(
  normalizeCapturePlanInput,
  CapturePlanObjectSchema,
) as z.ZodType<CapturePlan>;

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
