import type { AuthStatus } from "@doceomenter/auth";
import type { AiProvider } from "@doceomenter/shared";

/**
 * The provider a browser chose, shared by every form that can start a run.
 *
 * It is a preference, not a secret, so the browser is the right place for it. Kept in one
 * module so the main form's panel and the dashboard launcher open on the same choice.
 */
export const PREFERENCE_KEY = "doceomenter.provider";

export type ProviderChoice = { provider: AiProvider; model?: string };

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The saved choice, or null. A corrupt entry is dropped rather than thrown on. */
export function readSavedProviderChoice(storage: PreferenceStorage): ProviderChoice | null {
  let saved: string | null;
  try {
    saved = storage.getItem(PREFERENCE_KEY);
  } catch {
    return null;
  }
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as ProviderChoice;
    return parsed && typeof parsed.provider === "string" ? parsed : null;
  } catch {
    try {
      storage.removeItem(PREFERENCE_KEY);
    } catch {}
    return null;
  }
}

export function saveProviderChoice(storage: PreferenceStorage, choice: ProviderChoice): void {
  try {
    storage.setItem(PREFERENCE_KEY, JSON.stringify(choice));
  } catch {}
}

/**
 * The first provider that would actually work right now, or null.
 *
 * Opening on a provider with no credential means the first run silently falls back to
 * fixtures, and that is the app's fault, not the user's — they never chose anything.
 */
export function firstReadyProvider(status: Pick<AuthStatus, "providers">): ProviderChoice | null {
  const ready = status.providers.find((provider) => provider.ready);
  return ready ? { provider: ready.id as AiProvider, model: ready.defaultModel } : null;
}
