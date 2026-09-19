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
  it("falls back to a stored personal GCP project when discovery yields nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, impl } = recorder([
      { body: { ineligibleTiers: [{ reasonMessage: "nope" }] } },
      { body: { ineligibleTiers: [{ reasonMessage: "nope" }] } },
      { status: 403, body: { error: { message: "forbidden" } } },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      projectId: "already-known",
      fetchImpl: impl,
    });
    expect(discovered).toEqual({ projectId: "already-known", isDogfood: false });
    expect(calls.length).toBeGreaterThan(0);
    error.mockRestore();
  });

  it("forwards discovery steps to an optional log sink for the run UI", async () => {
    const lines: string[] = [];
    const { impl } = recorder([
      {
        body: {
          currentTier: { id: "free-tier" },
          cloudaicompanionProject: "managed-ui-log",
        },
      },
    ]);
    await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
      log: (line) => lines.push(line),
    });
    expect(lines.some((l) => l.includes("[code-assist] discovering managed project"))).toBe(true);
    expect(lines.some((l) => l.includes("personal project=managed-ui-log"))).toBe(true);
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
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: true,
      fetchImpl: impl,
    });
    expect(discovered).toEqual({ projectId: "dogfood-managed-abc", isDogfood: true });
    expect(calls[0]!.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
  });

  it("uses cloudaicompanionProject from daily loadCodeAssist when already onboarded", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          currentTier: { id: "free-tier" },
          cloudaicompanionProject: "managed-gcp-abc",
        },
      },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
    });
    expect(discovered).toEqual({ projectId: "managed-gcp-abc", isDogfood: true });
    expect(calls[0]!.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
  });

  it("onboards with snake_case metadata when loadCodeAssist has no project", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          currentTier: { id: "free-tier" },
          allowedTiers: [{ id: "free-tier", isDefault: true }],
        },
      },
      {
        body: {
          done: true,
          response: { cloudaicompanionProject: { id: "fresh-managed-xyz" } },
        },
      },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(discovered).toEqual({ projectId: "fresh-managed-xyz", isDogfood: true });
    expect(calls.map((c) => c.url)).toEqual([
      "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      "https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser",
    ]);
    expect(calls[1]!.body).toMatchObject({
      tier_id: "free-tier",
      metadata: { ide_type: "ANTIGRAVITY", ide_name: "antigravity" },
    });
    expect(calls[1]!.body).not.toHaveProperty("cloudaicompanionProject");
  });

  it("polls onboardUser until done when the first response is a long-running op", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          currentTier: { id: "free-tier" },
          allowedTiers: [{ id: "free-tier", isDefault: true }],
        },
      },
      { body: { name: "operations/op-1", done: false } },
      {
        body: {
          done: true,
          response: { cloudaicompanionProject: { id: "free-managed" } },
        },
      },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(discovered?.projectId).toBe("free-managed");
    expect(calls[1]!.body).toMatchObject({ tier_id: "free-tier" });
  });

  it("lists companion projects when load/onboard leave no personal project", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, impl } = recorder([
      {
        body: {
          allowedTiers: [
            {
              id: "standard-tier",
              isDefault: true,
              userDefinedCloudaicompanionProject: true,
            },
          ],
          ineligibleTiers: [{ tierId: "free-tier", reasonCode: "INELIGIBLE" }],
        },
      },
      // onboardUser standard-tier — done, no companion
      { body: { done: true, response: {} } },
      // prod load + onboard
      {
        body: {
          allowedTiers: [
            {
              id: "standard-tier",
              isDefault: true,
              userDefinedCloudaicompanionProject: true,
            },
          ],
        },
      },
      { body: { done: true, response: {} } },
      // sandbox load + onboard
      {
        body: {
          allowedTiers: [
            {
              id: "standard-tier",
              isDefault: true,
              userDefinedCloudaicompanionProject: true,
            },
          ],
        },
      },
      { body: { done: true, response: {} } },
      // listCloudAICompanionProjects on daily
      { body: { projects: [{ id: "listed-managed-99" }] } },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: true,
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(discovered).toEqual({ projectId: "listed-managed-99", isDogfood: true });
    expect(calls.some((c) => String(c.url).endsWith(":listCloudAICompanionProjects"))).toBe(true);
    error.mockRestore();
  });

  it("falls back to body-only aicode-consumers when standard-tier yields no project at all", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const emptyStandard = {
      body: {
        allowedTiers: [
          {
            id: "standard-tier",
            isDefault: true,
            userDefinedCloudaicompanionProject: true,
          },
        ],
        ineligibleTiers: [{ tierId: "free-tier", reasonCode: "INELIGIBLE" }],
      },
    };
    const { calls, impl } = recorder([
      emptyStandard,
      { body: { done: true, response: {} } },
      emptyStandard,
      { body: { done: true, response: {} } },
      emptyStandard,
      { body: { done: true, response: {} } },
      { body: { projects: [] } },
      { body: { projects: [] } },
      { body: { projects: [] } },
      { status: 403, body: { error: { message: "not eligible" } } },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: true,
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(discovered).toEqual({
      projectId: null,
      bodyOnlyProjectId: "aicode-consumers",
      isDogfood: true,
    });
    expect(calls.some((c) => String(c.url).endsWith(":onboardUser"))).toBe(true);
    expect(calls.some((c) => String(c.url).endsWith(":listCloudAICompanionProjects"))).toBe(true);
    error.mockRestore();
  });

  it("onboards standard-tier with the user GCP project and uses it when onboard omits companion id", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, impl } = recorder([
      {
        body: {
          allowedTiers: [
            {
              id: "standard-tier",
              isDefault: true,
              userDefinedCloudaicompanionProject: true,
            },
          ],
          ineligibleTiers: [{ tierId: "free-tier", reasonCode: "INELIGIBLE" }],
        },
      },
      {
        body: {
          done: true,
          response: {},
        },
      },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: true,
      projectId: "flyvendee-gcp",
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(discovered).toEqual({ projectId: "flyvendee-gcp", isDogfood: true });
    expect(calls[0]!.body).toMatchObject({ cloudaicompanionProject: "flyvendee-gcp" });
    expect(calls[1]!.body).toMatchObject({
      tier_id: "standard-tier",
      cloudaicompanionProject: "flyvendee-gcp",
    });
    error.mockRestore();
  });

  it("uses the user GCP project when load already has currentTier but no companion project", async () => {
    const { impl } = recorder([
      {
        body: {
          currentTier: { id: "standard-tier", userDefinedCloudaicompanionProject: true },
        },
      },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: true,
      projectId: "my-pro-project",
      fetchImpl: impl,
    });
    expect(discovered).toEqual({ projectId: "my-pro-project", isDogfood: true });
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
        body: { cloudaicompanionProject: "from-prod" },
      },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
    });
    expect(discovered).toEqual({ projectId: "from-prod", isDogfood: false });
    expect(calls.map((c) => c.url)).toEqual([
      "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    ]);
    error.mockRestore();
  });

  it("soft-fails when every host is TOS-ineligible and daily free-tier onboard yields nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, impl } = recorder([
      { body: { ineligibleTiers: [{ reasonMessage: "Client does not support Google TOS." }] } },
      { body: { ineligibleTiers: [{ reasonMessage: "Client does not support Google TOS." }] } },
      { status: 403, body: { error: { message: "forbidden" } } },
    ]);
    await expect(
      ensureCodeAssistProject({ accessToken: "ya29", isDogfood: false, fetchImpl: impl }),
    ).resolves.toBeNull();
    expect(calls.at(-1)!.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser");
    error.mockRestore();
  });

  it("soft-fails when loadCodeAssist returns HTTP 403 on every host and daily onboard fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { impl } = recorder([
      { status: 403, body: { error: { message: "forbidden" } } },
      { status: 403, body: { error: { message: "forbidden" } } },
      { status: 403, body: { error: { message: "forbidden" } } },
    ]);
    await expect(
      ensureCodeAssistProject({ accessToken: "ya29", isDogfood: false, fetchImpl: impl }),
    ).resolves.toBeNull();
    error.mockRestore();
  });

  it("onboards a personal project when loadCodeAssist only returns aicode-consumers", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Daily returns the shared consumer project with a free tier — must still call onboardUser.
    const { calls, impl } = recorder([
      {
        body: {
          currentTier: { id: "free-tier" },
          cloudaicompanionProject: "aicode-consumers",
        },
      },
      {
        body: {
          done: true,
          response: { cloudaicompanionProject: { id: "personal-managed-42" } },
        },
      },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(discovered).toEqual({ projectId: "personal-managed-42", isDogfood: true });
    expect(calls.map((c) => c.url)).toEqual([
      "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      "https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser",
    ]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("falls back to body-only aicode-consumers when onboard cannot provision a personal project", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, impl } = recorder([
      {
        body: {
          currentTier: { id: "free-tier" },
          cloudaicompanionProject: "aicode-consumers",
        },
      },
      {
        body: {
          done: true,
          response: { cloudaicompanionProject: "aicode-consumers" },
        },
      },
      {
        body: {
          currentTier: { id: "free-tier" },
          cloudaicompanionProject: "aicode-consumers",
        },
      },
      {
        body: {
          done: true,
          response: { cloudaicompanionProject: "aicode-consumers" },
        },
      },
      {
        body: {
          done: true,
          response: { cloudaicompanionProject: "aicode-consumers" },
        },
      },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      isDogfood: false,
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(discovered).toEqual({
      projectId: null,
      bodyOnlyProjectId: "aicode-consumers",
      isDogfood: true,
    });
    expect(calls.at(-1)!.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser");
    error.mockRestore();
  });

  it("does not short-circuit on a stored aicode-consumers project id", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, impl } = recorder([
      {
        body: {
          currentTier: { id: "free-tier" },
          cloudaicompanionProject: "aicode-consumers",
        },
      },
      {
        body: {
          done: true,
          response: { cloudaicompanionProject: { id: "after-rediscovery" } },
        },
      },
    ]);
    const discovered = await ensureCodeAssistProject({
      accessToken: "ya29",
      projectId: "aicode-consumers",
      isDogfood: false,
      fetchImpl: impl,
      sleep: async () => {},
    });
    expect(discovered?.projectId).toBe("after-rediscovery");
    // Must not treat the enterprise id as "already known" — rediscovery runs.
    expect(calls.length).toBeGreaterThanOrEqual(1);
    error.mockRestore();
  });
});
