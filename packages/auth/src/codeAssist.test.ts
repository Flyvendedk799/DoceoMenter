import { describe, expect, it } from "vitest";
import { ensureCodeAssistProject, CodeAssistSetupError } from "./codeAssist.js";

type Captured = { url: string; method: string; body: unknown };

function recorder(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Captured[] = [];
  const impl = (async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("ensureCodeAssistProject", () => {
  it("returns an already-known project id without calling the network", async () => {
    const { calls, impl } = recorder([]);
    const projectId = await ensureCodeAssistProject({
      accessToken: "ya29",
      projectId: "already-known",
      fetchImpl: impl,
    });
    expect(projectId).toBe("already-known");
    expect(calls).toHaveLength(0);
  });

  it("uses cloudaicompanionProject from loadCodeAssist when already onboarded", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          currentTier: { id: "free-tier", name: "Free" },
          cloudaicompanionProject: "managed-gcp-abc",
        },
      },
    ]);
    const projectId = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: true,
      fetchImpl: impl,
    });
    expect(projectId).toBe("managed-gcp-abc");
    expect(calls[0]!.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
    expect(calls[0]!.body).toMatchObject({
      metadata: { ideType: "IDE_UNSPECIFIED", pluginType: "GEMINI" },
    });
  });

  it("onboards when loadCodeAssist has no currentTier, then returns the managed project", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          allowedTiers: [{ id: "free-tier", name: "Free", isDefault: true }],
        },
      },
      {
        body: {
          name: "operations/op-1",
          done: true,
          response: { cloudaicompanionProject: { id: "fresh-managed-xyz" } },
        },
      },
    ]);
    const projectId = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(projectId).toBe("fresh-managed-xyz");
    expect(calls.map((c) => c.url)).toEqual([
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
    ]);
    expect(calls[1]!.body).toMatchObject({
      tierId: "free-tier",
      metadata: { pluginType: "GEMINI" },
    });
    expect(calls[1]!.body).not.toHaveProperty("cloudaicompanionProject");
  });

  it("fails clearly when onboarded but no managed project is returned", async () => {
    const { impl } = recorder([
      { body: { currentTier: { id: "free-tier" }, cloudaicompanionProject: null } },
    ]);
    await expect(
      ensureCodeAssistProject({ accessToken: "ya29", isDogfood: true, fetchImpl: impl }),
    ).rejects.toBeInstanceOf(CodeAssistSetupError);
  });
});
