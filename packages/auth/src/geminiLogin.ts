/**
 * The Gemini subscription login, without a framework.
 *
 * Same shape as `login.ts`'s Claude version, and the same reasons for it: hold the pending
 * login in memory only, treat a code as single-use either way. See that file's header for the
 * full reasoning — it applies here unchanged, with one gap worth being clear-eyed about:
 * Anthropic's authorize page hands back `code#state` together, so a pasted value carries its
 * own proof of which login it belongs to. Google/Antigravity's callback page (`redirectUri` in
 * `geminiOAuth.ts`) shows only the bare authorization code — no `state` alongside it, at least
 * in every login this was tested against. `parsePastedCode` still runs and `sameState` still
 * gets called when a `state` *is* present (a pasted full URL would carry one in its query), but
 * the bare-code case Google actually presents skips that check entirely, because there is
 * nothing in what the user copies to check it against. In practice this narrows to: someone
 * would have to be talked into pasting a code from an attacker's own Google approval into
 * their own DoceoMenter session, which connects the attacker's account to the victim's
 * session — a nuisance, not a credential theft, but a real gap `login.ts`'s Claude flow does
 * not have.
 */

import { parsePastedCode, sameState } from "@flyvendedk799/ai-auth";
import { GeminiLoginError, exchangeGeminiCode, startGeminiLogin as beginGeminiOAuth } from "./geminiOAuth.js";
import type { GeminiAccountStore } from "./geminiAccountStore.js";

/** Long enough to read a consent screen, not much more. */
const PENDING_TTL_MS = 10 * 60 * 1000;

/** A pasted code is short. Generous enough for a whole redirect URL and nothing more. */
const MAX_CODE_LENGTH = 2048;

type Pending = { verifier: string; state: string; expiresAt: number; isDogfood: boolean };

/** Pending logins, keyed by account. One per process; a restart clears them, which is correct. */
export type PendingGeminiLogins = Map<string, Pending>;

/** See `login.ts`'s identical note: this has to survive Next's per-route module recompiles. */
const globalKey = Symbol.for("doceomenter.pendingGeminiLogins");
const globals = globalThis as unknown as Record<symbol, PendingGeminiLogins | undefined>;
export const pendingGeminiLogins: PendingGeminiLogins = (globals[globalKey] ??= new Map());

export type GeminiLoginFailure = { ok: false; status: number; error: string; message: string; restart?: boolean };

export function startGeminiOAuthLogin(
  accountId: string,
  email?: string,
  now = Date.now(),
  pending: PendingGeminiLogins = pendingGeminiLogins,
): { url: string; expiresInSeconds: number } {
  sweep(pending, now);
  const started = beginGeminiOAuth(email);
  pending.set(accountId, {
    verifier: started.verifier,
    state: started.state,
    expiresAt: now + PENDING_TTL_MS,
    isDogfood: email === "tobygopro@gmail.com",
  });
  return { url: started.url, expiresInSeconds: Math.round(PENDING_TTL_MS / 1000) };
}

export async function completeGeminiOAuthLogin(
  accountId: string,
  code: unknown,
  store: GeminiAccountStore,
  now = Date.now(),
  pending: PendingGeminiLogins = pendingGeminiLogins,
): Promise<{ ok: true; email: string | null } | GeminiLoginFailure> {
  sweep(pending, now);
  const entry = pending.get(accountId);
  if (!entry) {
    return {
      ok: false,
      status: 400,
      error: "no_pending_login",
      message: "That login has expired or was never started. Run the command again.",
    };
  }

  if (typeof code !== "string" || code.length > MAX_CODE_LENGTH) {
    return { ok: false, status: 400, error: "bad_code", message: "Paste the code from the approval page." };
  }

  const parsed = parsePastedCode(code);
  if (!parsed) {
    return {
      ok: false,
      status: 400,
      error: "bad_code",
      message: "That does not look like an authorization code.",
    };
  }

  if (parsed.state !== null && !sameState(entry.state, parsed.state)) {
    return {
      ok: false,
      status: 400,
      error: "state_mismatch",
      message: "That code came from a different login. Start again and use the newest link.",
    };
  }

  pending.delete(accountId);

  try {
    const identity = await exchangeGeminiCode({ code: parsed.code, verifier: entry.verifier, isDogfood: entry.isDogfood });
    await store.save(accountId, identity);
    return { ok: true, email: identity.email };
  } catch (error) {
    if (error instanceof GeminiLoginError) {
      return {
        ok: false,
        status: 400,
        error: "exchange_failed",
        message: error.message,
        restart: error.restart,
      };
    }
    throw error;
  }
}

export function forgetPendingGeminiLogin(
  accountId: string,
  pending: PendingGeminiLogins = pendingGeminiLogins,
): void {
  pending.delete(accountId);
}

/** Drop anything past its window. Called on each use, so no timer has to exist. */
function sweep(pending: PendingGeminiLogins, now: number): void {
  for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
}
