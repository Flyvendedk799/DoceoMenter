/**
 * Turning "the user picked Claude" into something a client can be built from.
 *
 * The resolution order per provider is the interesting part, and it is the same shape in both
 * halves: the credential belonging to *this visitor* first, the machine's own login second,
 * the deployment's environment last. Anything else gets the ordering backwards — a server
 * whose operator has exported `ANTHROPIC_API_KEY` would spend the operator's money on every
 * visitor's run while their own connected subscription sat unused.
 *
 * Nothing here is cached. A subscription token is refreshed by the account store at the moment
 * it is asked for, so the worker resolves at call time rather than being handed a token that
 * was fresh when the job was enqueued.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { ClaudeCodeCredential, CodexCredential, decodeJwtClaims, type CodexIdentity } from "@flyvendedk799/ai-auth";
import type { KeySource, ProviderId } from "@flyvendedk799/ai-auth";
import { sanitizePersonalCloudCodeProject } from "@doceomenter/shared";
import { refreshGeminiToken, type GeminiOAuthIdentity } from "./geminiOAuth.js";
import { CodeAssistSetupError, ensureCodeAssistProject } from "./codeAssist.js";
import { describeProvider } from "./providers.js";
import { getAuthRuntime, type AuthRuntime } from "./runtime.js";

export type CredentialSource = KeySource | "request" | "account" | "local-cli";

export type ProviderCredential =
  | { provider: ProviderId; wire: "anthropic"; kind: "key"; key: string; source: CredentialSource }
  | { provider: ProviderId; wire: "openai"; kind: "key"; key: string; source: CredentialSource }
  | {
      provider: "claude-code";
      wire: "anthropic";
      kind: "subscription";
      token: string;
      plan: string | null;
      source: "account" | "local-cli";
    }
  | {
      provider: "codex";
      wire: "openai";
      kind: "subscription";
      accessToken: string;
      accountId: string | null;
      plan: string | null;
      source: "local-cli";
    }
  | {
      provider: "gemini-cli";
      wire: "gemini";
      kind: "subscription";
      accessToken: string;
      /**
       * A personal GCP / managed Cloud Code project id, when one is known.
       * Never Google's enterprise shared project `aicode-consumers`.
       */
      projectId: string | null;
      plan: string | null;
      isDogfood?: boolean;
      source: "account" | "local-cli";
    };

/** A credential that is missing rather than broken: the message says what to do about it. */
export class CredentialError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    /** True when connecting or pasting something fixes it, rather than an operator change. */
    readonly recoverable = true,
  ) {
    super(message);
    this.name = "CredentialError";
  }
}

export type ResolveOptions = {
  provider: ProviderId;
  /** The visitor's account id, from the signed cookie. Absent for a worker with no session. */
  accountId?: string | null;
  /** A key sent with this one request. Highest precedence, never stored. */
  inlineKey?: string | undefined;
  runtime?: AuthRuntime;
  env?: NodeJS.ProcessEnv;
  /** Test seam for Code Assist onboarding / token refresh. */
  fetchImpl?: typeof fetch;
};

export async function resolveProviderCredential(
  options: ResolveOptions,
): Promise<ProviderCredential> {
  const runtime = options.runtime ?? (await getAuthRuntime(options.env));
  const { provider } = options;

  if (provider === "claude-code") return resolveClaudeSubscription(options, runtime);
  if (provider === "codex") return resolveCodexSubscription(options, runtime);
  if (provider === "gemini-cli") return resolveGeminiSubscription(options, runtime);
  return resolveApiKey(options, runtime);
}

async function resolveClaudeSubscription(
  options: ResolveOptions,
  runtime: AuthRuntime,
): Promise<ProviderCredential> {
  if (options.accountId) {
    const status = await runtime.accounts.status(options.accountId);
    if (status.connected) {
      // `token()` refreshes an aged-out credential and writes the rotated refresh token back
      // before handing anything out — see the account store's own note on why that matters.
      return {
        provider: "claude-code",
        wire: "anthropic",
        kind: "subscription",
        token: await runtime.accounts.token(options.accountId),
        plan: status.plan,
        source: "account",
      };
    }
  }

  if (runtime.config.allowLocalCli) {
    const local = await readLocalClaudeStatus();
    if (local.connected) {
      return {
        provider: "claude-code",
        wire: "anthropic",
        kind: "subscription",
        token: await localClaude.token(),
        plan: local.subscriptionType,
        source: "local-cli",
      };
    }
  }

  throw new CredentialError(
    "No Claude subscription is connected. Sign in from the provider panel, or pick the Anthropic API key provider instead.",
    "claude-code",
  );
}

async function resolveCodexSubscription(
  options: ResolveOptions,
  runtime: AuthRuntime,
): Promise<ProviderCredential> {
  if (!runtime.config.allowLocalCli) {
    throw new CredentialError(
      "Codex runs on the `codex` login of the machine hosting this app, and machine logins are disabled here (ALLOW_LOCAL_CLI=false).",
      "codex",
      false,
    );
  }
  const identity = await new CodexCredential().identity();
  return {
    provider: "codex",
    wire: "openai",
    kind: "subscription",
    accessToken: identity.accessToken,
    accountId: identity.accountId,
    plan: identity.planType,
    source: "local-cli",
  };
}

/**
 * Antigravity subscription — UI Connect first, same idea as Claude Code's panel login.
 *
 * Browser visitors always have an account cookie. For those runs we **never** fall through to
 * the host's `agy` login on ServerHoster: that would spend the operator's machine quota while
 * the visitor thought they had signed in (or just switched accounts) in the panel. Connect
 * Antigravity in the provider panel is the only personal path for a browser session.
 *
 * Machine `agy` remains available only when there is no browser account id (headless/local).
 */
async function resolveGeminiSubscription(
  options: ResolveOptions,
  runtime: AuthRuntime,
): Promise<ProviderCredential> {
  if (options.accountId) {
    const status = await runtime.geminiAccounts.status(options.accountId);
    if (status.connected) {
      const accessToken = await runtime.geminiAccounts.token(options.accountId);
      const discovered = await resolveManagedProject({
        accessToken,
        isDogfood: status.isDogfood,
        projectId: status.projectId,
        options,
        persist: async (discovery) => {
          await runtime.geminiAccounts.setProjectId(options.accountId!, discovery.projectId);
          if (discovery.isDogfood !== status.isDogfood) {
            await runtime.geminiAccounts.setIsDogfood(options.accountId!, discovery.isDogfood);
          }
        },
      });
      const isDogfood = discovered?.isDogfood ?? status.isDogfood;
      return {
        provider: "gemini-cli",
        wire: "gemini",
        kind: "subscription",
        accessToken,
        projectId: discovered?.projectId ?? null,
        plan: status.email,
        isDogfood,
        source: "account",
      };
    }
    throw new CredentialError(
      "No Antigravity account is connected for this browser. Open the provider panel, choose Antigravity, and Connect with your personal Google AI account — the same idea as signing in with Claude Code. This run will not use the machine `agy` login on the server.",
      "gemini-cli",
    );
  }

  if (runtime.config.allowLocalCli) {
    const local = await localGemini.status();
    if (local.connected) {
      const env = options.env ?? process.env;
      const accessToken = await localGemini.token();
      const discovered = await resolveManagedProject({
        accessToken,
        isDogfood: undefined,
        projectId: env.GEMINI_PROJECT_ID?.trim() || null,
        options,
      });
      return {
        provider: "gemini-cli",
        wire: "gemini",
        kind: "subscription",
        accessToken,
        projectId: discovered?.projectId ?? null,
        plan: local.email,
        isDogfood: discovered?.isDogfood,
        source: "local-cli",
      };
    }
  }

  throw new CredentialError(
    "No Antigravity login is connected. Connect Antigravity from the provider panel with your personal Google AI account.",
    "gemini-cli",
  );
}

/**
 * Ask Cloud Code for the managed project id `agy` would discover via loadCodeAssist/onboardUser.
 * Without a usable personal project, flagship models often answer #3501 or a misleading 429
 * RESOURCE_EXHAUSTED even with a valid token and dashboard quota remaining.
 * Enterprise shared project `aicode-consumers` is never kept or sent.
 */
async function resolveManagedProject(input: {
  accessToken: string;
  isDogfood?: boolean;
  projectId: string | null;
  options: ResolveOptions;
  persist?: (discovery: { projectId: string | null; isDogfood: boolean }) => Promise<void>;
}): Promise<{ projectId: string; isDogfood: boolean } | null> {
  const cleanedStored = sanitizePersonalCloudCodeProject(input.projectId);
  // Drop a previously persisted enterprise project so the next status read is honest.
  if (input.projectId && !cleanedStored && input.persist) {
    await input.persist({ projectId: null, isDogfood: Boolean(input.isDogfood) });
  }

  try {
    const resolved = await ensureCodeAssistProject({
      accessToken: input.accessToken,
      isDogfood: input.isDogfood,
      projectId: cleanedStored,
      ...(input.options.fetchImpl ? { fetchImpl: input.options.fetchImpl } : {}),
    });
    // Soft-fail paths return null (TOS / Dogfood skip / enterprise-only / HTTP error).
    if (
      resolved &&
      input.persist &&
      (resolved.projectId !== cleanedStored || resolved.isDogfood !== Boolean(input.isDogfood))
    ) {
      await input.persist(resolved);
    }
    return resolved;
  } catch (error) {
    if (error instanceof CodeAssistSetupError) {
      throw new CredentialError(error.message, "gemini-cli");
    }
    throw error;
  }
}

async function resolveApiKey(
  options: ResolveOptions,
  runtime: AuthRuntime,
): Promise<ProviderCredential> {
  const provider = options.provider;
  const wire = describeProvider(provider).wire;

  const inline = options.inlineKey?.trim();
  if (inline) {
    return { provider, wire, kind: "key", key: inline, source: "request" } as ProviderCredential;
  }

  // The store answers settings-then-environment and says which one it was, which is the
  // difference between "no key" and "a key you cannot see because it came from the host".
  const resolved = await runtime.keysFor(options.accountId ?? null).resolve(provider);
  if (resolved.key) {
    return {
      provider,
      wire,
      kind: "key",
      key: resolved.key,
      source: resolved.source,
    } as ProviderCredential;
  }

  const envVar =
    wire === "anthropic" ? "ANTHROPIC_API_KEY" : wire === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
  throw new CredentialError(
    `No ${describeProvider(provider).label} is configured. Add one in the provider panel, or set ${envVar} on the server.`,
    provider,
  );
}

/**
 * One instance per process, deliberately.
 *
 * It re-reads the CLI's file on every call — so a sign-out is seen immediately — but keeps a
 * token it refreshed itself in memory. A fresh instance per request would throw that away and
 * re-refresh, and each refresh rotates a token the CLI is also holding.
 */
const localClaude = new ClaudeCodeCredential();

/** Whether this machine has a `claude` login, and whose plan it is. Never throws. */
export async function readLocalClaudeStatus(): Promise<{
  connected: boolean;
  subscriptionType: string | null;
  expired: boolean;
}> {
  try {
    const status = await localClaude.status();
    return {
      connected: status.connected,
      subscriptionType: status.subscriptionType,
      expired: status.expired,
    };
  } catch {
    return { connected: false, subscriptionType: null, expired: false };
  }
}

/** The machine's own `codex` login, or null. Never throws. */
export async function readLocalCodex(): Promise<CodexIdentity | null> {
  try {
    return await new CodexCredential().identity();
  } catch {
    return null;
  }
}

/** Treat a token as spent this long before it really expires. */
const EXPIRY_BUFFER_MS = 60_000;

/**
 * Harvests the Antigravity CLI (`agy`) login already on this machine.
 *
 * There is no `ai-auth` equivalent to import here — see `geminiOAuth.ts`'s header. Only the
 * Linux file path is implemented: `~/.gemini/antigravity-cli/antigravity-oauth-token`, the
 * exact path and JSON shape read off a real `agy` v1.2.6` login on this project's own VPS.
 * `agy` also caches this in the macOS Keychain and Windows Credential Manager on those
 * platforms — unimplemented here, the same way `ai-auth`'s own harvesters grew platform
 * support one real machine at a time rather than guessing at formats nobody had read yet.
 *
 * Same two rules as every other local-cli reader in this codebase: re-read the file on every
 * call rather than own it, and refresh only once the token has genuinely expired, keeping the
 * result in memory rather than writing it back — the file belongs to `agy`, not to this app.
 */
class AntigravityLocalCredential {
  private inMemoryRefreshed: { accessToken: string; expiresAt: number; email: string | null } | null = null;

  private async read(): Promise<GeminiOAuthIdentity | null> {
    try {
      const path = join(homedir(), ".gemini", "antigravity-cli", "antigravity-oauth-token");
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as {
        token?: { access_token?: unknown; refresh_token?: unknown; expiry?: unknown };
        id_token?: unknown;
      };
      const accessToken = parsed.token?.access_token;
      if (typeof accessToken !== "string" || accessToken.length === 0) return null;

      const refreshToken = parsed.token?.refresh_token;
      const expiresAt = typeof parsed.token?.expiry === "string" ? Date.parse(parsed.token.expiry) : NaN;
      const claims = typeof parsed.id_token === "string" ? decodeJwtClaims(parsed.id_token) : null;
      const email = typeof claims?.email === "string" ? claims.email : null;

      return {
        accessToken,
        refreshToken: typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : null,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
        email,
      };
    } catch {
      return null;
    }
  }

  private expired(expiresAt: number, now = Date.now()): boolean {
    return expiresAt - EXPIRY_BUFFER_MS <= now;
  }

  async status(): Promise<{ connected: boolean; email: string | null; expired: boolean }> {
    const identity = await this.read();
    if (!identity) return { connected: false, email: null, expired: false };
    const effective = this.inMemoryRefreshed ?? identity;
    return { connected: true, email: effective.email, expired: this.expired(effective.expiresAt) };
  }

  async token(): Promise<string> {
    const identity = await this.read();
    if (!identity) {
      throw new CredentialError(
        "No Antigravity CLI login found on this machine. Run `agy` there and sign in with your personal Google AI account, then reload.",
        "gemini-cli",
      );
    }

    const effective =
      this.inMemoryRefreshed && !this.expired(this.inMemoryRefreshed.expiresAt) ? this.inMemoryRefreshed : identity;
    if (!this.expired(effective.expiresAt)) return effective.accessToken;

    if (!identity.refreshToken) {
      throw new CredentialError(
        "The Antigravity CLI login on this machine has expired and has no refresh token. Run `agy` there to sign in again with your personal Google AI account.",
        "gemini-cli",
      );
    }

    const refreshed = await refreshGeminiToken(identity.refreshToken, { isDogfood: identity.email === "tobygopro@gmail.com" });
    this.inMemoryRefreshed = {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      email: refreshed.email ?? identity.email,
    };
    return this.inMemoryRefreshed.accessToken;
  }
}

/** One instance per process — see the class's own note on why a fresh one per request is wrong. */
const localGemini = new AntigravityLocalCredential();

/** Whether this machine has an `agy` login, and which Google account it is. Never throws. */
export async function readLocalGeminiStatus(): Promise<{
  connected: boolean;
  email: string | null;
  expired: boolean;
}> {
  return localGemini.status();
}
