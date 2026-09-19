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
