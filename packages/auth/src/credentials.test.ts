import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthRuntime, type AuthRuntime } from "./runtime.js";
import { loadAuthConfig } from "./config.js";
import { CredentialError, resolveProviderCredential } from "./credentials.js";
import { readAuthStatus } from "./status.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runtimeIn(env: Record<string, string | undefined> = {}): Promise<AuthRuntime> {
  const dir = await mkdtemp(join(tmpdir(), "doceomenter-auth-"));
  dirs.push(dir);
  const merged = {
    CREDENTIALS_DIR: dir,
    // The machine running the tests may well have a real `claude` login; a test that reads it
    // would pass or fail depending on whose laptop it is.
    ALLOW_LOCAL_CLI: "false",
    DOCEOMENTER_SECRET_KEY: "test-secret-key-0123456789abcdef",
    ...env,
  } as NodeJS.ProcessEnv;
  return buildAuthRuntime(loadAuthConfig(merged), merged);
}

describe("api key resolution", () => {
  it("prefers a key sent with the request over anything stored", async () => {
    const runtime = await runtimeIn({ ANTHROPIC_API_KEY: "sk-ant-from-env" });
    await runtime.keysFor(null).set("anthropic", "sk-ant-stored");

    const credential = await resolveProviderCredential({
      provider: "anthropic",
      inlineKey: "sk-ant-inline",
      runtime,
    });
    expect(credential).toMatchObject({ kind: "key", key: "sk-ant-inline", source: "request" });
  });

  it("prefers a stored key over the host environment", async () => {
    const runtime = await runtimeIn({ ANTHROPIC_API_KEY: "sk-ant-from-env" });
    await runtime.keysFor(null).set("anthropic", "sk-ant-stored");

    const credential = await resolveProviderCredential({ provider: "anthropic", runtime });
    expect(credential).toMatchObject({ key: "sk-ant-stored", source: "stored" });
  });

  it("falls back to the environment, and says so", async () => {
    const runtime = await runtimeIn({ OPENAI_API_KEY: "sk-from-env" });
    const credential = await resolveProviderCredential({ provider: "openai", runtime });
    expect(credential).toMatchObject({ key: "sk-from-env", source: "environment", wire: "openai" });
  });

  it("fails with an actionable message when there is no key at all", async () => {
    const runtime = await runtimeIn({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined });
    await expect(resolveProviderCredential({ provider: "openai", runtime })).rejects.toBeInstanceOf(
      CredentialError,
    );
  });

  it("keeps one browser's key out of another's runs", async () => {
    const runtime = await runtimeIn({ ANTHROPIC_API_KEY: undefined });
    await runtime.keysFor("browser-a").set("anthropic", "sk-ant-belongs-to-a");

    const mine = await resolveProviderCredential({
      provider: "anthropic",
      accountId: "browser-a",
      runtime,
    });
    expect(mine).toMatchObject({ key: "sk-ant-belongs-to-a" });

    await expect(
      resolveProviderCredential({ provider: "anthropic", accountId: "browser-b", runtime }),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("never writes a key to disk in the clear", async () => {
    const runtime = await runtimeIn();
    await runtime.keysFor(null).set("anthropic", "sk-ant-super-secret-value");
    const file = await readFile(join(runtime.config.dataDir, "credentials.json"), "utf8");
    expect(file).not.toContain("sk-ant-super-secret-value");
    // The mask is stored beside the ciphertext so a settings page costs no decryption.
    expect(file).toContain("sk-ant");
  });
});

describe("claude subscription resolution", () => {
  const identity = {
    accessToken: "sk-ant-oat-live",
    refreshToken: "refresh-me",
    expiresAt: Date.now() + 60 * 60 * 1000,
    scopes: ["user:inference"],
    subscriptionType: "max",
  };

  it("uses the account's own connected subscription", async () => {
    const runtime = await runtimeIn();
    await runtime.accounts.save("account-1", identity);

    const credential = await resolveProviderCredential({
      provider: "claude-code",
      accountId: "account-1",
      runtime,
    });
    expect(credential).toMatchObject({
      kind: "subscription",
      token: "sk-ant-oat-live",
      plan: "max",
      source: "account",
    });
  });

  it("does not hand one account's subscription to another", async () => {
    const runtime = await runtimeIn();
    await runtime.accounts.save("account-1", identity);

    await expect(
      resolveProviderCredential({ provider: "claude-code", accountId: "account-2", runtime }),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("refuses codex when machine logins are disabled", async () => {
    const runtime = await runtimeIn();
    await expect(
      resolveProviderCredential({ provider: "codex", runtime }),
    ).rejects.toThrow(/machine logins are disabled/);
  });
});

describe("status for the provider panel", () => {
  it("reports readiness and a masked hint, never the key", async () => {
    const runtime = await runtimeIn({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined });
    await runtime.accounts.save("account-1", {
      accessToken: "sk-ant-oat-live",
      refreshToken: null,
      expiresAt: Date.now() + 60 * 60 * 1000,
      scopes: [],
      subscriptionType: "pro",
    });
    await runtime.keysFor("account-1").set("openai", "sk-openai-secret-value");

    const status = await readAuthStatus("account-1", runtime);
    const byId = Object.fromEntries(status.providers.map((p) => [p.id, p]));

    expect(status.available).toBe(true);
    expect(byId["claude-code"]).toMatchObject({ ready: true, source: "connected account", plan: "pro" });
    expect(byId.openai).toMatchObject({ ready: true, source: "stored key" });
    expect(byId.openai?.hint).not.toContain("secret-value");
    expect(byId.anthropic).toMatchObject({ ready: false, source: "none", hint: null });
    // The picker needs the tier to be able to say "try a lighter model".
    expect(byId["claude-code"]?.models.some((m) => m.tier === "light")).toBe(true);
  });

  it("says so when nothing can be stored", async () => {
    const runtime = await runtimeIn({ CREDENTIALS_DATABASE_URL: "postgres://nope" });
    const status = await readAuthStatus(null, runtime);
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/CREDENTIALS_DATABASE_URL/);
  });
});
