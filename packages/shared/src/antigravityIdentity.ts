/**
 * Shared Cloud Code / Antigravity request identity and hosts.
 *
 * These constants are the wire format `agy` actually sends — not Gemini CLI's Code Assist
 * proto. Sending `pluginType: GEMINI` + `platform: PLATFORM_UNSPECIFIED` makes Google run the
 * "Code Assist for individuals" TOS check and answer:
 *   "Client is not eligible … Client does not support Google TOS."
 * Then `generateContent` fails with #3501 because there is no managed project.
 *
 * Consumer / Google One / G1 accounts use the **daily** host, not `.sandbox`.
 * Sandbox is Google-internal dogfood of the API, not the G1 product.
 */

export const ANTIGRAVITY_VERSION = "1.21.9";

/** Short UA on generateContent (agy runtime). */
export const ANTIGRAVITY_REQUEST_USER_AGENT = `antigravity/${ANTIGRAVITY_VERSION} linux/amd64`;

/** Long UA on loadCodeAssist / onboardUser (agy control plane). */
export const ANTIGRAVITY_LOAD_USER_AGENT = `${ANTIGRAVITY_REQUEST_USER_AGENT} google-api-nodejs-client/10.3.0`;

export const ANTIGRAVITY_GOOG_API_CLIENT = "gl-node/22.21.1";

/** loadCodeAssist body — ideType only. Extra fields trigger the Gemini-CLI TOS path. */
export const ANTIGRAVITY_LOAD_METADATA = { ideType: "ANTIGRAVITY" } as const;

/** onboardUser body — snake_case, as agy sends it. */
export const ANTIGRAVITY_ONBOARD_METADATA = {
  ide_type: "ANTIGRAVITY",
  ide_version: ANTIGRAVITY_VERSION,
  ide_name: "antigravity",
} as const;

/**
 * Google's shared Cloud Code Assist consumer project.
 *
 * Real `agy` (prod OAuth + `aicode` scope) gets this back from `loadCodeAssist` on daily and
 * successfully calls generateContent with it in the **body only**. Putting it on
 * `x-goog-user-project` yields `roles/serviceusage.serviceUsageConsumer` 403s for personal
 * tokens. DoceoMenter mirrors that: body-only OK, never as the user-project header.
 */
export const GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT = "aicode-consumers";

/**
 * Keep only a project id safe for `x-goog-user-project`.
 * Drops empty values and Google's shared consumer project (header-unsafe for personal AI).
 */
export function sanitizePersonalCloudCodeProject(
  projectId: string | null | undefined,
): string | null {
  const trimmed = typeof projectId === "string" ? projectId.trim() : "";
  if (!trimmed) return null;
  if (trimmed === GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT) return null;
  return trimmed;
}

/**
 * Cloud Code subscription model ids as `agy` sends them (bare, no `models/` prefix).
 * UI/env often say `gemini-3.1-pro`, but daily only knows the tiered ids.
 */
export function normalizeAntigravityModelId(model: string): string {
  const trimmed = model.trim();
  const bare = trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
  if (bare === "gemini-3.1-pro" || bare === "gemini-3-pro") return "gemini-3.1-pro-low";
  return bare;
}

export const CLOUD_CODE_PROD_BASE_URL = "https://cloudcode-pa.googleapis.com/v1internal";
export const CLOUD_CODE_DAILY_BASE_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal";
/** @deprecated Alias — G1 uses daily, not sandbox. */
export const CLOUD_CODE_DOGFOOD_BASE_URL = CLOUD_CODE_DAILY_BASE_URL;
export const CLOUD_CODE_SANDBOX_BASE_URL =
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal";

/** generateContent host: personal / G1 / body-only companion → daily; else prod. */
export function cloudCodeBaseUrl(isDogfood?: boolean): string {
  return isDogfood ? CLOUD_CODE_DAILY_BASE_URL : CLOUD_CODE_PROD_BASE_URL;
}

/**
 * loadCodeAssist hosts. Personal Antigravity (`agy`) hits **daily first**; prod returns the
 * same companion id but generateContent there false-429s for consumer tokens.
 */
export function cloudCodeDiscoveryHosts(isDogfood?: boolean): readonly string[] {
  // Always daily → prod (→ sandbox for explicit dogfood). Matching agy's post-login order
  // matters more than the OAuth client flag.
  return isDogfood
    ? [CLOUD_CODE_DAILY_BASE_URL, CLOUD_CODE_PROD_BASE_URL, CLOUD_CODE_SANDBOX_BASE_URL]
    : [CLOUD_CODE_DAILY_BASE_URL, CLOUD_CODE_PROD_BASE_URL];
}

/** Headers for Cloud Code generateContent. */
export function antigravityRequestHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    Accept: "*/*",
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_REQUEST_USER_AGENT,
  };
}

/** Headers for loadCodeAssist / onboardUser. */
export function antigravityLoadHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    Accept: "*/*",
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_LOAD_USER_AGENT,
    "X-Goog-Api-Client": ANTIGRAVITY_GOOG_API_CLIENT,
  };
}

/** @deprecated Use ANTIGRAVITY_LOAD_METADATA. Kept so older imports keep compiling. */
export const ANTIGRAVITY_CLIENT_METADATA = ANTIGRAVITY_LOAD_METADATA;
