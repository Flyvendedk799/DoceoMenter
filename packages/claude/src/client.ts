import {
  CaseBriefSchema,
  CapturePlanSchema,
  CaptionSchema,
  ConceptSchema,
  SummarySchema,
  TechnicalSchema,
  type Analysis,
  type AiProvider,
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
import {
  createTransport,
  ProviderCallError,
  type Conversation,
  type SystemBlock,
  type Tool,
  type Transport,
  type WireCredential,
} from "./transport.js";

export type ClaudeClientOptions = {
  /** How the run is paid for. Defaults to an Anthropic API key. */
  provider?: AiProvider;
  /**
   * The credential itself, already resolved.
   *
   * The worker asks `@doceomenter/auth` for this at the moment it needs it rather than being
   * handed one at enqueue time, because a subscription's access token is refreshed on the way
   * out and a token that was fresh when the job was queued may not be when it runs.
   */
  credential?: WireCredential;
  /** A bare API key for the provider's wire. Convenience for callers that have nothing else. */
  apiKey?: string;
  modelPrimary?: string;
  modelFallback?: string;
  /** When true, return deterministic fixture outputs without calling the API. */
  fixtureMode?: boolean;
  logger?: (line: string) => void;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  /** What this app calls the place credentials are changed, named in error messages. */
  configureAt?: string;
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

const DEFAULT_MODELS: Record<AiProvider, { primary: string; fallback: string }> = {
  anthropic: { primary: "claude-opus-5", fallback: "claude-sonnet-5" },
  "claude-code": { primary: "claude-opus-5", fallback: "claude-sonnet-5" },
  openai: { primary: "gpt-5", fallback: "gpt-5-mini" },
  codex: { primary: "gpt-5", fallback: "gpt-5-mini" },
};

export function createClaudeClient(opts: ClaudeClientOptions = {}): ClaudeClient {
  const log = opts.logger ?? (() => {});
  const provider: AiProvider = opts.provider ?? "anthropic";
  const credential = resolveCredential(provider, opts);

  if (opts.fixtureMode || !credential) {
    log(`[${provider}] fixture mode (no credential) — deterministic outputs`);
    return createFixtureClient();
  }

  const defaults = DEFAULT_MODELS[provider];
  const transport = createTransport({
    provider,
    credential,
    modelPrimary: opts.modelPrimary || defaults.primary,
    modelFallback: opts.modelFallback || defaults.fallback,
    logger: log,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.configureAt ? { configureAt: opts.configureAt } : {}),
  });

  return createGeneratingClient(transport, log);
}

/**
 * What to call the provider with.
 *
 * A resolved credential wins. Failing that, a bare key is taken for the provider's own wire,
 * and then the environment — which is the last resort rather than the first, so an operator's
 * exported key never quietly outranks a credential the caller passed in.
 *
 * Null means "nothing to call with", and for the two metered providers that is the long-
 * standing fixture-mode signal rather than an error: DoceoMenter is expected to run its own
 * tests and its own demo without a key. A subscription provider has no such fallback — asking
 * for a plan and silently getting fixtures would be a lie — so it throws instead.
 */
function resolveCredential(
  provider: AiProvider,
  opts: ClaudeClientOptions,
): WireCredential | null {
  if (opts.credential) return opts.credential;

  if (provider === "claude-code" || provider === "codex") {
    throw new Error(
      `[${provider}] no credential was resolved. A subscription run needs a connected account or a machine login.`,
    );
  }

  const wire = provider === "openai" ? "openai" : "anthropic";
  const key =
    opts.apiKey?.trim() ||
    (wire === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY)?.trim();
  return key ? { kind: "key", wire, key } : null;
}

type ToolSpec = { name: string; schema: z.ZodSchema<unknown>; required: boolean };

function createGeneratingClient(transport: Transport, log: (line: string) => void): ClaudeClient {
  const label = transport.provider;

  function parseOrThrow<T>(name: string, schema: z.ZodSchema<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new Error(`[${label}] tool ${name} returned invalid payload: ${result.error.message}`);
    }
    return result.data;
  }

  /**
   * Call the model and keep the collected tool outputs. If a *required* tool is
   * missing, fails schema validation, the response was truncated, or one tool
   * call was cut off, feed the specific problem back and retry (bounded). This
   * turns transient model mistakes into a self-correcting loop instead of a hard
   * pipeline crash. Refusals are surfaced explicitly.
   *
   * The repair turn itself is the transport's problem: every provider refuses a follow-up that
   * does not answer *all* of the calls the previous turn made, and each wants that written a
   * different way — see the note on `Conversation`.
   */
  async function gather(
    conversation: Conversation,
    initialUser: string,
    specs: ToolSpec[],
  ): Promise<Map<string, unknown>> {
    const collected = new Map<string, unknown>();
    const MAX_ATTEMPTS = 3;
    let ask = initialUser;
    let lastIssue = "";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const turn = await conversation.ask(ask);
      if (turn.refusal) throw new Error(`[${label}] model declined to respond (refusal)`);

      for (const call of turn.calls) {
        // On duplicate tool calls, keep the first (most-considered) one.
        if (!collected.has(call.name)) collected.set(call.name, call.input);
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
          problems.push(
            `'${spec.name}' had invalid arguments: ${res.error.issues[0]?.message ?? "invalid"}`,
          );
        }
      }
      // If every required tool is present and valid we are done — a trailing
      // `max_tokens` stop only matters when something is actually missing.
      if (problems.length === 0) return collected;

      lastIssue = problems.join("; ") || (turn.truncated ? "response was truncated" : "");
      if (attempt === MAX_ATTEMPTS - 1) break;
      log(`[${label}] retrying ${transport.currentModel()}: ${lastIssue}`);

      ask = turn.truncated
        ? "Your previous response was cut off. Call all the required tools again with complete, valid arguments."
        : `Please fix the following and call the required tools again with valid arguments: ${lastIssue}.`;
    }

    throw new Error(
      `[${label}] could not obtain valid tool outputs after ${MAX_ATTEMPTS} attempts: ${lastIssue}`,
    );
  }

  return {
    async draftConceptAndPlan(analysis, callOpts) {
      const system = systemBlocks(analysis);
      const tools: Tool[] = [TOOL_DEFINITIONS.conceptTool, TOOL_DEFINITIONS.capturePlanTool];
      const userText = `${USER_CONCEPT_PROMPT}\n\nincludeVideo: ${callOpts.includeVideo}\noutputStyle: ${callOpts.outputStyle}`;
      const uses = await gather(
        transport.start(system, tools, TOKEN_BUDGET.conceptOutput),
        userText,
        [
          { name: "submit_concept", schema: ConceptSchema, required: true },
          { name: "submit_capture_plan", schema: CapturePlanSchema, required: true },
        ],
      );
      return {
        concept: parseOrThrow("submit_concept", ConceptSchema, uses.get("submit_concept")),
        capturePlan: parseOrThrow(
          "submit_capture_plan",
          CapturePlanSchema,
          uses.get("submit_capture_plan"),
        ),
      };
    },

    async draftTechnicalAndCaptions(analysis, concept, capturePlan, manifest) {
      const system = systemBlocks(analysis);
      const tools: Tool[] = [
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
      const uses = await gather(
        transport.start(system, tools, TOKEN_BUDGET.technicalOutput),
        userText,
        [
          { name: "submit_technical", schema: TechnicalSchema, required: true },
          { name: "submit_case_brief", schema: CaseBriefSchema, required: true },
          { name: "submit_summary", schema: SummarySchema, required: true },
          // Captions are best-effort — a missing/partial set degrades gracefully.
          { name: "submit_captions", schema: captionsWrapper, required: false },
        ],
      );
      const captionsParsed = captionsWrapper.safeParse(uses.get("submit_captions"));
      return {
        technical: parseOrThrow("submit_technical", TechnicalSchema, uses.get("submit_technical")),
        caseBrief: parseOrThrow("submit_case_brief", CaseBriefSchema, uses.get("submit_case_brief")),
        captions: captionsParsed.success ? captionsParsed.data.captions : [],
        summary: parseOrThrow("submit_summary", SummarySchema, uses.get("submit_summary")),
      };
    },
  };
}

/**
 * The instructions, then the repository.
 *
 * Two blocks rather than one so the repo context can carry a cache breakpoint: it is the long,
 * unchanging half and both passes send it. On a subscription the transport puts the Claude Code
 * identity in front of these — its own block, uncached, first — which is the one arrangement
 * Anthropic accepts.
 */
function systemBlocks(analysis: Analysis): SystemBlock[] {
  return [
    { type: "text", text: SYSTEM_PROMPT },
    { type: "text", text: buildRepoContext(analysis), cache_control: { type: "ephemeral" } },
  ];
}

export { ProviderCallError };
export type { WireCredential };
