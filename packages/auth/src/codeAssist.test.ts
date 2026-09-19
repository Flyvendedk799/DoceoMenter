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

  it("discovers G1/Dogfood on the daily host with agy metadata", async () => {
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
    expect(calls[0]!.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
    expect(calls[0]!.body).toEqual({ metadata: { ideType: "ANTIGRAVITY" } });
    expect(calls[0]!.headers["user-agent"]).toContain("antigravity/1.21.9");
    expect(calls[0]!.headers["user-agent"]).toContain("google-api-nodejs-client/");
    expect(calls[0]!.headers["client-metadata"]).toBeUndefined();
    expect(calls[0]!.headers["x-goog-api-client"]).toBe("gl-node/22.21.1");
  });

  it("uses cloudaicompanionProject from prod loadCodeAssist when already onboarded", async () => {
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
    expect(calls[0]!.body).toEqual({ metadata: { ideType: "ANTIGRAVITY" } });
  });

  it("onboards with snake_case metadata when loadCodeAssist has no project", async () => {
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
    expect(calls[1]!.body).toEqual({
      tier_id: "free-tier",
      metadata: { ide_type: "ANTIGRAVITY", ide_version: "1.21.9", ide_name: "antigravity" },
    });
  });

  it("still onboards when TOS ineligible sits next to an allowed tier", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          ineligibleTiers: [
            {
              reasonMessage:
                "Client is not eligible for Gemini Code Assist for individuals. Client does not support Google TOS.",
            },
          ],
          allowedTiers: [{ id: "legacy-tier", isDefault: true }],
        },
      },
      {
        body: {
          done: true,
          response: { cloudaicompanionProject: { id: "legacy-managed" } },
        },
      },
    ]);
    const projectId = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(projectId).toBe("legacy-managed");
    expect(calls[1]!.body).toMatchObject({ tier_id: "legacy-tier" });
  });

  it("tries the next host when the first only returns TOS ineligible", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, impl } = recorder([
      {
        body: {
          ineligibleTiers: [
            {
              reasonMessage:
                "Client is not eligible for Gemini Code Assist for individuals. Client does not support Google TOS.",
            },
          ],
        },
      },
      {
        body: { cloudaicompanionProject: "from-daily" },
      },
    ]);
    const projectId = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
    });
    expect(projectId).toBe("from-daily");
    expect(calls.map((c) => c.url)).toEqual([
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    ]);
    error.mockRestore();
  });

  it("soft-fails when every host is TOS-ineligible", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { impl } = recorder([
      { body: { ineligibleTiers: [{ reasonMessage: "Client does not support Google TOS." }] } },
      { body: { ineligibleTiers: [{ reasonMessage: "Client does not support Google TOS." }] } },
    ]);
    await expect(
      ensureCodeAssistProject({ accessToken: "ya29", isDogfood: false, fetchImpl: impl }),
    ).resolves.toBeNull();
    error.mockRestore();
  });

  it("soft-fails when loadCodeAssist returns HTTP 403 on every host", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { impl } = recorder([
      { status: 403, body: { error: { message: "forbidden" } } },
      { status: 403, body: { error: { message: "forbidden" } } },
    ]);
    await expect(
      ensureCodeAssistProject({ accessToken: "ya29", isDogfood: false, fetchImpl: impl }),
    ).resolves.toBeNull();
    error.mockRestore();
  });
});
