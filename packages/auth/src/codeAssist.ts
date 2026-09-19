/**
 * Resolve the managed Cloud Code Assist project the way `agy` / Gemini CLI does.
 *
 * Personal and Google One accounts do not type a GCP project id. The CLI calls
 * `loadCodeAssist`, and if needed `onboardUser`, then uses the
 * `cloudaicompanionProject` Google returns — a managed project, not one the user owns.
 * Calling `generateContent` without that step is a common path to #3501 SUBSCRIPTION_REQUIRED.
 */

import { antigravityCliOptions } from "@flyvendedk799/ai-auth";

const METADATA = {
  ideType: "IDE_UNSPECIFIED",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
} as const;

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
 * Returns a project id suitable for `x-goog-user-project` / `generateContent.project`.
 */
export async function ensureCodeAssistProject(input: EnsureCodeAssistProjectInput): Promise<string> {
  const existing = input.projectId?.trim() || null;
  if (existing) return existing;

  const wire = antigravityCliOptions({
    accessToken: input.accessToken,
    projectId: null,
    refreshToken: null,
    expiresAt: 0,
    email: null,
    isDogfood: input.isDogfood ?? false,
  });
  const baseURL = wire.baseURL ?? "https://cloudcode-pa.googleapis.com/v1internal";
  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    "Content-Type": "application/json",
  };

  let load: LoadCodeAssistResponse;
  try {
    load = await postJson<LoadCodeAssistResponse>(doFetch, `${baseURL}:loadCodeAssist`, headers, {
      metadata: METADATA,
    });
  } catch (error) {
    throw new CodeAssistSetupError(
      `Could not load Code Assist for this Google account (${(error as Error).message}). ` +
        `Reconnect from the provider panel` +
        `${input.isDogfood ? " with G1 Dogfood checked" : ""} and try again.`,
      { cause: error },
    );
  }

  if (typeof load.cloudaicompanionProject === "string" && load.cloudaicompanionProject.trim()) {
    return load.cloudaicompanionProject.trim();
  }

  if (load.currentTier) {
    throw new CodeAssistSetupError(
      "Google says this account is already onboarded to Code Assist but returned no managed project. " +
        "That usually means the license is on a different environment (Prod vs G1 Dogfood) — " +
        "disconnect, toggle Dogfood to match where `agy` works, and connect again.",
    );
  }

  if (load.ineligibleTiers?.length) {
    const reasons = load.ineligibleTiers
      .map((t) => t.reasonMessage)
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    throw new CodeAssistSetupError(
      reasons.length
        ? `This Google account is not eligible for Code Assist: ${reasons.join("; ")}`
        : "This Google account is not eligible for Code Assist.",
    );
  }

  const tier = (load.allowedTiers ?? []).find((t) => t.isDefault) ?? load.allowedTiers?.[0];
  const tierId = tier?.id ?? FREE_TIER;

  // Free tier must not send a user-defined project (CLI: Precondition Failed if you do).
  let lro: OnboardUserResponse;
  try {
    lro = await postJson<OnboardUserResponse>(doFetch, `${baseURL}:onboardUser`, headers, {
      tierId,
      cloudaicompanionProject: undefined,
      metadata: METADATA,
    });
  } catch (error) {
    throw new CodeAssistSetupError(
      `Code Assist onboarding failed (${(error as Error).message}). Reconnect from the provider panel and try again.`,
      { cause: error },
    );
  }

  let polls = 0;
  while (!lro.done && lro.name && polls < ONBOARD_MAX_POLLS) {
    await sleep(ONBOARD_POLL_MS);
    polls += 1;
    try {
      lro = await getJson<OnboardUserResponse>(doFetch, `${baseURL}/${lro.name}`, headers);
    } catch (error) {
      throw new CodeAssistSetupError(
        `Timed out waiting for Code Assist onboarding (${(error as Error).message}).`,
        { cause: error },
      );
    }
  }

  const discovered = lro.response?.cloudaicompanionProject?.id?.trim() || null;
  if (!discovered) {
    throw new CodeAssistSetupError(
      "Code Assist onboarding finished without a managed project id. " +
        "Try connecting again from the provider panel, matching the Dogfood toggle to where `agy` works.",
    );
  }
  return discovered;
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
