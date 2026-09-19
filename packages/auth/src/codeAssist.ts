/**
 * Resolve the managed Cloud Code project the way Antigravity (`agy`) does.
 *
 * Personal Google AI / Google One accounts never type a GCP project id. `agy` POSTs
 * `loadCodeAssist` with `{ metadata: { ideType: "ANTIGRAVITY" } }` and, if needed,
 * `onboardUser` with snake_case metadata, then uses `cloudaicompanionProject`.
 *
 * Gemini CLI's Code Assist metadata (`pluginType: GEMINI`, `platform: PLATFORM_UNSPECIFIED`)
 * is a different product. Google answers "Client does not support Google TOS" for that shape,
 * which is not a missing license on the account.
 *
 * Never accepts Google's enterprise shared project `aicode-consumers` (personal accounts
 * have no IAM there). Returns null when discovery is refused or yields that project so
 * `generateContent` can proceed without it.
 */

import {
  ANTIGRAVITY_LOAD_METADATA,
  ANTIGRAVITY_ONBOARD_METADATA,
  antigravityLoadHeaders,
  cloudCodeDiscoveryHosts,
  sanitizePersonalCloudCodeProject,
} from "@doceomenter/shared";

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
  cloudaicompanionProject?: string | { id?: string } | null;
  paidTier?: { id?: string } | null;
  ineligibleTiers?: Array<{ reasonMessage?: string; reasonCode?: string; tierId?: string }> | null;
};

type OnboardUserResponse = {
  name?: string;
  done?: boolean;
  response?: { cloudaicompanionProject?: { id?: string; name?: string } | string };
};

/**
 * Returns a project id suitable for `x-goog-user-project` / `generateContent.project`,
 * or null when discovery is refused / unavailable / enterprise-only.
 */
export async function ensureCodeAssistProject(
  input: EnsureCodeAssistProjectInput,
): Promise<string | null> {
  const existing = sanitizePersonalCloudCodeProject(input.projectId);
  if (existing) return existing;

  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    ...antigravityLoadHeaders(),
  };

  for (const baseURL of cloudCodeDiscoveryHosts(input.isDogfood)) {
    const projectId = await discoverOnHost({ baseURL, headers, doFetch, sleep });
    if (projectId) return projectId;
  }

  console.error("[code-assist] no managed project from any Cloud Code host; continuing without one");
  return null;
}

async function discoverOnHost(input: {
  baseURL: string;
  headers: Record<string, string>;
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): Promise<string | null> {
  const { baseURL, headers, doFetch, sleep } = input;

  let load: LoadCodeAssistResponse;
  try {
    load = await postJson<LoadCodeAssistResponse>(doFetch, `${baseURL}:loadCodeAssist`, headers, {
      metadata: ANTIGRAVITY_LOAD_METADATA,
    });
  } catch (error) {
    console.error(`[code-assist] loadCodeAssist ${baseURL}: ${(error as Error).message}`);
    return null;
  }

  const fromLoad = sanitizePersonalCloudCodeProject(readProjectId(load.cloudaicompanionProject));
  if (fromLoad) return fromLoad;
  const rawLoad = readProjectId(load.cloudaicompanionProject);
  if (rawLoad) {
    console.error(
      `[code-assist] loadCodeAssist returned enterprise project ${rawLoad}; ignoring for personal Antigravity`,
    );
    // Do not try onboardUser on this host — Google already named a project we cannot use.
    return null;
  }

  const canOnboard = Boolean(
    load.currentTier ||
      load.paidTier ||
      (load.allowedTiers && load.allowedTiers.length > 0),
  );
  // ineligibleTiers is often present *alongside* a usable paid/default tier. Only skip this
  // host when Google offered nothing we can onboard.
  if (!canOnboard) {
    const reasons = (load.ineligibleTiers ?? [])
      .map((t) => t.reasonMessage)
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    if (reasons.length) {
      console.error(`[code-assist] loadCodeAssist ${baseURL} ineligible: ${reasons.join("; ")}`);
    }
    return null;
  }

  const tierId =
    (load.allowedTiers ?? []).find((t) => t.isDefault)?.id ??
    load.allowedTiers?.[0]?.id ??
    load.currentTier?.id ??
    load.paidTier?.id ??
    FREE_TIER;

  let lro: OnboardUserResponse;
  try {
    lro = await postJson<OnboardUserResponse>(doFetch, `${baseURL}:onboardUser`, headers, {
      tier_id: tierId,
      metadata: ANTIGRAVITY_ONBOARD_METADATA,
    });
  } catch (error) {
    console.error(`[code-assist] onboardUser ${baseURL}: ${(error as Error).message}`);
    return null;
  }

  let polls = 0;
  while (!lro.done && lro.name && polls < ONBOARD_MAX_POLLS) {
    await sleep(ONBOARD_POLL_MS);
    polls += 1;
    try {
      lro = await getJson<OnboardUserResponse>(doFetch, `${baseURL}/${lro.name}`, headers);
    } catch (error) {
      console.error(`[code-assist] onboard poll ${baseURL}: ${(error as Error).message}`);
      return null;
    }
  }

  const fromOnboard = sanitizePersonalCloudCodeProject(readProjectId(lro.response?.cloudaicompanionProject));
  if (fromOnboard) return fromOnboard;
  const rawOnboard = readProjectId(lro.response?.cloudaicompanionProject);
  if (rawOnboard) {
    console.error(
      `[code-assist] onboardUser returned enterprise project ${rawOnboard}; ignoring for personal Antigravity`,
    );
  }
  return null;
}

function readProjectId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
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
