import { modelSpec } from "@flyvendedk799/ai-auth/registry";

export type WireKind = "anthropic" | "openai" | "gemini";

/**
 * Pick the models a run will call.
 *
 * An explicit panel selection wins and is used alone — no silent downgrade to the
 * deployment's GEMINI_MODEL_FALLBACK / etc. That mismatch is how a UI showing
 * `gemini-3.1-pro` ended up erroring about `gemini-1.5-flash`.
 */
export function resolveRunModels(input: {
  wire: WireKind;
  requestedModel?: string;
  configuredPrimary: string;
  configuredFallback: string;
}): { primary: string; fallback: string; fromPanel: boolean } {
  const requested = input.requestedModel?.trim();
  if (!requested) {
    return {
      primary: input.configuredPrimary,
      fallback: input.configuredFallback,
      fromPanel: false,
    };
  }

  const requestedWire = modelSpec(requested)?.wire;
  const usable = requestedWire === undefined || requestedWire === input.wire;
  if (!usable) {
    return {
      primary: input.configuredPrimary,
      fallback: input.configuredFallback,
      fromPanel: false,
    };
  }

  return { primary: requested, fallback: requested, fromPanel: true };
}
