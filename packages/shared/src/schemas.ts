import { z } from "zod";

export const RunSpecSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (s) => /^https?:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/.test(s),
      "URL must be of the form https://github.com/<owner>/<repo>",
    ),
  ref: z.string().min(1).max(120).optional(),
  outputStyle: z.enum(["concise", "standard", "deep"]).optional(),
  includeVideo: z.boolean().optional(),
  bootApp: z.boolean().optional(),
  apiKey: z.string().min(1).optional(),
});
export type RunSpec = z.infer<typeof RunSpecSchema>;

export const RUN_SPEC_DEFAULTS = {
  ref: "main" as const,
  outputStyle: "standard" as const,
  includeVideo: true,
  bootApp: true,
};

export type ResolvedRunSpec = Required<
  Pick<RunSpec, "ref" | "outputStyle" | "includeVideo" | "bootApp">
> &
  Pick<RunSpec, "url" | "apiKey">;

export function resolveRunSpec(spec: RunSpec): ResolvedRunSpec {
  return {
    url: spec.url,
    ref: spec.ref ?? RUN_SPEC_DEFAULTS.ref,
    outputStyle: spec.outputStyle ?? RUN_SPEC_DEFAULTS.outputStyle,
    includeVideo: spec.includeVideo ?? RUN_SPEC_DEFAULTS.includeVideo,
    bootApp: spec.bootApp ?? RUN_SPEC_DEFAULTS.bootApp,
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

export const ShotSchema = z.union([
  z.object({
    id: z.string(),
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
    id: z.string(),
    kind: z.literal("screenshot"),
    target: z.literal("github-readme"),
    section: z.string().optional(),
    caption: z.string(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("screenshot"),
    target: z.literal("code-architecture"),
    diagramSpec: z.object({
      mermaid: z.string().min(10),
    }),
    caption: z.string(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({
    id: z.string(),
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
