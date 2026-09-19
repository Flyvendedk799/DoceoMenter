/**
 * Resolve the managed Cloud Code project the way Antigravity (`agy`) / Gemini CLI do.
 *
 * Personal Google AI Pro/Ultra accounts are often **ineligible for free-tier** Code Assist and
 * only offered `standard-tier`, which requires the user to supply their own GCP project id
 * (same rule as `GOOGLE_CLOUD_PROJECT` in gemini-cli). Without that project, `onboardUser`
 * completes with no `cloudaicompanionProject` and `generateContent` answers #3501
 * SUBSCRIPTION_REQUIRED — even though Google AI Pro is active on the account.
 *
 * Never puts Google's enterprise shared project `aicode-consumers` on `x-goog-user-project`
 * (personal tokens have no IAM there → 403). When load/onboard only name that project, we
 * return it as a body-only companion id.
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
const STANDARD_TIER = "standard-tier";
const ONBOARD_POLL_MS = 2_000;
const ONBOARD_MAX_POLLS = 30;

export type EnsureCodeAssistProjectInput = {
  accessToken: string;
  isDogfood?: boolean;
  /** User-typed or previously discovered personal GCP / managed project id. */
  projectId?: string | null;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Optional sink for discovery steps (run Worker log / UI). Also printed on stderr. */
  log?: (line: string) => void;
};

export type CodeAssistDiscovery = {
  projectId: string | null;
  bodyOnlyProjectId?: string | null;
  isDogfood: boolean;
};

export class CodeAssistSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CodeAssistSetupError";
  }
}

type CodeAssistTier = {
  id?: string;
  name?: string;
  isDefault?: boolean;
  userDefinedCloudaicompanionProject?: boolean;
};

type LoadCodeAssistResponse = {
  currentTier?: CodeAssistTier | null;
  allowedTiers?: CodeAssistTier[] | null;
  cloudaicompanionProject?: string | { id?: string } | null;
  paidTier?: CodeAssistTier | null;
  ineligibleTiers?: Array<{ reasonMessage?: string; reasonCode?: string; tierId?: string }> | null;
};

type OnboardUserResponse = {
  name?: string;
  done?: boolean;
  response?: { cloudaicompanionProject?: { id?: string; name?: string } | string };
};

type HostDiscovery = {
  projectId: string | null;
  sawEnterpriseShared: boolean;
  /** True when Google only offered a tier that needs the user to supply a GCP project. */
  needsUserProject: boolean;
};

function assistLog(log: ((line: string) => void) | undefined, line: string): void {
  console.error(line);
  try {
    log?.(line);
  } catch {
    // Discovery must never fail because a log sink threw.
  }
}

/** Clear copy for the run UI / CredentialError when standard-tier needs a GCP project. */
export function gcpProjectRequiredMessage(): string {
  return (
    "Google AI Pro/Ultra for Antigravity is on Code Assist standard-tier, which needs your own " +
    "GCP project id (free-tier Code Assist is not available for this account). In the provider " +
    "panel under Antigravity, set PERSONAL GCP PROJECT to a project you own, enable the Gemini " +
    "for Google Cloud API on it, Save, then retry. Create a project at " +
    "https://console.cloud.google.com/ if you do not have one yet."
  );
}

export async function ensureCodeAssistProject(
  input: EnsureCodeAssistProjectInput,
): Promise<CodeAssistDiscovery | null> {
  const userProject = sanitizePersonalCloudCodeProject(input.projectId);
  const doFetch = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    ...antigravityLoadHeaders(),
  };
  const hosts = cloudCodeDiscoveryHosts(input.isDogfood);
  assistLog(
    input.log,
    `[code-assist] discovering managed project dogfood=${input.isDogfood ? "yes" : "no"} ` +
      `userProject=${userProject ?? "(none)"} hosts=${hosts.join(" → ")}`,
  );

  let sawEnterpriseShared = false;
  let needsUserProject = false;

  for (const baseURL of hosts) {
    const result = await discoverOnHost({
      baseURL,
      headers,
      doFetch,
      sleep,
      log: input.log,
      userProject,
    });
    if (result.sawEnterpriseShared) sawEnterpriseShared = true;
    if (result.needsUserProject) needsUserProject = true;
    if (result.projectId) {
      assistLog(
        input.log,
        `[code-assist] personal project=${result.projectId} from ${baseURL} (header+body safe)`,
      );
      return { projectId: result.projectId, isDogfood: isDailyHost(baseURL) };
    }
  }

  // Free-tier last resort only when Google did not already say this account needs a user GCP project.
  if (!needsUserProject) {
    const dailyFallback = await onboardUserOnHost({
      baseURL: CLOUD_CODE_DAILY_BASE_URL,
      headers,
      doFetch,
      sleep,
      tierId: FREE_TIER,
      log: input.log,
      userProject: null,
      needsUserProject: false,
    });
    if (dailyFallback.sawEnterpriseShared) sawEnterpriseShared = true;
    if (dailyFallback.projectId) {
      assistLog(
        input.log,
        `[code-assist] personal project=${dailyFallback.projectId} from daily free-tier onboard`,
      );
      return { projectId: dailyFallback.projectId, isDogfood: true };
    }
  }

  if (needsUserProject && !userProject) {
    assistLog(input.log, `[code-assist] ${gcpProjectRequiredMessage()}`);
    throw new CodeAssistSetupError(gcpProjectRequiredMessage());
  }

  // User typed a GCP project but hosts did not return a managed id — bill against theirs
  // (gemini-cli does the same when onboard omits cloudaicompanionProject).
  if (userProject) {
    assistLog(
      input.log,
      `[code-assist] using user GCP project=${userProject} after discovery (standard-tier path)`,
    );
    return { projectId: userProject, isDogfood: Boolean(input.isDogfood) || needsUserProject };
  }

  if (sawEnterpriseShared) {
    assistLog(
      input.log,
      `[code-assist] Google only named ${GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT}; using it as generateContent body project without x-goog-user-project (daily host)`,
    );
    return {
      projectId: null,
      bodyOnlyProjectId: GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT,
      isDogfood: true,
    };
  }

  assistLog(input.log, "[code-assist] no managed project from any Cloud Code host; continuing without one");
  return null;
}

function isDailyHost(baseURL: string): boolean {
  return baseURL === CLOUD_CODE_DAILY_BASE_URL || baseURL.includes("daily-cloudcode-pa");
}

function tierNeedsUserProject(tier: CodeAssistTier | null | undefined): boolean {
  if (!tier?.id) return false;
  if (tier.userDefinedCloudaicompanionProject === true) return true;
  const id = tier.id.toLowerCase();
  return id === STANDARD_TIER || id === "legacy-tier" || (id !== FREE_TIER && id !== "free");
}

function selectOnboardTier(load: LoadCodeAssistResponse): CodeAssistTier {
  const allowed = load.allowedTiers ?? [];
  const fromDefault = allowed.find((t) => t.isDefault);
  if (fromDefault) return fromDefault;
  if (allowed[0]) return allowed[0];
  if (load.currentTier?.id) return load.currentTier;
  if (load.paidTier?.id) return load.paidTier;
  return { id: FREE_TIER };
}

async function discoverOnHost(input: {
  baseURL: string;
  headers: Record<string, string>;
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  userProject: string | null;
}): Promise<HostDiscovery> {
  const { baseURL, headers, doFetch, sleep, log, userProject } = input;

  let load: LoadCodeAssistResponse;
  try {
    const body: Record<string, unknown> = { metadata: ANTIGRAVITY_LOAD_METADATA };
    if (userProject) body.cloudaicompanionProject = userProject;
    load = await postJson<LoadCodeAssistResponse>(doFetch, `${baseURL}:loadCodeAssist`, headers, body);
  } catch (error) {
    assistLog(log, `[code-assist] loadCodeAssist ${baseURL}: ${(error as Error).message}`);
    return { projectId: null, sawEnterpriseShared: false, needsUserProject: false };
  }

  const fromLoad = sanitizePersonalCloudCodeProject(readProjectId(load.cloudaicompanionProject));
  if (fromLoad) return { projectId: fromLoad, sawEnterpriseShared: false, needsUserProject: false };

  const rawLoad = readProjectId(load.cloudaicompanionProject);
  let sawEnterpriseShared = false;
  if (rawLoad) {
    sawEnterpriseShared = rawLoad === GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT;
    assistLog(
      log,
      `[code-assist] loadCodeAssist ${baseURL} returned enterprise project ${rawLoad}; will try onboardUser`,
    );
  } else {
    assistLog(
      log,
      `[code-assist] loadCodeAssist ${baseURL} ok tiers=${summarizeTiers(load)} project=(none)`,
    );
  }

  // Already onboarded to a tier but no companion project in the payload — use the user's GCP
  // project when present (gemini-cli setupUser does the same).
  if (load.currentTier?.id && userProject && !rawLoad) {
    assistLog(
      log,
      `[code-assist] loadCodeAssist ${baseURL} has currentTier=${load.currentTier.id} without companion project; using user GCP project=${userProject}`,
    );
    return { projectId: userProject, sawEnterpriseShared: false, needsUserProject: false };
  }

  const canOnboard = Boolean(
    load.currentTier || load.paidTier || (load.allowedTiers && load.allowedTiers.length > 0),
  );
  if (!canOnboard && !rawLoad) {
    const reasons = (load.ineligibleTiers ?? [])
      .map((t) => t.reasonMessage)
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    if (reasons.length) {
      assistLog(log, `[code-assist] loadCodeAssist ${baseURL} ineligible: ${reasons.join("; ")}`);
    }
    return { projectId: null, sawEnterpriseShared, needsUserProject: false };
  }

  const tier = selectOnboardTier(load);
  const tierId = tier.id ?? FREE_TIER;
  const needsUserProject = tierNeedsUserProject(tier);

  if (needsUserProject && !userProject) {
    assistLog(
      log,
      `[code-assist] ${baseURL} offers tier=${tierId} which requires a user GCP project (free-tier ineligible or not default)`,
    );
    return { projectId: null, sawEnterpriseShared, needsUserProject: true };
  }

  const onboarded = await onboardUserOnHost({
    baseURL,
    headers,
    doFetch,
    sleep,
    tierId,
    log,
    userProject,
    needsUserProject,
  });
  return {
    projectId: onboarded.projectId,
    sawEnterpriseShared: sawEnterpriseShared || onboarded.sawEnterpriseShared,
    needsUserProject: needsUserProject || onboarded.needsUserProject,
  };
}

function summarizeTiers(load: LoadCodeAssistResponse): string {
  const parts: string[] = [];
  if (load.currentTier?.id) parts.push(`current=${load.currentTier.id}`);
  if (load.paidTier?.id) parts.push(`paid=${load.paidTier.id}`);
  const allowed = (load.allowedTiers ?? []).map((t) => t.id).filter(Boolean);
  if (allowed.length) parts.push(`allowed=${allowed.join(",")}`);
  const ineligible = (load.ineligibleTiers ?? [])
    .map((t) => t.tierId ?? t.reasonCode)
    .filter(Boolean);
  if (ineligible.length) parts.push(`ineligible=${ineligible.join(",")}`);
  return parts.length ? parts.join(" ") : "(none)";
}

async function onboardUserOnHost(input: {
  baseURL: string;
  headers: Record<string, string>;
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  tierId: string;
  log?: (line: string) => void;
  userProject: string | null;
  needsUserProject: boolean;
}): Promise<HostDiscovery> {
  const { baseURL, headers, doFetch, sleep, tierId, log, userProject, needsUserProject } = input;

  const body: Record<string, unknown> = {
    tier_id: tierId,
    metadata: ANTIGRAVITY_ONBOARD_METADATA,
  };
  // Free-tier must NOT send a project (Precondition Failed). Standard/legacy need the user's.
  if (needsUserProject && userProject) {
    body.cloudaicompanionProject = userProject;
  }

  let lro: OnboardUserResponse;
  try {
    assistLog(
      log,
      `[code-assist] onboardUser ${baseURL} tier=${tierId}` +
        `${userProject && needsUserProject ? ` cloudaicompanionProject=${userProject}` : ""}`,
    );
    lro = await postJson<OnboardUserResponse>(doFetch, `${baseURL}:onboardUser`, headers, body);
  } catch (error) {
    assistLog(log, `[code-assist] onboardUser ${baseURL}: ${(error as Error).message}`);
    return { projectId: null, sawEnterpriseShared: false, needsUserProject };
  }

  let polls = 0;
  while (!lro.done && lro.name && polls < ONBOARD_MAX_POLLS) {
    await sleep(ONBOARD_POLL_MS);
    polls += 1;
    try {
      lro = await getJson<OnboardUserResponse>(doFetch, `${baseURL}/${lro.name}`, headers);
    } catch (error) {
      assistLog(log, `[code-assist] onboard poll ${baseURL}: ${(error as Error).message}`);
      return { projectId: null, sawEnterpriseShared: false, needsUserProject };
    }
  }

  const fromOnboard = sanitizePersonalCloudCodeProject(
    readProjectId(lro.response?.cloudaicompanionProject),
  );
  if (fromOnboard) {
    assistLog(log, `[code-assist] onboardUser ${baseURL} provisioned personal project ${fromOnboard}`);
    return { projectId: fromOnboard, sawEnterpriseShared: false, needsUserProject: false };
  }
  const rawOnboard = readProjectId(lro.response?.cloudaicompanionProject);
  if (rawOnboard) {
    assistLog(
      log,
      `[code-assist] onboardUser ${baseURL} returned enterprise project ${rawOnboard}; ignoring for personal Antigravity`,
    );
    return {
      projectId: null,
      sawEnterpriseShared: rawOnboard === GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT,
      needsUserProject,
    };
  }

  // Standard-tier onboard often returns done with no companion id — use the user project.
  if (userProject && needsUserProject) {
    assistLog(
      log,
      `[code-assist] onboardUser ${baseURL} done without companion project; using user GCP project=${userProject}`,
    );
    return { projectId: userProject, sawEnterpriseShared: false, needsUserProject: false };
  }

  assistLog(log, `[code-assist] onboardUser ${baseURL} done but no cloudaicompanionProject in response`);
  return { projectId: null, sawEnterpriseShared: false, needsUserProject };
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
