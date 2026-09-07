import { NextResponse } from "next/server";
import { forgetPendingLogin } from "@doceomenter/auth";
import { resolveCaller, withAccountCookie } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISCONNECTED = { connected: false, plan: null, expiresAt: null, expired: false, scopes: [] };

/**
 * Is this browser's Claude subscription connected, and to what.
 *
 * The shape is `ai-auth`'s own `ClaudeConnection`, because the React component that renders it
 * is the library's — `available: false` is how a deployment with nowhere to keep a credential
 * says so, and the component hides the feature rather than offering one that cannot work.
 */
export async function GET(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller.runtime.available) {
    return withAccountCookie(
      NextResponse.json({ ...DISCONNECTED, available: false, reason: caller.runtime.reason }),
      caller,
    );
  }
  const status = await caller.runtime.accounts.status(caller.accountId);
  return withAccountCookie(NextResponse.json({ ...status, available: true }), caller);
}

/** Disconnect. Drops any half-finished login with it, so a stale code cannot be redeemed. */
export async function DELETE(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller.runtime.available) {
    return withAccountCookie(NextResponse.json({ error: "no_store" }, { status: 503 }), caller);
  }
  forgetPendingLogin(caller.accountId);
  await caller.runtime.accounts.forget(caller.accountId);
  return withAccountCookie(NextResponse.json({ ...DISCONNECTED, available: true }), caller);
}
