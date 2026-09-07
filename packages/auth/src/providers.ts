/**
 * The four ways a run can be paid for.
 *
 * `ai-auth` splits a provider from the wire it speaks — `claude-code` and `anthropic` both
 * talk to the Messages API, but only one of them bills a card — and that split is exactly the
 * distinction this app needs to show a user. Two entries per wire is not duplication in the
 * picker; it is the whole question the picker exists to ask.
 */

import { isSubscription, wireOf, type ProviderId } from "@flyvendedk799/ai-auth/registry";

export type ProviderDescriptor = {
  id: ProviderId;
  label: string;
  /** One line, written for the person choosing. */
  blurb: string;
  wire: "anthropic" | "openai";
  kind: "subscription" | "key";
  /** Default model ids, as registry ids. Overridable per deployment through the worker env. */
  defaults: { primary: string; fallback: string };
};

export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: "claude-code",
    label: "Claude subscription",
    blurb: "Sign in with your Claude plan. Runs bill to your account, not to this server.",
    wire: "anthropic",
    kind: "subscription",
    defaults: { primary: "claude-opus-5", fallback: "claude-sonnet-5" },
  },
  {
    id: "anthropic",
    label: "Anthropic API key",
    blurb: "A metered key. Encrypted here, masked for display, never readable back out.",
    wire: "anthropic",
    kind: "key",
    defaults: { primary: "claude-opus-5", fallback: "claude-sonnet-5" },
  },
  {
    id: "codex",
    label: "ChatGPT subscription (Codex)",
    blurb: "Uses the `codex` login already on this machine. Nothing to paste, nothing to store.",
    wire: "openai",
    kind: "subscription",
    defaults: { primary: "gpt-5", fallback: "gpt-5-mini" },
  },
  {
    id: "openai",
    label: "OpenAI API key",
    blurb: "A metered key. Encrypted here, masked for display, never readable back out.",
    wire: "openai",
    kind: "key",
    defaults: { primary: "gpt-5", fallback: "gpt-5-mini" },
  },
];

export function describeProvider(provider: ProviderId): ProviderDescriptor {
  const found = PROVIDERS.find((p) => p.id === provider);
  if (found) return found;
  // Unreachable for the four ids in the registry, but a provider read off a persisted run is
  // still worth rendering rather than crashing on.
  return {
    id: provider,
    label: provider,
    blurb: "",
    wire: wireOf(provider),
    kind: isSubscription(provider) ? "subscription" : "key",
    defaults: { primary: "", fallback: "" },
  };
}

export function providerLabel(provider: ProviderId): string {
  return describeProvider(provider).label;
}
