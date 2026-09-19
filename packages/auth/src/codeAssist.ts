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
 * Never puts Google's enterprise shared project `aicode-consumers` on `x-goog-user-project`
 * (personal tokens have no IAM there → 403). When load/onboard only name that project, we
 * still try to provision a personal one; if Google refuses, we return it as a **body-only**
 * companion id so generateContent can include `project` without the IAM header.
 */

import {
  ANTIGRAVITY_LOAD_METADATA,
  ANTIGRAVITY_ONBOARD_METADATA,
  antigravityLoadHeaders,
  CLOUD_CODE_DAILY_BASE_URL,
  cloudCodeDiscoveryHosts,
  GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT,
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

/** Result of discovery / onboarding — includes which Cloud Code surface yielded the project. */
export type CodeAssistDiscovery = {
  /**
   * Personal managed project — safe for `x-goog-user-project` and body `project`.
   * Null when Google only offered the enterprise shared companion project.
   */
  projectId: string | null;
  /**
   * When set, send as generateContent body `project` only — never as `x-goog-user-project`
   * (that header triggers serviceUsageConsumer 403 for personal Google AI tokens).
   */
  bodyOnlyProjectId?: string | null;
  /** True when traffic should use the daily (G1 / consumer) host. */
  isDogfood: boolean;
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

type HostDiscovery = { projectId: string | null; sawEnterpriseShared: boolean };

/**
 * Returns a personal project id suitable for `x-goog-user-project` / `generateContent.project`,
 * or a body-only shared companion fallback when Google will not provision anything else.
 */
export async function ensureCodeAssistProject(
  input: EnsureCodeAssistProjectInput,
): Promise<CodeAssistDiscovery | null> {
  const existing = sanitizePersonalCloudCodeProject(input.projectId);
  if (existing) {
    return { projectId: existing, isDogfood: Boolean(input.isDogfood) };
  }

  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    ...antigravityLoadHeaders(),
  };

  let sawEnterpriseShared = false;

  for (const baseURL of cloudCodeDiscoveryHosts(input.isDogfood)) {
    const result = await discoverOnHost({ baseURL, headers, doFetch, sleep });
    if (result.sawEnterpriseShared) sawEnterpriseShared = true;
    if (result.projectId) {
      return { projectId: result.projectId, isDogfood: isDailyHost(baseURL) };
    }
  }

  // Last resort matching working Antigravity clients: onboard free-tier on daily even when
  // every loadCodeAssist only named the enterprise shared project.
  const dailyFallback = await onboardFreeTierOnDaily({ headers, doFetch, sleep });
  if (dailyFallback.sawEnterpriseShared) sawEnterpriseShared = true;
  if (dailyFallback.projectId) {
    return { projectId: dailyFallback.projectId, isDogfood: true };
  }

  if (sawEnterpriseShared) {
    // Google bound this account to aicode-consumers and will not mint another id.
    // Send that id in the JSON body only; never as x-goog-user-project (IAM 403).
    console.error(
      `[code-assist] Google only named ${GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT}; using it as generateContent body project without x-goog-user-project`,
    );
    return {
      projectId: null,
      bodyOnlyProjectId: GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT,
      // Prefer daily for personal Google AI when prod only offered the shared companion.
      isDogfood: true,
    };
  }

  console.error("[code-assist] no managed project from any Cloud Code host; continuing without one");
  return null;
}

function isDailyHost(baseURL: string): boolean {
  return baseURL === CLOUD_CODE_DAILY_BASE_URL || baseURL.includes("daily-cloudcode-pa");
}

async function discoverOnHost(input: {
  baseURL: string;
  headers: Record<string, string>;
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): Promise<HostDiscovery> {
  const { baseURL, headers, doFetch, sleep } = input;

  let load: LoadCodeAssistResponse;
  try {
    load = await postJson<LoadCodeAssistResponse>(doFetch, `${baseURL}:loadCodeAssist`, headers, {
      metadata: ANTIGRAVITY_LOAD_METADATA,
    });
  } catch (error) {
    console.error(`[code-assist] loadCodeAssist ${baseURL}: ${(error as Error).message}`);
    return { projectId: null, sawEnterpriseShared: false };
  }

  const fromLoad = sanitizePersonalCloudCodeProject(readProjectId(load.cloudaicompanionProject));
  if (fromLoad) return { projectId: fromLoad, sawEnterpriseShared: false };
  const rawLoad = readProjectId(load.cloudaicompanionProject);
  let sawEnterpriseShared = false;
  if (rawLoad) {
    sawEnterpriseShared = rawLoad === GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT;
    console.error(
      `[code-assist] loadCodeAssist returned enterprise project ${rawLoad}; ignoring for personal Antigravity — will try onboardUser for a personal project`,
    );
  }

  const canOnboard = Boolean(
    load.currentTier ||
      load.paidTier ||
      (load.allowedTiers && load.allowedTiers.length > 0),
  );
  if (!canOnboard && !rawLoad) {
    const reasons = (load.ineligibleTiers ?? [])
      .map((t) => t.reasonMessage)
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    if (reasons.length) {
      console.error(`[code-assist] loadCodeAssist ${baseURL} ineligible: ${reasons.join("; ")}`);
    }
    return { projectId: null, sawEnterpriseShared };
  }

  const tierId =
    (load.allowedTiers ?? []).find((t) => t.isDefault)?.id ??
    load.allowedTiers?.[0]?.id ??
    load.currentTier?.id ??
    load.paidTier?.id ??
    FREE_TIER;

  const onboarded = await onboardUserOnHost({ baseURL, headers, doFetch, sleep, tierId });
  return {
    projectId: onboarded.projectId,
    sawEnterpriseShared: sawEnterpriseShared || onboarded.sawEnterpriseShared,
  };
}

/** Final fallback used by CLIProxyAPI-style clients: free-tier onboard on daily only. */
async function onboardFreeTierOnDaily(input: {
  headers: Record<string, string>;
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}): Promise<HostDiscovery> {
  console.error(
    `[code-assist] trying free-tier onboardUser on ${CLOUD_CODE_DAILY_BASE_URL} after hosts returned no personal project`,
  );
  return onboardUserOnHost({
    baseURL: CLOUD_CODE_DAILY_BASE_URL,
    headers: input.headers,
    doFetch: input.doFetch,
    sleep: input.sleep,
    tierId: FREE_TIER,
  });
}

async function onboardUserOnHost(input: {
  baseURL: string;
  headers: Record<string, string>;
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  tierId: string;
}): Promise<HostDiscovery> {
  const { baseURL, headers, doFetch, sleep, tierId } = input;

  let lro: OnboardUserResponse;
  try {
    lro = await postJson<OnboardUserResponse>(doFetch, `${baseURL}:onboardUser`, headers, {
      tier_id: tierId,
      metadata: ANTIGRAVITY_ONBOARD_METADATA,
    });
  } catch (error) {
    console.error(`[code-assist] onboardUser ${baseURL}: ${(error as Error).message}`);
    return { projectId: null, sawEnterpriseShared: false };
  }

  let polls = 0;
  while (!lro.done && lro.name && polls < ONBOARD_MAX_POLLS) {
    await sleep(ONBOARD_POLL_MS);
    polls += 1;
    try {
      lro = await getJson<OnboardUserResponse>(doFetch, `${baseURL}/${lro.name}`, headers);
    } catch (error) {
      console.error(`[code-assist] onboard poll ${baseURL}: ${(error as Error).message}`);
      return { projectId: null, sawEnterpriseShared: false };
    }
  }

  const fromOnboard = sanitizePersonalCloudCodeProject(readProjectId(lro.response?.cloudaicompanionProject));
  if (fromOnboard) {
    console.error(`[code-assist] onboardUser ${baseURL} provisioned personal project ${fromOnboard}`);
    return { projectId: fromOnboard, sawEnterpriseShared: false };
  }
  const rawOnboard = readProjectId(lro.response?.cloudaicompanionProject);
  if (rawOnboard) {
    console.error(
      `[code-assist] onboardUser returned enterprise project ${rawOnboard}; ignoring for personal Antigravity`,
    );
    return {
      projectId: null,
      sawEnterpriseShared: rawOnboard === GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT,
    };
  }
  return { projectId: null, sawEnterpriseShared: false };
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
