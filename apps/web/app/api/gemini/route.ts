import { NextResponse } from "next/server";
import { forgetPendingGeminiLogin } from "@doceomenter/auth";
import { resolveCaller, withAccountCookie } from "../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISCONNECTED = { connected: false, email: null, expiresAt: null, expired: false, projectId: null };

/** Is this browser's Gemini subscription connected, and to which Google account. */
export async function GET(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller.runtime.available) {
    return withAccountCookie(
      NextResponse.json({ ...DISCONNECTED, available: false, reason: caller.runtime.reason }),
      caller,
    );
  }
  const status = await caller.runtime.geminiAccounts.status(caller.accountId);
  return withAccountCookie(NextResponse.json({ ...status, available: true }), caller);
}

/** Set (or clear) the GCP project id a licensed account needs — see `geminiAccountStore.ts`. */
export async function PUT(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller.runtime.available) {
    return withAccountCookie(NextResponse.json({ error: "no_store" }, { status: 503 }), caller);
  }
  const body = (await request.json().catch(() => ({}))) as { projectId?: unknown };
  if (body.projectId !== null && typeof body.projectId !== "string") {
    return withAccountCookie(NextResponse.json({ error: "bad_project_id" }, { status: 400 }), caller);
  }
  await caller.runtime.geminiAccounts.setProjectId(caller.accountId, body.projectId);
  const status = await caller.runtime.geminiAccounts.status(caller.accountId);
  return withAccountCookie(NextResponse.json({ ...status, available: true }), caller);
}

/** Disconnect. Drops any half-finished login with it, so a stale code cannot be redeemed. */
export async function DELETE(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller.runtime.available) {
    return withAccountCookie(NextResponse.json({ error: "no_store" }, { status: 503 }), caller);
  }
  forgetPendingGeminiLogin(caller.accountId);
  await caller.runtime.geminiAccounts.forget(caller.accountId);
  return withAccountCookie(NextResponse.json({ ...DISCONNECTED, available: true }), caller);
}
