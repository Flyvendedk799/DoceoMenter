/**
 * Resolve the managed Cloud Code Assist project the way `agy` / Gemini CLI does.
 *
 * Personal and Google One accounts do not type a GCP project id. The CLI calls
 * `loadCodeAssist`, and if needed `onboardUser`, then uses the
 * `cloudaicompanionProject` Google returns — a managed project, not one the user owns.
 *
 * Returns null when Google refuses discovery (e.g. client TOS eligibility) so the caller
 * can still attempt `generateContent` — hard-blocking the run here was worse than #3501.
 */

import { antigravityCliOptions } from "@flyvendedk799/ai-auth";
import { ANTIGRAVITY_CLIENT_METADATA, antigravityRequestHeaders } from "@doceomenter/shared";

const FREE_TIER = "free-tier";
const ONBOARD_POLL_MS = 2_000;
const ONBOARD_MAX_POLLS = 30;

export type EnsureCodeAssistProjectInput = {
  accessToken: string;
  isDogfood?: boolean;
  /** Already known (user-typed or previously discovered). Skip the network when set. */
  projectId?: string | null;
  fetchImpl?: typeof fetch;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
};

export class CodeAssistSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CodeAssistSetupError";
  }
}

type LoadCodeAssistResponse = {
  currentTier?: { id?: string; name?: string } | null;
  allowedTiers?: Array<{ id?: string; name?: string; isDefault?: boolean }> | null;
  cloudaicompanionProject?: string | null;
  ineligibleTiers?: Array<{ reasonMessage?: string; reasonCode?: string }> | null;
};

type OnboardUserResponse = {
  name?: string;
  done?: boolean;
  response?: { cloudaicompanionProject?: { id?: string; name?: string } };
};

/**
 * Returns a project id suitable for `x-goog-user-project` / `generateContent.project`,
 * or null when discovery is refused / unavailable.
 */
export async function ensureCodeAssistProject(
  input: EnsureCodeAssistProjectInput,
): Promise<string | null> {
  const existing = input.projectId?.trim() || null;
  if (existing) return existing;

  // Dogfood / G1: `agy` often never needs loadCodeAssist for a typed project. Calling it
  // with the wrong client identity returns "Client does not support Google TOS" and blocks
  // the run before generateContent — skip discovery and let generateContent proceed.
  if (input.isDogfood) return null;

  const wire = antigravityCliOptions({
    accessToken: input.accessToken,
    projectId: null,
    refreshToken: null,
    expiresAt: 0,
    email: null,
    isDogfood: false,
  });
  const baseURL = wire.baseURL ?? "https://cloudcode-pa.googleapis.com/v1internal";
  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    ...antigravityRequestHeaders(),
  };

  let load: LoadCodeAssistResponse;
  try {
    load = await postJson<LoadCodeAssistResponse>(doFetch, `${baseURL}:loadCodeAssist`, headers, {
      metadata: ANTIGRAVITY_CLIENT_METADATA,
    });
  } catch (error) {
    // Soft-fail: still allow generateContent; the worker will surface #3501 if that fails too.
    console.error(`[code-assist] loadCodeAssist failed: ${(error as Error).message}`);
    return null;
  }

  if (typeof load.cloudaicompanionProject === "string" && load.cloudaicompanionProject.trim()) {
    return load.cloudaicompanionProject.trim();
  }

  if (load.currentTier) {
    console.error(
      "[code-assist] onboarded account returned no managed project; continuing without one",
    );
    return null;
  }

  if (load.ineligibleTiers?.length) {
    const reasons = load.ineligibleTiers
      .map((t) => t.reasonMessage)
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    const joined = reasons.join("; ");
    // TOS / "individuals" eligibility is a client-identity refusal, not a missing license on
    // the Google account. Do not hard-fail the run — generateContent may still work as `agy` does.
    console.error(`[code-assist] loadCodeAssist ineligible: ${joined || "unknown"}`);
    return null;
  }

  const tier = (load.allowedTiers ?? []).find((t) => t.isDefault) ?? load.allowedTiers?.[0];
  const tierId = tier?.id ?? FREE_TIER;

  let lro: OnboardUserResponse;
  try {
    lro = await postJson<OnboardUserResponse>(doFetch, `${baseURL}:onboardUser`, headers, {
      tierId,
      metadata: ANTIGRAVITY_CLIENT_METADATA,
    });
  } catch (error) {
    console.error(`[code-assist] onboardUser failed: ${(error as Error).message}`);
    return null;
  }

  let polls = 0;
  while (!lro.done && lro.name && polls < ONBOARD_MAX_POLLS) {
    await sleep(ONBOARD_POLL_MS);
    polls += 1;
    try {
      lro = await getJson<OnboardUserResponse>(doFetch, `${baseURL}/${lro.name}`, headers);
    } catch (error) {
      console.error(`[code-assist] onboard poll failed: ${(error as Error).message}`);
      return null;
    }
  }

  return lro.response?.cloudaicompanionProject?.id?.trim() || null;
}

async function postJson<T>(
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<T> {
  const response = await doFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function getJson<T>(
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  const response = await doFetch(url, { method: "GET", headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}
