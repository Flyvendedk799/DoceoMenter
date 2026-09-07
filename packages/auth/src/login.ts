/**
 * The Claude subscription login, without a framework.
 *
 * `ai-auth` ships this as a Fastify plugin and DoceoMenter is a Next app, so the two useful
 * halves — hold a pending login, then exchange a pasted code against it — are lifted here and
 * the route handlers stay four thin files. The behaviour is deliberately identical to the
 * plugin's, including the parts that look like they could be skipped:
 *
 *   * The pending login lives in memory and nowhere else. The PKCE verifier is worthless after
 *     the exchange and dangerous before it, so the shortest possible life is the right one. A
 *     restart mid-login costs one click.
 *   * The `state` is checked. A code obtained in somebody else's approval, pasted here, has to
 *     be refused — that is the entire job of the parameter.
 *   * A code is single-use either way: one that failed cannot be retried, one that succeeded
 *     must not be replayed.
 */

import {
  ClaudeLoginError,
  exchangeClaudeCode,
  parsePastedCode,
  sameState,
  startClaudeLogin,
} from "@flyvendedk799/ai-auth";
import type { ClaudeAccountStore } from "@flyvendedk799/ai-auth";

/** Long enough to read a consent screen, not much more. */
const PENDING_TTL_MS = 10 * 60 * 1000;

/** A pasted code is short. Generous enough for a whole redirect URL and nothing more. */
const MAX_CODE_LENGTH = 2048;

type Pending = { verifier: string; state: string; expiresAt: number };

/** Pending logins, keyed by account. One per process; a restart clears them, which is correct. */
export type PendingLogins = Map<string, Pending>;

/**
 * Hung off the global rather than the module, because Next recompiles a route's module graph
 * on demand: a `Map` in module scope can be a *different* map between starting a login and
 * completing it, and the symptom of that is "that login has expired" on a code pasted five
 * seconds after it was issued.
 */
const globalKey = Symbol.for("doceomenter.pendingClaudeLogins");
const globals = globalThis as unknown as Record<symbol, PendingLogins | undefined>;
export const pendingLogins: PendingLogins = (globals[globalKey] ??= new Map());

export type LoginFailure = { ok: false; status: number; error: string; message: string; restart?: boolean };

export function startLogin(
  accountId: string,
  now = Date.now(),
  pending: PendingLogins = pendingLogins,
): { url: string; expiresInSeconds: number } {
  sweep(pending, now);
  const started = startClaudeLogin();
  pending.set(accountId, {
    verifier: started.verifier,
    state: started.state,
    expiresAt: now + PENDING_TTL_MS,
  });
  // The verifier stays here. Only the URL crosses to the browser.
  return { url: started.url, expiresInSeconds: Math.round(PENDING_TTL_MS / 1000) };
}

export async function completeLogin(
  accountId: string,
  code: unknown,
  store: ClaudeAccountStore,
  now = Date.now(),
  pending: PendingLogins = pendingLogins,
): Promise<{ ok: true; plan: string | null } | LoginFailure> {
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
    return {
      ok: false,
      status: 400,
      error: "bad_code",
      message: "Paste the code from the approval page.",
    };
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
    const identity = await exchangeClaudeCode({
      code: parsed.code,
      state: entry.state,
      verifier: entry.verifier,
    });
    await store.save(accountId, identity);
    return { ok: true, plan: identity.subscriptionType };
  } catch (error) {
    if (error instanceof ClaudeLoginError) {
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

export function forgetPendingLogin(accountId: string, pending: PendingLogins = pendingLogins): void {
  pending.delete(accountId);
}

/** Drop anything past its window. Called on each use, so no timer has to exist. */
function sweep(pending: PendingLogins, now: number): void {
  for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
}
