/**
 * Shared Cloud Code / Antigravity request identity.
 *
 * Google's backend checks that the caller looks like Antigravity (`agy`), not a bare
 * OAuth token from an unknown app. Missing these headers is a common path to
 * "Client is not eligible for Gemini Code Assist for individuals. Client does not support Google TOS."
 */

export const ANTIGRAVITY_CLIENT_METADATA = {
  ideType: "ANTIGRAVITY",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
} as const;

/**
 * Google's shared Cloud Code Assist consumer project.
 *
 * `loadCodeAssist` sometimes returns this for personal Google AI / Antigravity accounts.
 * Personal OAuth tokens have no IAM on it — attaching it as `x-goog-user-project` yields
 * `roles/serviceusage.serviceUsageConsumer` 403s. Enterprise/team setups may grant access;
 * DoceoMenter only supports personal Google AI subscriptions, so we never send it.
 */
export const GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT = "aicode-consumers";

/**
 * Keep only a project id a personal Antigravity login may bill against.
 * Drops empty values and Google's enterprise shared consumer project.
 */
export function sanitizePersonalCloudCodeProject(
  projectId: string | null | undefined,
): string | null {
  const trimmed = typeof projectId === "string" ? projectId.trim() : "";
  if (!trimmed) return null;
  if (trimmed === GOOGLE_ENTERPRISE_CLOUD_CODE_PROJECT) return null;
  return trimmed;
}

/** Headers every Cloud Code Assist call should carry (besides Authorization). */
export function antigravityRequestHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    "Content-Type": "application/json",
    "User-Agent": "antigravity",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify(ANTIGRAVITY_CLIENT_METADATA),
  };
}
