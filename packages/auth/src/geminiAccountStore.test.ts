import { describe, expect, it } from "vitest";
import { MemoryCredentialStore } from "@flyvendedk799/ai-auth";
import { GeminiAccountStore } from "./geminiAccountStore.js";

function storeIn(now: () => number, fetchImpl?: typeof fetch) {
  return new GeminiAccountStore({
    store: new MemoryCredentialStore(),
    secret: "test-secret-key-0123456789abcdef",
    now,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

const identity = {
  accessToken: "ya29-live",
  refreshToken: "1//refresh-me",
  expiresAt: 0, // set per test
  email: "person@gmail.com",
};

describe("GeminiAccountStore", () => {
  it("reports disconnected for an account that never signed in", async () => {
    const store = storeIn(() => 0);
    expect(await store.status("nobody")).toMatchObject({ connected: false });
  });

  it("round-trips a saved identity", async () => {
    const store = storeIn(() => 0);
    await store.save("account-1", { ...identity, expiresAt: 3_600_000 });

    const status = await store.status("account-1");
    expect(status).toMatchObject({
      connected: true,
      email: "person@gmail.com",
      expiresAt: 3_600_000,
      expired: false,
    });
    expect(await store.token("account-1")).toBe("ya29-live");
  });

  it("keeps a project id set separately from the tokens", async () => {
    const store = storeIn(() => 0);
    await store.save("account-1", { ...identity, expiresAt: 3_600_000 });
    await store.setProjectId("account-1", "my-gcp-project");

    expect(await store.status("account-1")).toMatchObject({ projectId: "my-gcp-project" });

    // A later save without an explicit projectId must not clobber it.
    await store.save("account-1", { ...identity, accessToken: "ya29-rotated", expiresAt: 7_200_000 });
    expect(await store.status("account-1")).toMatchObject({ projectId: "my-gcp-project" });
  });

  it("refuses to store Google's enterprise aicode-consumers project", async () => {
    const store = storeIn(() => 0);
    await store.save("account-1", { ...identity, expiresAt: 3_600_000 }, "aicode-consumers");
    expect(await store.status("account-1")).toMatchObject({ projectId: null });

    await store.setProjectId("account-1", "aicode-consumers");
    expect(await store.status("account-1")).toMatchObject({ projectId: null });
  });

  it("can flip the dogfood host flag without touching tokens", async () => {
    const store = storeIn(() => 0);
    await store.save("account-1", { ...identity, expiresAt: 3_600_000, isDogfood: false });
    expect(await store.status("account-1")).toMatchObject({ isDogfood: false });

    await store.setIsDogfood("account-1", true);
    expect(await store.status("account-1")).toMatchObject({ isDogfood: true });
    expect(await store.token("account-1")).toBe("ya29-live");
  });

  it("refreshes an aged-out token and writes the result back", async () => {
    let now = 0;
    const calls: URLSearchParams[] = [];
    const fetchImpl = (async (_url: any, init: any) => {
      calls.push(new URLSearchParams(String(init?.body ?? "")));
      return new Response(JSON.stringify({ access_token: "ya29-refreshed", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const store = storeIn(() => now, fetchImpl);
    await store.save("account-1", { ...identity, expiresAt: 1000 });

    now = 10_000; // well past expiry
    const token = await store.token("account-1");

    expect(token).toBe("ya29-refreshed");
    expect(calls[0]!.get("grant_type")).toBe("refresh_token");
    expect(calls[0]!.get("refresh_token")).toBe("1//refresh-me");

    // Written back: a second read sees the refreshed token without another network call.
    const status = await store.status("account-1");
    expect(status.expiresAt).toBe(now + 3_600_000);
  });

  it("forgets an account on request", async () => {
    const store = storeIn(() => 0);
    await store.save("account-1", { ...identity, expiresAt: 60_000 });
    await store.forget("account-1");
    expect(await store.status("account-1")).toMatchObject({ connected: false });
  });
});
