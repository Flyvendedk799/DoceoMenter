/**
 * Shared Cloud Code / Antigravity request identity and hosts.
 *
 * Google's backend checks that the caller looks like Antigravity (`agy`), not a bare
 * OAuth token from an unknown app. Missing these headers is a common path to
 * "Client is not eligible for Gemini Code Assist for individuals. Client does not support Google TOS."
 *
 * Dogfood / G1 credits live on the **sandbox** daily host — `daily-cloudcode-pa.googleapis.com`
 * (no `.sandbox`) accepts the call but answers #3501 SUBSCRIPTION_REQUIRED for the same token.
 */

export const ANTIGRAVITY_CLIENT_METADATA = {
  ideType: "ANTIGRAVITY",
  platform: "PLATFORM_UNSPECIFIED",
  pluginType: "GEMINI",
} as const;

/** Prod Cloud Code Assist internal API root (includes `/v1internal`). */
export const CLOUD_CODE_PROD_BASE_URL = "https://cloudcode-pa.googleapis.com/v1internal";

/**
 * Dogfood / G1 Cloud Code Assist internal API root.
 * Matches `agy` and working Antigravity clients — not `daily-cloudcode-pa.googleapis.com`.
 */
export const CLOUD_CODE_DOGFOOD_BASE_URL =
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal";

export function cloudCodeBaseUrl(isDogfood?: boolean): string {
  return isDogfood ? CLOUD_CODE_DOGFOOD_BASE_URL : CLOUD_CODE_PROD_BASE_URL;
}

/** Headers every Cloud Code Assist call should carry (besides Authorization). */
export function antigravityRequestHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    "Content-Type": "application/json",
    "User-Agent": "antigravity/1.15.8 linux/amd64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify(ANTIGRAVITY_CLIENT_METADATA),
  };
}
