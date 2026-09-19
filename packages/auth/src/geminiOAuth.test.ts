import { describe, expect, it } from "vitest";
import { GEMINI_OAUTH, GeminiLoginError, exchangeGeminiCode, refreshGeminiToken, startGeminiLogin } from "./geminiOAuth.js";

describe("startGeminiLogin", () => {
  it("builds a PKCE authorization URL against Google, asking for a refresh token", () => {
    const started = startGeminiLogin(false);
    const url = new URL(started.url);

    expect(url.origin + url.pathname).toBe(GEMINI_OAUTH.authorizeUrl);
    expect(url.searchParams.get("client_id")).toEqual(expect.any(String));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(GEMINI_OAUTH.redirectUri);
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/cloud-platform");
    // `aicode` routes personal Google AI onto enterprise aicode-consumers — never request it.
    expect(url.searchParams.get("scope")).not.toContain("https://www.googleapis.com/auth/aicode");

    expect(url.searchParams.get("code_challenge")).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe(started.state);
  });

  it("uses the G1 Dogfood client when requested, still without aicode", () => {
    const started = startGeminiLogin(true);
    const url = new URL(started.url);
    expect(url.searchParams.get("scope")).not.toContain("https://www.googleapis.com/auth/aicode");
    expect(url.searchParams.get("client_id")).toContain("884354919052");
  });

  it("never reuses a verifier or state across two starts", () => {
    const a = startGeminiLogin(false);
    const b = startGeminiLogin(false);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.state).not.toBe(b.state);
  });
});

function recorder(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const impl = (async (input: any, init: any) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("exchangeGeminiCode", () => {
  it("posts form-encoded, with the verifier and no state", async () => {
    const { calls, impl } = recorder([
      {
        body: {
          access_token: "ya29.live",
          refresh_token: "1//refresh",
          expires_in: 3600,
          id_token:
            "h." +
            Buffer.from(JSON.stringify({ email: "person@gmail.com" })).toString("base64url") +
            ".s",
        },
      },
    ]);

    const identity = await exchangeGeminiCode({
      code: "4/0Acode",
      verifier: "the-verifier",
      fetchImpl: impl,
      now: () => 1_000_000,
    });

    expect(calls[0]!.url).toBe(GEMINI_OAUTH.tokenUrl);
    expect(calls[0]!.body.get("grant_type")).toBe("authorization_code");
    expect(calls[0]!.body.get("code")).toBe("4/0Acode");
    expect(calls[0]!.body.get("code_verifier")).toBe("the-verifier");
    expect(calls[0]!.body.get("client_secret")).toEqual(expect.any(String));
    expect(identity).toEqual({
      accessToken: "ya29.live",
      refreshToken: "1//refresh",
      expiresAt: 1_000_000 + 3_600_000,
      email: "person@gmail.com",
      isDogfood: undefined,
    });
  });

  it("turns a rejected code into a restartable error", async () => {
    const { impl } = recorder([{ status: 400, body: { error: "invalid_grant", error_description: "Bad code." } }]);
    await expect(
      exchangeGeminiCode({ code: "spent", verifier: "v", fetchImpl: impl }),
    ).rejects.toMatchObject({ restart: true, message: "Bad code." } satisfies Partial<GeminiLoginError>);
  });
});

describe("refreshGeminiToken", () => {
  it("does not require a new refresh token in the response", async () => {
    const { calls, impl } = recorder([{ body: { access_token: "ya29.new", expires_in: 1800 } }]);
    const refreshed = await refreshGeminiToken("1//refresh", { fetchImpl: impl, now: () => 0 });

    expect(calls[0]!.body.get("grant_type")).toBe("refresh_token");
    expect(calls[0]!.body.get("refresh_token")).toBe("1//refresh");
    expect(refreshed).toEqual({ accessToken: "ya29.new", expiresAt: 1_800_000, email: null });
  });
});
