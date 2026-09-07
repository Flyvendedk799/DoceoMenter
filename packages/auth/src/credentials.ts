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

import { ClaudeCodeCredential, CodexCredential, type CodexIdentity } from "@flyvendedk799/ai-auth";
import type { KeySource, ProviderId } from "@flyvendedk799/ai-auth";
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
};

export async function resolveProviderCredential(
  options: ResolveOptions,
): Promise<ProviderCredential> {
  const runtime = options.runtime ?? (await getAuthRuntime(options.env));
  const { provider } = options;

  if (provider === "claude-code") return resolveClaudeSubscription(options, runtime);
  if (provider === "codex") return resolveCodexSubscription(options, runtime);
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

  throw new CredentialError(
    `No ${describeProvider(provider).label} is configured. Add one in the provider panel, or set ${
      wire === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"
    } on the server.`,
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
