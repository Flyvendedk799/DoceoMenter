import { NextResponse } from "next/server";
import { completeLogin } from "@doceomenter/auth";
import { resolveCaller, withAccountCookie } from "../../../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Finish the login with the pasted code, and store the credential against this browser. */
export async function POST(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller.runtime.available) {
    return withAccountCookie(NextResponse.json({ error: "no_store" }, { status: 503 }), caller);
  }

  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const result = await completeLogin(caller.accountId, body.code, caller.runtime.accounts);
  if (!result.ok) {
    const { ok: _ok, status, ...rest } = result;
    return withAccountCookie(NextResponse.json(rest, { status }), caller);
  }

  const status = await caller.runtime.accounts.status(caller.accountId);
  return withAccountCookie(NextResponse.json({ ...status, available: true }), caller);
}
