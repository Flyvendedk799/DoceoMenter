import { describe, expect, it, vi } from "vitest";
import { ensureCodeAssistProject } from "./codeAssist.js";

type Captured = { url: string; method: string; body: unknown; headers: Record<string, string> };

function recorder(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Captured[] = [];
  const impl = (async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers,
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

  it("uses the Dogfood sandbox host for G1 discovery", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          currentTier: { id: "free-tier", name: "Free" },
          cloudaicompanionProject: "dogfood-managed-abc",
        },
      },
    ]);
    const projectId = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: true,
      fetchImpl: impl,
    });
    expect(projectId).toBe("dogfood-managed-abc");
    expect(calls[0]!.url).toBe(
      "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
    );
    expect(calls[0]!.body).toMatchObject({
      metadata: { ideType: "ANTIGRAVITY", pluginType: "GEMINI" },
    });
    expect(calls[0]!.headers["user-agent"]).toContain("antigravity/");
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
      isDogfood: false,
      fetchImpl: impl,
    });
    expect(projectId).toBe("managed-gcp-abc");
    expect(calls[0]!.url).toBe("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
    expect(calls[0]!.body).toMatchObject({
      metadata: { ideType: "ANTIGRAVITY", pluginType: "GEMINI" },
    });
    expect(calls[0]!.headers["user-agent"]).toContain("antigravity/");
    expect(calls[0]!.headers["x-goog-api-client"]).toContain("vscode_cloudshelleditor");
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
      metadata: { ideType: "ANTIGRAVITY", pluginType: "GEMINI" },
    });
    expect(calls[1]!.body).not.toHaveProperty("cloudaicompanionProject");
  });

  it("soft-fails when onboarded but no managed project is returned", async () => {
    const { impl } = recorder([
      { body: { currentTier: { id: "free-tier" }, cloudaicompanionProject: null } },
    ]);
    await expect(
      ensureCodeAssistProject({ accessToken: "ya29", isDogfood: false, fetchImpl: impl }),
    ).resolves.toBeNull();
  });

  it("soft-fails on Google TOS / individuals ineligibility instead of blocking the run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { impl } = recorder([
      {
        body: {
          ineligibleTiers: [
            {
              reasonCode: "CLIENT_NOT_ELIGIBLE",
              reasonMessage:
                "Client is not eligible for Gemini Code Assist for individuals. Client does not support Google TOS.",
            },
          ],
        },
      },
    ]);
    await expect(
      ensureCodeAssistProject({ accessToken: "ya29", isDogfood: false, fetchImpl: impl }),
    ).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("soft-fails when loadCodeAssist returns HTTP 403", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { impl } = recorder([
      {
        status: 403,
        body: { error: { message: "Client does not support Google TOS." } },
      },
    ]);
    await expect(
      ensureCodeAssistProject({ accessToken: "ya29", isDogfood: false, fetchImpl: impl }),
    ).resolves.toBeNull();
    error.mockRestore();
  });
});
