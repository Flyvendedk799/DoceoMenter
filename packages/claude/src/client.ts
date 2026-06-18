import Anthropic from "@anthropic-ai/sdk";
import {
  CaseBriefSchema,
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
  ) => Promise<{
    technical: Technical;
    caseBrief: GeneratedContent["caseBrief"];
    captions: GeneratedContent["captions"];
    summary: Summary;
  }>;
};

const TOKEN_BUDGET = {
  conceptInput: 8000,
  conceptOutput: 6000,
  technicalInput: 12000,
  // The technical pass emits four tool calls (technical + case brief + captions
  // + summary), the largest of which is the case brief — 4000 risks truncating
  // a tool call mid-JSON.
  technicalOutput: 8000,
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
  const modelPrimary = opts.modelPrimary ?? process.env.ANTHROPIC_MODEL_PRIMARY ?? "claude-opus-4-8";
  const modelFallback =
    opts.modelFallback ?? process.env.ANTHROPIC_MODEL_FALLBACK ?? "claude-sonnet-4-6";

  // Retryable HTTP statuses: rate limit (429), overloaded (529), transient 5xx.
  const RETRYABLE = new Set([429, 500, 502, 503, 529]);

  async function call(
    systemBlocks: Anthropic.Messages.TextBlockParam[],
    messages: Anthropic.Messages.MessageParam[],
    tools: Anthropic.Messages.Tool[],
    maxTokens: number,
  ): Promise<Anthropic.Messages.Message> {
    const tryOnce = (model: string) =>
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemBlocks,
        messages,
        tools,
        tool_choice: { type: "any" },
      });

    try {
      return await tryOnce(modelPrimary);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status !== undefined && RETRYABLE.has(e.status)) {
        log(`[claude] primary ${modelPrimary} failed (${e.status}); falling back to ${modelFallback}`);
        try {
          return await tryOnce(modelFallback);
        } catch (err2: unknown) {
          const e2 = err2 as { status?: number; message?: string };
          throw new Error(
            `[claude] both ${modelPrimary} and ${modelFallback} failed: ${e2.message ?? e2.status ?? "unknown"}`,
          );
        }
      }
      throw err;
    }
  }

  function extractToolUses(message: Anthropic.Messages.Message): Map<string, unknown> {
    const out = new Map<string, unknown>();
    for (const block of message.content) {
      // On duplicate tool calls, keep the first (most-considered) one.
      if (block.type === "tool_use" && !out.has(block.name)) out.set(block.name, block.input);
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

  type ToolSpec = { name: string; schema: z.ZodSchema<unknown>; required: boolean };

  /**
   * Call the model and keep the collected tool outputs. If a *required* tool is
   * missing, fails schema validation, the response was truncated, or one tool
   * call was cut off, feed the specific problem back and retry (bounded). This
   * turns transient model mistakes into a self-correcting loop instead of a hard
   * pipeline crash. Refusals are surfaced explicitly.
   */
  async function gather(
    systemBlocks: Anthropic.Messages.TextBlockParam[],
    initialUser: string,
    tools: Anthropic.Messages.Tool[],
    maxTokens: number,
    specs: ToolSpec[],
  ): Promise<Map<string, unknown>> {
    const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: initialUser }];
    const collected = new Map<string, unknown>();
    const MAX_ATTEMPTS = 3;
    let lastIssue = "";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const msg = await call(systemBlocks, messages, tools, maxTokens);
      if (msg.stop_reason === "refusal") {
        throw new Error("[claude] model declined to respond (refusal)");
      }
      for (const [name, input] of extractToolUses(msg)) {
        if (!collected.has(name)) collected.set(name, input);
      }

      const problems: string[] = [];
      for (const spec of specs) {
        if (!spec.required) continue;
        if (!collected.has(spec.name)) {
          problems.push(`'${spec.name}' was not called`);
          continue;
        }
        const res = spec.schema.safeParse(collected.get(spec.name));
        if (!res.success) {
          // Drop the invalid payload so a corrected re-call can replace it.
          collected.delete(spec.name);
          problems.push(`'${spec.name}' had invalid arguments: ${res.error.issues[0]?.message ?? "invalid"}`);
        }
      }
      // If every required tool is present and valid we are done — a trailing
      // `max_tokens` stop only matters when something is actually missing.
      if (problems.length === 0) return collected;

      const truncated = msg.stop_reason === "max_tokens";
      lastIssue = problems.join("; ") || (truncated ? "response was truncated" : "");
      if (attempt === MAX_ATTEMPTS - 1) break;

      // Build a valid repair turn: echo the assistant message, satisfy every
      // tool_use with a tool_result, then state precisely what to fix.
      messages.push({ role: "assistant", content: msg.content });
      const toolResults = msg.content
        .filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ type: "tool_result" as const, tool_use_id: b.id, content: "received" }));
      const ask = truncated
        ? "Your previous response was cut off. Call all the required tools again with complete, valid arguments."
        : `Please fix the following and call the required tools again with valid arguments: ${lastIssue}.`;
      const content: Anthropic.Messages.ContentBlockParam[] = toolResults.length
        ? [...toolResults, { type: "text", text: ask }]
        : [{ type: "text", text: ask }];
      messages.push({ role: "user", content });
    }

    throw new Error(`[claude] could not obtain valid tool outputs after ${MAX_ATTEMPTS} attempts: ${lastIssue}`);
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
      const uses = await gather(systemBlocks, userText, tools, TOKEN_BUDGET.conceptOutput, [
        { name: "submit_concept", schema: ConceptSchema, required: true },
        { name: "submit_capture_plan", schema: CapturePlanSchema, required: true },
      ]);
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
        TOOL_DEFINITIONS.caseBriefTool,
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

      const captionsWrapper = z.object({ captions: z.array(CaptionSchema) });
      const uses = await gather(systemBlocks, userText, tools, TOKEN_BUDGET.technicalOutput, [
        { name: "submit_technical", schema: TechnicalSchema, required: true },
        { name: "submit_case_brief", schema: CaseBriefSchema, required: true },
        { name: "submit_summary", schema: SummarySchema, required: true },
        // Captions are best-effort — a missing/partial set degrades gracefully.
        { name: "submit_captions", schema: captionsWrapper, required: false },
      ]);
      const technical = parseOrThrow(
        "submit_technical",
        TechnicalSchema,
        uses.get("submit_technical"),
      );
      const caseBrief = parseOrThrow(
        "submit_case_brief",
        CaseBriefSchema,
        uses.get("submit_case_brief"),
      );
      const captionsParsed = captionsWrapper.safeParse(uses.get("submit_captions"));
      const captions = captionsParsed.success ? captionsParsed.data.captions : [];
      const summary = parseOrThrow("submit_summary", SummarySchema, uses.get("submit_summary"));
      return { technical, caseBrief, captions, summary };
    },
  };
}
