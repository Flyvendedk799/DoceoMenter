import { modelSpec } from "@flyvendedk799/ai-auth/registry";

export type WireKind = "anthropic" | "openai" | "gemini";

/**
 * Pick the models a run will call.
 *
 * An explicit panel selection wins for the primary. For Antigravity (gemini wire),
 * always keep `gemini-3-flash` as fallback when the panel picks a non-flash model —
 * `gemini-3.1-pro-low` frequently returns MALFORMED_FUNCTION_CALL on DoceoMenter's
 * complex tool schemas (ServerHoster run c2f352a52e19), and flash reliably emits tools.
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

  if (input.wire === "gemini") {
    const isFlash = /flash/i.test(requested);
    return {
      primary: requested,
      fallback: isFlash ? requested : "gemini-3-flash",
      fromPanel: true,
    };
  }

  return { primary: requested, fallback: requested, fromPanel: true };
}
