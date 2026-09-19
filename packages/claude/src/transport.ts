/**
 * One conversation, four wires.
 *
 * The generation loop above this file is the same whichever provider is paying: send a prompt,
 * collect tool calls, and if a required one is missing or malformed, answer every call that
 * was made and say precisely what to fix. What differs between providers is only the shape of
 * those three things on the wire — and, for a subscription, a handful of details that are each
 * individually tiny and each cost a day to find out. Those live here so the loop never has to
 * know which of the six ways of paying is in play.
 *
 * The conversation owns its own history rather than being handed one, because the repair turn
 * is where the wires disagree most: Anthropic wants the assistant's blocks echoed back with a
 * `tool_result` for every `tool_use`, Chat Completions wants the message plus one `tool` role
 * per call, the Responses API wants the output items plus a `function_call_output` for each,
 * and Gemini wants a `functionResponse` part keyed by name rather than by call id. All four
 * refuse the request outright if an answer is missing — see trap #3.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  anthropicKeyOptions,
  anthropicSubscriptionOptions,
  codexOptions,
  antigravityCliOptions,
  antigravityKeyOptions,
  withClaudeCodeIdentity,
} from "@flyvendedk799/ai-auth";
import { describeProviderError, providerErrorFacts, type ProviderId } from "@flyvendedk799/ai-auth/registry";

export type Tool = Anthropic.Messages.Tool;
export type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

export type ToolCall = { id: string; name: string; input: unknown };

export type Turn = {
  calls: ToolCall[];
  /** The response ran out of output tokens mid-answer. A missing tool call may just be cut off. */
  truncated: boolean;
  /** The model declined. Not retryable, and not the same thing as a failure. */
  refusal: boolean;
};

export type Conversation = {
  /** Send a user turn (the first prompt, or a correction) and read back the tool calls. */
  ask(userText: string): Promise<Turn>;
};

export type Transport = {
  provider: ProviderId;
  /** The model actually in use, for error messages. Updated when a fallback takes over. */
  currentModel(): string;
  start(system: SystemBlock[], tools: Tool[], maxTokens: number): Conversation;
};

export type WireCredential =
  | { kind: "key"; wire: "anthropic"; key: string }
  | { kind: "key"; wire: "openai"; key: string }
  | { kind: "key"; wire: "gemini"; key: string }
  | { kind: "subscription"; wire: "anthropic"; token: string }
  | { kind: "subscription"; wire: "openai"; accessToken: string; accountId: string | null }
  | { kind: "subscription"; wire: "gemini"; accessToken: string; projectId: string | null };

export type TransportOptions = {
  provider: ProviderId;
  credential: WireCredential;
  modelPrimary: string;
  modelFallback: string;
  logger: (line: string) => void;
  /** Test seam: the SDK and the raw wire both take a fetch. */
  fetchImpl?: typeof fetch;
  /** Where a person would go to change the credential, named in error messages. */
  configureAt?: string;
};

/** Rate limit, overloaded, and transient 5xx — the failures worth trying the other model for. */
const RETRYABLE = new Set([429, 500, 502, 503, 529]);

const MAX_ATTEMPTS_PER_MODEL = 1;

/**
 * A provider failure, already turned into a sentence someone can act on.
 *
 * The raw facts are kept beside the message rather than only logged: status, `retry-after`,
 * the plan's own verdict and how much of its window is spent are what make a 429 an hour later
 * diagnosable, and a message on its own is not.
 */
export class ProviderCallError extends Error {
  constructor(
    message: string,
    readonly facts: ReturnType<typeof providerErrorFacts>,
    readonly provider: ProviderId,
    readonly model: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderCallError";
  }
}

export function createTransport(options: TransportOptions): Transport {
  if (options.credential.wire === "anthropic") return anthropicTransport(options);
  if (options.credential.wire === "gemini") return geminiTransport(options);
  return options.credential.kind === "subscription" ? codexTransport(options) : openAiChatTransport(options);
}

/**
 * Wraps a provider failure once, at the boundary, with the model that produced it.
 *
 * `describeProviderError` answers null when it has nothing better to say than the raw error,
 * which is deliberate on its part — "something went wrong" is worse than a status code and a
 * body, because the second gives someone something to search for. So null falls through to the
 * original message rather than being papered over.
 */
function fail(error: unknown, options: TransportOptions, model: string): never {
  if (error instanceof ProviderCallError) throw error;
  const facts = providerErrorFacts(error);
  const described = describeProviderError(error, options.provider, model, {
    ...(options.configureAt ? { configureAt: options.configureAt } : {}),
  });
  const message = described ?? `[${options.provider}] ${(error as Error)?.message ?? "call failed"}`;
  throw new ProviderCallError(message, facts, options.provider, model, { cause: error });
}

/**
 * Try the primary model, then the fallback, but only for failures the fallback could fix.
 *
 * A 429 on a subscription usually means *this model* is spent rather than the plan — see trap
 * #2 — which is exactly the case a lighter fallback answers. An auth failure is not, and
 * retrying it on another model only doubles the wait before the real message appears.
 */
async function withFallback<T>(
  options: TransportOptions,
  setModel: (model: string) => void,
  run: (model: string) => Promise<T>,
): Promise<T> {
  const models = options.modelFallback && options.modelFallback !== options.modelPrimary
    ? [options.modelPrimary, options.modelFallback]
    : [options.modelPrimary];

  let lastError: unknown;
  for (const [index, model] of models.entries()) {
    setModel(model);
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
      try {
        return await run(model);
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number }).status;
        const isLast = index === models.length - 1;
        if (isLast || status === undefined || !RETRYABLE.has(status)) {
          fail(error, options, model);
        }
        const facts = providerErrorFacts(error);
        options.logger(
          `[${options.provider}] ${model} failed (${status}${
            facts.planStatus ? `, plan ${facts.planStatus}` : ""
          }); falling back to ${models[index + 1]}`,
        );
      }
    }
  }
  fail(lastError, options, options.modelFallback);
}

// --- Anthropic: an API key, or a Claude subscription -------------------------------------

function anthropicTransport(options: TransportOptions): Transport {
  const credential = options.credential;
  const subscription = credential.kind === "subscription";
  const client = new Anthropic({
    ...(subscription
      ? anthropicSubscriptionOptions((credential as { token: string }).token)
      : anthropicKeyOptions((credential as { key: string }).key)),
    // The SDK's own retry is turned off because this transport already has a better answer to
    // the failure it would retry. A 429 here usually means *this model* is spent rather than
    // the plan, and the SDK would honour a 30-second `retry-after` on the same model before
    // giving up — where switching to the lighter fallback answers immediately.
    maxRetries: 0,
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  });
  let model = options.modelPrimary;

  console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
    provider: options.provider,
    currentModel: () => model,
    start(system, tools, maxTokens) {
      // Trap #1: on an OAuth token every request must open with the Claude Code identity as
      // its own first system block, or Anthropic refuses Opus and Sonnet with a 429 that names
      // a rate limit the plan is nowhere near. Haiku answers without it, which is what makes
      // this so easy to miss — the model you test a credential with is the one model exempt.
      const systemBlocks = (subscription ? withClaudeCodeIdentity(system) : system) as SystemBlock[];
      const messages: Anthropic.Messages.MessageParam[] = [];

      console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
        async ask(userText: string): Promise<Turn> {
          messages.push({ role: "user", content: userText });
          const message = await withFallback(options, (m) => (model = m), (m) =>
            client.messages.create({
              model: m,
              max_tokens: maxTokens,
              system: systemBlocks,
              messages,
              tools,
              tool_choice: { type: "any" },
            }),
          );

          const calls: ToolCall[] = [];
          for (const block of message.content) {
            if (block.type === "tool_use") calls.push({ id: block.id, name: block.name, input: block.input });
          }

          // Recorded now so the next `ask` is a valid repair turn: the assistant's own blocks,
          // then a result for every tool call it made, then the correction.
          messages.push({ role: "assistant", content: message.content });
          if (calls.length > 0) {
            messages.push({
              role: "user",
              content: calls.map((call) => ({
                type: "tool_result" as const,
                tool_use_id: call.id,
                content: "received",
              })),
            });
          }

          console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
            calls,
            truncated: message.stop_reason === "max_tokens",
            refusal: message.stop_reason === "refusal",
          };
        },
      };
    },
  };
}

// --- OpenAI: a metered key, over Chat Completions -----------------------------------------

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

function openAiChatTransport(options: TransportOptions): Transport {
  const key = (options.credential as { key: string }).key;
  const doFetch = options.fetchImpl ?? fetch;
  let model = options.modelPrimary;

  console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
    provider: options.provider,
    currentModel: () => model,
    start(system, tools, maxTokens) {
      const messages: ChatMessage[] = [
        { role: "system", content: system.map((block) => block.text).join("\n\n") },
      ];

      console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
        async ask(userText: string): Promise<Turn> {
          messages.push({ role: "user", content: userText });
          const message = await withFallback(options, (m) => (model = m), async (m) => {
            const response = await doFetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
              body: JSON.stringify({
                model: m,
                max_completion_tokens: maxTokens,
                messages,
                tools: tools.map(toFunctionTool),
                tool_choice: "required",
              }),
            });
            await throwForStatus(response, "openai");
            const json = (await response.json()) as {
              choices?: Array<{ message?: ChatMessage; finish_reason?: string }>;
            };
            const choice = json.choices?.[0];
            if (!choice?.message) throw new Error("[openai] response did not include a message");
            return choice;
          });

          const calls: ToolCall[] = [];
          for (const call of message.message?.tool_calls ?? []) {
            calls.push({ id: call.id, name: call.function.name, input: parseJson(call.function.arguments) });
          }

          messages.push(message.message as ChatMessage);
          for (const call of calls) {
            messages.push({ role: "tool", tool_call_id: call.id, content: "received" });
          }

          console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return { calls, truncated: message.finish_reason === "length", refusal: false };
        },
      };
    },
  };
}

// --- OpenAI: a ChatGPT subscription, over the Codex backend --------------------------------

type ResponseItem = {
  type: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  id?: string;
  role?: string;
  content?: unknown;
  status?: string;
};

/**
 * Codex speaks the Responses API at its own host, not at `api.openai.com`.
 *
 * `codexOptions` supplies the base URL and, more importantly, the account header: without it
 * the backend cannot tell which subscription to bill and refuses the request, which is why
 * `CodexIdentity` digs the account id out of the token's claims rather than settling for the
 * token alone.
 */
function codexTransport(options: TransportOptions): Transport {
  const credential = options.credential as { accessToken: string; accountId: string | null };
  const wire = codexOptions({
    accessToken: credential.accessToken,
    accountId: credential.accountId,
    refreshToken: null,
    expiresAt: 0,
    email: null,
    planType: null,
  });
  const doFetch = options.fetchImpl ?? fetch;
  let model = options.modelPrimary;

  console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
    provider: options.provider,
    currentModel: () => model,
    start(system, tools, maxTokens) {
      const instructions = system.map((block) => block.text).join("\n\n");
      const input: unknown[] = [];

      console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
        async ask(userText: string): Promise<Turn> {
          input.push({ role: "user", content: [{ type: "input_text", text: userText }] });
          const body = await withFallback(options, (m) => (model = m), async (m) => {
            const response = await doFetch(`${wire.baseURL ?? ""}/responses`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${wire.apiKey}`,
                "content-type": "application/json",
                ...(wire.defaultHeaders ?? {}),
              },
              body: JSON.stringify({
                model: m,
                instructions,
                input,
                tools: tools.map(toResponsesTool),
                tool_choice: "required",
                max_output_tokens: maxTokens,
                // Nothing here is worth the backend keeping, and a repo's source is the last
                // thing to leave lying in someone else's account by default.
                store: false,
              }),
            });
            await throwForStatus(response, "codex");
            return (await response.json()) as {
              output?: ResponseItem[];
              status?: string;
              incomplete_details?: { reason?: string };
            };
          });

          const calls: ToolCall[] = [];
          for (const item of body.output ?? []) {
            if (item.type === "function_call" && item.name) {
              calls.push({
                id: item.call_id ?? item.id ?? item.name,
                name: item.name,
                input: parseJson(item.arguments ?? "{}"),
              });
            }
          }

          // The whole output is echoed back, then one output per call: the Responses API is as
          // strict as the other two about answering every call that was made.
          for (const item of body.output ?? []) input.push(item);
          for (const call of calls) {
            input.push({ type: "function_call_output", call_id: call.id, output: "received" });
          }

          console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
            calls,
            truncated: body.incomplete_details?.reason === "max_output_tokens",
            refusal: (body.output ?? []).some((item) => item.type === "refusal"),
          };
        },
      };
    },
  };
}

// --- Gemini: a metered key, or a Google account subscription (Gemini CLI) ----------------

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: unknown } };

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

type GeminiCandidate = {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string;
};

type GeminiGenerateResponse = { response?: { candidates?: GeminiCandidate[] }; candidates?: GeminiCandidate[] };

/** finishReason values Google uses to say a response was blocked rather than merely stopped. */
const GEMINI_REFUSAL_REASONS = new Set(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]);

/**
 * A subscription does not bill against the public `generativelanguage.googleapis.com`; it
 * routes to Google's internal Cloud Code Assist endpoint, wrapping the same request shape in
 * `{ model, project, request: { ... } }`. `ANTIGRAVITY_CODE_ASSIST_BASE_URL` overrides
 * `antigravityCliOptions`'s own default (`cloudcode-pa.googleapis.com`) because a real Antigravity
 * CLI login was watched making these calls against `daily-cloudcode-pa.googleapis.com`
 * instead — see `geminiOAuth.ts`'s header for how that credential was obtained. The metered
 * key speaks the ordinary, documented `v1beta` endpoint instead, unaffected by any of this.
 */
const ANTIGRAVITY_CODE_ASSIST_BASE_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal";

function geminiTransport(options: TransportOptions): Transport {
  const credential = options.credential;
  const subscription = credential.kind === "subscription";
  const doFetch = options.fetchImpl ?? fetch;
  let model = options.modelPrimary;

  const cli = subscription
    ? antigravityCliOptions({
        accessToken: (credential as { accessToken: string }).accessToken,
        projectId: (credential as { projectId: string | null }).projectId,
        refreshToken: null,
        expiresAt: 0,
        email: null,
        isDogfood: (credential as any).isDogfood,
      })
    : antigravityKeyOptions((credential as { key: string }).key);

  console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
    provider: options.provider,
    currentModel: () => model,
    start(system, tools, maxTokens) {
      const systemInstruction = { role: "system", parts: [{ text: system.map((b) => b.text).join("\n\n") }] };
      const declarations = tools.map(toGeminiFunctionDeclaration);
      const contents: GeminiContent[] = [];

      console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
        async ask(userText: string): Promise<Turn> {
          contents.push({ role: "user", parts: [{ text: userText }] });

          const generateRequest = {
            contents,
            systemInstruction,
            tools: [{ functionDeclarations: declarations }],
            toolConfig: { functionCallingConfig: { mode: "ANY" } },
            generationConfig: { maxOutputTokens: maxTokens },
          };

          const json = await withFallback(options, (m) => (model = m), async (m) => {
            const projectId = subscription ? (credential as { projectId: string | null }).projectId : null;
            const response = subscription
              ? await doFetch(`${cli.baseURL}:generateContent`, {
                  method: "POST",
                  // `antigravityCliOptions` already set `Authorization`, `Content-Type` and, when a
                  // project is on the identity, `x-goog-user-project` — nothing to add here.
                  headers: cli.defaultHeaders ?? {},
                  body: JSON.stringify({
                    model: `models/${m}`,
                    ...(projectId ? { project: projectId } : {}),
                    request: generateRequest,
                  }),
                })
              : await doFetch(`${cli.baseURL}/models/${m}:generateContent`, {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-goog-api-key": cli.apiKey ?? "" },
                  body: JSON.stringify(generateRequest),
                });
            await throwForStatus(response, "gemini");
            return (await response.json()) as GeminiGenerateResponse;
          });

          const candidate = (json.response?.candidates ?? json.candidates ?? [])[0];
          const parts = candidate?.content?.parts ?? [];

          const calls: ToolCall[] = [];
          for (const part of parts) {
            if ("functionCall" in part && part.functionCall) {
              calls.push({ id: part.functionCall.name, name: part.functionCall.name, input: part.functionCall.args });
            }
          }

          // Correlated by name, not id — unlike the other two wires, Gemini's function response
          // part carries no call id, only the name the call was made with.
          if (parts.length > 0) contents.push({ role: "model", parts });
          for (const call of calls) {
            contents.push({
              role: "user",
              parts: [{ functionResponse: { name: call.name, response: { result: "received" } } }],
            });
          }

          console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
            calls,
            truncated: candidate?.finishReason === "MAX_TOKENS",
            refusal: !!candidate?.finishReason && GEMINI_REFUSAL_REASONS.has(candidate.finishReason),
          };
        },
      };
    },
  };
}

// --- shared plumbing -----------------------------------------------------------------------

function sanitizeGeminiSchema(schema: any): any {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeGeminiSchema);
  }
  if (schema !== null && typeof schema === 'object') {
    const { const: constVal, ...rest } = schema;
    const sanitized: any = {};
    for (const [k, v] of Object.entries(rest)) {
      sanitized[k] = sanitizeGeminiSchema(v);
    }
    if (constVal !== undefined) {
      sanitized.enum = [constVal];
    }
    if (Array.isArray(sanitized.enum) && sanitized.enum.some((e: any) => typeof e !== 'string')) {
      sanitized.description = (sanitized.description ? sanitized.description + " " : "") + "Allowed values: " + sanitized.enum.join(", ");
      delete sanitized.enum;
    }
    return sanitized;
  }
  return schema;
}

function toGeminiFunctionDeclaration(tool: Tool) {
  console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return { name: tool.name, description: tool.description, parameters: sanitizeGeminiSchema(tool.input_schema) };
}

function toFunctionTool(tool: Tool) {
  console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  };
}

function toResponsesTool(tool: Tool) {
  console.error([TRANSPORT DEBUG] Base URL:  | isDogfood: );
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    // Left undefined rather than defaulted to {}: an empty object would validate away as
    // "missing required fields", which reads as the model's mistake instead of a truncated
    // argument stream.
    return undefined;
  }
}

/**
 * Turn a non-2xx into an error carrying the status and headers.
 *
 * The headers are the point. `retry-after` and `anthropic-ratelimit-unified-status` are what
 * separate "the plan is exhausted" from "this model is", and an error that has thrown them
 * away cannot be described usefully afterwards.
 */
async function throwForStatus(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  const error = new Error(`[${label}] HTTP ${response.status}: ${text.slice(0, 500)}`) as Error & {
    status: number;
    headers: Record<string, string>;
    error?: unknown;
  };
  error.status = response.status;
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  error.headers = headers;
  try {
    error.error = JSON.parse(text);
  } catch {
    // Not JSON. The message already carries the body.
  }
  throw error;
}

