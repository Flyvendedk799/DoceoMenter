/**
 * What the provider panel renders.
 *
 * One entry per provider, each answering the same three questions: can a run be paid for this
 * way right now, where would that payment come from, and what can be shown about it without
 * decrypting anything. A key is never in here — `hint` is a mask built from the plaintext at
 * write time, which is the most a settings page is ever entitled to.
 */

import { modelsFor, type ModelSpec, type ProviderId } from "@flyvendedk799/ai-auth/registry";
import { readLocalClaudeStatus, readLocalCodex } from "./credentials.js";
import { PROVIDERS, type ProviderDescriptor } from "./providers.js";
import { getAuthRuntime, type AuthRuntime } from "./runtime.js";

export type ProviderStatus = Omit<ProviderDescriptor, "defaults"> & {
  /** True when a run using this provider would find a credential. */
  ready: boolean;
  /** Where that credential comes from, in words a person can act on. */
  source: "connected account" | "machine login" | "stored key" | "environment" | "none";
  /** `sk-ant-…9ZQ`, or null. Never the key. */
  hint: string | null;
  /** The plan a subscription belongs to, when the provider says so. */
  plan: string | null;
  /** True for a subscription whose access token has aged out. It refreshes on next use. */
  expired: boolean;
  models: ModelSpec[];
  defaultModel: string;
};

export type AuthStatus = {
  /** False when credentials cannot be persisted at all. */
  available: boolean;
  reason?: string;
  /**
   * True when the encryption key only exists for the life of this process, so anything stored
   * now reads as disconnected after a restart. Worth saying out loud rather than discovering.
   */
  ephemeralSecret: boolean;
  /** False when machine logins are disabled, which changes what the panel should offer. */
  localCliEnabled: boolean;
  providers: ProviderStatus[];
};

export async function readAuthStatus(
  accountId: string | null,
  runtimeOrEnv?: AuthRuntime | NodeJS.ProcessEnv,
): Promise<AuthStatus> {
  const runtime = isRuntime(runtimeOrEnv)
    ? runtimeOrEnv
    : await getAuthRuntime(runtimeOrEnv as NodeJS.ProcessEnv | undefined);

  const [claudeAccount, localClaude, localCodex] = await Promise.all([
    accountId ? runtime.accounts.status(accountId) : Promise.resolve(null),
    runtime.config.allowLocalCli ? readLocalClaudeStatus() : Promise.resolve(null),
    runtime.config.allowLocalCli ? readLocalCodex() : Promise.resolve(null),
  ]);

  const providers: ProviderStatus[] = [];
  for (const descriptor of PROVIDERS) {
    const { defaults, ...rest } = descriptor;
    const models = modelsFor(descriptor.id);
    const base = {
      ...rest,
      models,
      defaultModel: defaults.primary,
      hint: null as string | null,
      plan: null as string | null,
      expired: false,
    };

    if (descriptor.id === "claude-code") {
      if (claudeAccount?.connected) {
        providers.push({
          ...base,
          ready: true,
          source: "connected account",
          plan: claudeAccount.plan,
          expired: claudeAccount.expired,
        });
      } else if (localClaude?.connected) {
        providers.push({
          ...base,
          ready: true,
          source: "machine login",
          plan: localClaude.subscriptionType,
          expired: localClaude.expired,
        });
      } else {
        providers.push({ ...base, ready: false, source: "none" });
      }
      continue;
    }

    if (descriptor.id === "codex") {
      providers.push(
        localCodex
          ? { ...base, ready: true, source: "machine login", plan: localCodex.planType }
          : { ...base, ready: false, source: "none" },
      );
      continue;
    }

    const keys = runtime.keysFor(accountId);
    const resolved = await keys.resolve(descriptor.id as ProviderId);
    providers.push({
      ...base,
      ready: resolved.ready,
      source:
        resolved.source === "stored"
          ? "stored key"
          : resolved.source === "environment"
            ? "environment"
            : "none",
      hint: await keys.hint(descriptor.wire),
    });
  }

  return {
    available: runtime.available,
    ...(runtime.reason ? { reason: runtime.reason } : {}),
    ephemeralSecret: runtime.secretSource === "ephemeral",
    localCliEnabled: runtime.config.allowLocalCli,
    providers,
  };
}

function isRuntime(value: unknown): value is AuthRuntime {
  return typeof value === "object" && value !== null && "accounts" in value && "keysFor" in value;
}
