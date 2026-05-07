import Anthropic from "@anthropic-ai/sdk";
import {
  CapturePlanSchema,
  CaptionSchema,
  ConceptSchema,
  SummarySchema,
  TechnicalSchema,
  type Analysis,
  type CaptureManifest,
  type CapturePlan,
  type Concept,
  type GeneratedContent,
  type Summary,
  type Technical,
} from "@doceomenter/shared";
import { z } from "zod";
import { buildRepoContext } from "./context.js";
import { createFixtureClient } from "./fixture.js";
import { SYSTEM_PROMPT, USER_CONCEPT_PROMPT, USER_TECHNICAL_PROMPT } from "./prompts.js";
import { TOOL_DEFINITIONS } from "./tools.js";

export type ClaudeClientOptions = {
  apiKey?: string;
  modelPrimary?: string;
  modelFallback?: string;
  modelCheap?: string;
  /** When true, return deterministic fixture outputs without calling the API. */
  fixtureMode?: boolean;
  logger?: (line: string) => void;
};

export type ClaudeClient = {
  draftConceptAndPlan: (
    a: Analysis,
    opts: { includeVideo: boolean; outputStyle: "concise" | "standard" | "deep" },
  ) => Promise<{ concept: Concept; capturePlan: CapturePlan }>;
  draftTechnicalAndCaptions: (
    a: Analysis,
    concept: Concept,
    capturePlan: CapturePlan,
    manifest: CaptureManifest,
  ) => Promise<{ technical: Technical; captions: GeneratedContent["captions"]; summary: Summary }>;
};

const TOKEN_BUDGET = {
  conceptInput: 8000,
  conceptOutput: 4000,
  technicalInput: 12000,
  technicalOutput: 4000,
} as const;

export function createClaudeClient(opts: ClaudeClientOptions = {}): ClaudeClient {
  const log = opts.logger ?? (() => {});
  const fixture = opts.fixtureMode || (!opts.apiKey && !process.env.ANTHROPIC_API_KEY);
  if (fixture) {
    log("[claude] fixture mode (no API key) — deterministic outputs");
    return createFixtureClient();
  }

  const anthropic = new Anthropic({
    apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY!,
  });
  const modelPrimary = opts.modelPrimary ?? process.env.ANTHROPIC_MODEL_PRIMARY ?? "claude-opus-4-7";
  const modelFallback =
    opts.modelFallback ?? process.env.ANTHROPIC_MODEL_FALLBACK ?? "claude-sonnet-4-6";

  async function call(
    systemBlocks: Anthropic.Messages.TextBlockParam[],
    userText: string,
    tools: Anthropic.Messages.Tool[],
    maxTokens: number,
    toolChoice: "any" | { type: "tool"; name: string } = "any",
  ): Promise<Anthropic.Messages.Message> {
    const tryOnce = (model: string) =>
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemBlocks,
        messages: [{ role: "user", content: userText }],
        tools,
        tool_choice: toolChoice === "any" ? { type: "any" } : toolChoice,
      });

    try {
      return await tryOnce(modelPrimary);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status === 429 || e.status === 529) {
        log(`[claude] primary ${modelPrimary} rate-limited; falling back to ${modelFallback}`);
        return tryOnce(modelFallback);
      }
      throw err;
    }
  }

  function extractToolUses(message: Anthropic.Messages.Message): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (const block of message.content) {
      if (block.type === "tool_use") out.set(block.name, block.input);
    }
    return out;
  }

  function parseOrThrow<T>(name: string, schema: z.ZodSchema<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new Error(`[claude] tool ${name} returned invalid payload: ${result.error.message}`);
    }
    return result.data;
  }

  return {
    async draftConceptAndPlan(analysis, callOpts) {
      const ctx = buildRepoContext(analysis);
      const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: "text", text: SYSTEM_PROMPT },
        {
          type: "text",
          text: ctx,
          cache_control: { type: "ephemeral" },
        },
      ];
      const tools = [TOOL_DEFINITIONS.conceptTool, TOOL_DEFINITIONS.capturePlanTool];
      const userText = `${USER_CONCEPT_PROMPT}\n\nincludeVideo: ${callOpts.includeVideo}\noutputStyle: ${callOpts.outputStyle}`;
      const msg = await call(systemBlocks, userText, tools, TOKEN_BUDGET.conceptOutput);
      const uses = extractToolUses(msg);
      const concept = parseOrThrow("submit_concept", ConceptSchema, uses.get("submit_concept"));
      const capturePlan = parseOrThrow(
        "submit_capture_plan",
        CapturePlanSchema,
        uses.get("submit_capture_plan"),
      );
      return { concept, capturePlan };
    },

    async draftTechnicalAndCaptions(analysis, concept, capturePlan, manifest) {
      const ctx = buildRepoContext(analysis);
      const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
        { type: "text", text: SYSTEM_PROMPT },
        { type: "text", text: ctx, cache_control: { type: "ephemeral" } },
      ];
      const tools = [
        TOOL_DEFINITIONS.technicalTool,
        TOOL_DEFINITIONS.captionsTool,
        TOOL_DEFINITIONS.summaryTool,
      ];
      const captureManifestText = JSON.stringify(
        {
          plan: capturePlan,
          captured: manifest.entries.map((e) => ({
            shotId: e.shotId,
            kind: e.shot.kind,
            target: "target" in e.shot ? e.shot.target : "n/a",
            status: e.status,
            failureReason: e.failureReason,
          })),
        },
        null,
        2,
      );
      const userText = [
        USER_TECHNICAL_PROMPT,
        "",
        `<previous-concept>${JSON.stringify(concept, null, 2)}</previous-concept>`,
        `<capture-manifest>${captureManifestText}</capture-manifest>`,
      ].join("\n");

      const msg = await call(systemBlocks, userText, tools, TOKEN_BUDGET.technicalOutput);
      const uses = extractToolUses(msg);
      const technical = parseOrThrow(
        "submit_technical",
        TechnicalSchema,
        uses.get("submit_technical"),
      );
      const captionsRaw = uses.get("submit_captions") as { captions?: unknown[] } | undefined;
      const captions = (captionsRaw?.captions ?? []).map((c) =>
        parseOrThrow("submit_captions[]", CaptionSchema, c),
      );
      const summary = parseOrThrow("submit_summary", SummarySchema, uses.get("submit_summary"));
      return { technical, captions, summary };
    },
  };
}
