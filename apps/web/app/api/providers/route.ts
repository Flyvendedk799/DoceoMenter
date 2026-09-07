import { NextResponse } from "next/server";
import { readAuthStatus, wireOf, type ProviderId } from "@doceomenter/auth";
import { AI_PROVIDERS } from "@doceomenter/shared";
import { resolveCaller, withAccountCookie } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A key is a secret, not an essay. Long enough for any provider's format, short enough to reject junk. */
const MAX_KEY_LENGTH = 400;

/** Every way this browser could pay for a run, and whether each of them would work right now. */
export async function GET(request: Request) {
  const caller = await resolveCaller(request);
  const status = await readAuthStatus(caller.accountId, caller.runtime);
  return withAccountCookie(NextResponse.json(status), caller);
}

/**
 * Store an API key, or clear it by sending an empty one.
 *
 * It goes in encrypted and comes back only as a mask: the response is the same status payload
 * the panel renders, so there is no path here that hands a stored key back to a browser — not
 * even to the browser that stored it.
 */
export async function PUT(request: Request) {
  const caller = await resolveCaller(request);
  const body = (await request.json().catch(() => ({}))) as { provider?: unknown; key?: unknown };

  if (!isProvider(body.provider)) {
    return withAccountCookie(
      NextResponse.json({ error: "unknown_provider" }, { status: 400 }),
      caller,
    );
  }
  if (body.key !== null && typeof body.key !== "string") {
    return withAccountCookie(NextResponse.json({ error: "bad_key" }, { status: 400 }), caller);
  }
  if (typeof body.key === "string" && body.key.length > MAX_KEY_LENGTH) {
    return withAccountCookie(NextResponse.json({ error: "key_too_long" }, { status: 400 }), caller);
  }
  if (!caller.runtime.available) {
    return withAccountCookie(
      NextResponse.json(
        { error: "no_store", message: caller.runtime.reason },
        { status: 503 },
      ),
      caller,
    );
  }

  // Keyed by wire rather than by provider: a subscription has no key to store, and an
  // Anthropic key is an Anthropic key whichever provider entry the panel offered it under.
  // Scoped to this browser, so a key pasted here is not spent by the next visitor.
  await caller.runtime
    .keysFor(caller.accountId)
    .set(wireOf(body.provider), typeof body.key === "string" ? body.key : null);

  const status = await readAuthStatus(caller.accountId, caller.runtime);
  return withAccountCookie(NextResponse.json(status), caller);
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}
