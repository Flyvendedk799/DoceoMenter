import { describe, expect, it } from "vitest";
import { CLAUDE_CODE_SYSTEM } from "@flyvendedk799/ai-auth";
import { createTransport, ProviderCallError, type Tool } from "./transport.js";

const TOOL: Tool = {
  name: "submit_thing",
  description: "Submit the thing.",
  input_schema: { type: "object", properties: { ok: { type: "boolean" } } },
};

const SYSTEM = [{ type: "text" as const, text: "You write documentation." }];

type Captured = { url: string; init: RequestInit; body: any; headers: Record<string, string> };

/** A fetch that answers from a queue of canned responses and records every request. */
function recorder(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Captured[] = [];
  const impl = (async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    calls.push({
      url,
      init,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers,
    });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json", ...(next.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function anthropicMessage(content: unknown[], stop = "tool_use") {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

function transportFor(
  credential: Parameters<typeof createTransport>[0]["credential"],
  impl: typeof fetch,
  overrides: Partial<Parameters<typeof createTransport>[0]> = {},
) {
  return createTransport({
    provider: credential.kind === "subscription" ? (credential.wire === "anthropic" ? "claude-code" : "codex") : credential.wire,
    credential,
    modelPrimary: credential.wire === "anthropic" ? "claude-opus-5" : "gpt-5",
    modelFallback: credential.wire === "anthropic" ? "claude-sonnet-5" : "gpt-5-mini",
    logger: () => {},
    fetchImpl: impl,
    ...overrides,
  });
}

describe("anthropic wire, on a Claude subscription", () => {
  it("opens every request with the Claude Code identity as its own first block", async () => {
    const { calls, impl } = recorder([
      { body: anthropicMessage([{ type: "tool_use", id: "tu_1", name: "submit_thing", input: { ok: true } }]) },
    ]);
    const transport = transportFor({ kind: "subscription", wire: "anthropic", token: "oat-live" }, impl);

    await transport.start(SYSTEM, [TOOL], 1000).ask("go");

    const system = calls[0]!.body.system;
    // Trap #1: exact text, first position, its own block. All three matter — the same request
    // with the identity second, or folded into the prompt, is refused with a 429.
    expect(system[0]).toEqual({ type: "text", text: CLAUDE_CODE_SYSTEM });
    expect(system[1].text).toBe("You write documentation.");
  });

  it("authenticates as a bearer token and sends no x-api-key at all", async () => {
    const { calls, impl } = recorder([
      { body: anthropicMessage([{ type: "tool_use", id: "tu_1", name: "submit_thing", input: {} }]) },
    ]);
    const transport = transportFor({ kind: "subscription", wire: "anthropic", token: "oat-live" }, impl);

    await transport.start(SYSTEM, [TOOL], 1000).ask("go");

    // Trap #4: Anthropic validates `x-api-key` whenever the header is present, so a placeholder
    // alongside a valid bearer is rejected rather than ignored.
    expect(calls[0]!.headers.authorization).toBe("Bearer oat-live");
    expect(calls[0]!.headers["x-api-key"]).toBeUndefined();
    expect(calls[0]!.headers["anthropic-beta"]).toContain("oauth-2025-04-20");
    expect(calls[0]!.headers["user-agent"]).toContain("claude-cli/");
  });

  it("answers every tool call before asking for a correction", async () => {
    const { calls, impl } = recorder([
      {
        body: anthropicMessage([
          { type: "tool_use", id: "tu_1", name: "other_tool", input: {} },
          { type: "tool_use", id: "tu_2", name: "another_tool", input: {} },
        ]),
      },
      { body: anthropicMessage([{ type: "tool_use", id: "tu_3", name: "submit_thing", input: {} }]) },
    ]);
    const conversation = transportFor({ kind: "subscription", wire: "anthropic", token: "oat" }, impl).start(
      SYSTEM,
      [TOOL],
      1000,
    );

    await conversation.ask("go");
    await conversation.ask("that was wrong, try again");

    // Trap #3: a message following an assistant turn that made tool calls must answer *all* of
    // them, in that one message, or the request is refused outright.
    const messages = calls[1]!.body.messages;
    const results = messages.filter((m: any) => Array.isArray(m.content) && m.content[0]?.type === "tool_result");
    const answered = results.flatMap((m: any) => m.content.map((c: any) => c.tool_use_id));
    expect(answered).toEqual(["tu_1", "tu_2"]);
    expect(messages.at(-1)).toEqual({ role: "user", content: "that was wrong, try again" });
  });
});

describe("anthropic wire, on an API key", () => {
  it("sends the key and leaves the system prompt alone", async () => {
    const { calls, impl } = recorder([
      { body: anthropicMessage([{ type: "tool_use", id: "tu_1", name: "submit_thing", input: {} }]) },
    ]);
    const transport = transportFor({ kind: "key", wire: "anthropic", key: "sk-ant-key" }, impl);

    await transport.start(SYSTEM, [TOOL], 1000).ask("go");

    expect(calls[0]!.headers["x-api-key"]).toBe("sk-ant-key");
    expect(calls[0]!.body.system[0].text).toBe("You write documentation.");
  });
});

describe("failures", () => {
  it("falls back to the lighter model on a 429, then reports it in the plan's own terms", async () => {
    const { calls, impl } = recorder([
      {
        status: 429,
        body: { type: "error", error: { type: "rate_limit_error", message: "Error" } },
        headers: { "anthropic-ratelimit-unified-status": "allowed", "retry-after": "30" },
      },
      { body: anthropicMessage([{ type: "tool_use", id: "tu_1", name: "submit_thing", input: {} }]) },
    ]);
    const transport = transportFor({ kind: "subscription", wire: "anthropic", token: "oat" }, impl);

    await transport.start(SYSTEM, [TOOL], 1000).ask("go");

    expect(calls.map((c) => c.body.model)).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect(transport.currentModel()).toBe("claude-sonnet-5");
  });

  it("turns a spent plan into a sentence naming the model, with the facts kept", async () => {
    const { impl } = recorder([
      {
        status: 429,
        body: { type: "error", error: { type: "rate_limit_error", message: "Error" } },
        headers: { "anthropic-ratelimit-unified-status": "allowed", "retry-after": "30" },
      },
      {
        status: 429,
        body: { type: "error", error: { type: "rate_limit_error", message: "Error" } },
        headers: { "anthropic-ratelimit-unified-status": "allowed", "retry-after": "30" },
      },
    ]);
    const transport = transportFor({ kind: "subscription", wire: "anthropic", token: "oat" }, impl, {
      configureAt: "the provider panel",
    });

    const error = await transport
      .start(SYSTEM, [TOOL], 1000)
      .ask("go")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderCallError);
    const call = error as ProviderCallError;
    // A 429 whose plan status is `allowed` is a per-model limit, not an exhausted plan — the
    // message has to say so, or people wait out an allowance that was never the problem.
    expect(call.message).toContain("plan is still allowed");
    expect(call.facts).toMatchObject({ status: 429, retryAfter: 30, planStatus: "allowed" });
    expect(call.model).toBe("claude-sonnet-5");
  });

  it("does not waste the fallback on a rejected credential", async () => {
    const { calls, impl } = recorder([
      { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } },
    ]);
    const transport = transportFor({ kind: "key", wire: "anthropic", key: "sk-ant-stale" }, impl, {
      configureAt: "the provider panel",
    });

    const error = await transport
      .start(SYSTEM, [TOOL], 1000)
      .ask("go")
      .catch((e: unknown) => e);

    expect((error as Error).message).toContain("the provider panel");
    expect(calls).toHaveLength(1);
  });
});

describe("openai wire", () => {
  it("uses chat completions for a metered key", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                tool_calls: [
                  { id: "call_1", type: "function", function: { name: "submit_thing", arguments: '{"ok":true}' } },
                ],
              },
            },
          ],
        },
      },
    ]);
    const transport = transportFor({ kind: "key", wire: "openai", key: "sk-openai" }, impl);

    const turn = await transport.start(SYSTEM, [TOOL], 1000).ask("go");

    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.body.tools[0].function.name).toBe("submit_thing");
    expect(turn.calls).toEqual([{ id: "call_1", name: "submit_thing", input: { ok: true } }]);
  });

  it("uses the Codex backend, with the account header, for a ChatGPT subscription", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          output: [
            { type: "function_call", call_id: "fc_1", name: "submit_thing", arguments: '{"ok":true}' },
          ],
        },
      },
      { body: { output: [{ type: "function_call", call_id: "fc_2", name: "submit_thing", arguments: "{}" }] } },
    ]);
    const transport = transportFor(
      { kind: "subscription", wire: "openai", accessToken: "codex-token", accountId: "acct_1" },
      impl,
    );
    const conversation = transport.start(SYSTEM, [TOOL], 1000);

    const turn = await conversation.ask("go");
    await conversation.ask("again");

    expect(calls[0]!.url).toBe("https://chatgpt.com/backend-api/codex/responses");
    // Without the account header the backend cannot tell which subscription to bill.
    expect(calls[0]!.headers["chatgpt-account-id"]).toBe("acct_1");
    expect(calls[0]!.headers.originator).toBe("codex_cli_ts");
    expect(calls[0]!.body.store).toBe(false);
    expect(calls[0]!.body.tools[0]).toMatchObject({ type: "function", name: "submit_thing" });
    expect(turn.calls).toEqual([{ id: "fc_1", name: "submit_thing", input: { ok: true } }]);

    // The second turn has to answer the first turn's call, like the other two wires.
    const input = calls[1]!.body.input;
    expect(input).toContainEqual({ type: "function_call_output", call_id: "fc_1", output: "received" });
  });
});
