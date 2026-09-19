import { NextResponse } from "next/server";
import { completeGeminiOAuthLogin } from "@doceomenter/auth";
import { resolveCaller, withAccountCookie } from "../../../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Finish the login with the pasted code, and store the credential against this browser. */
export async function POST(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller.runtime.available) {
    return withAccountCookie(NextResponse.json({ error: "no_store" }, { status: 503 }), caller);
  }

  const body = (await request.json().catch(() => ({}))) as { code?: unknown; projectId?: unknown };
  if (body.projectId !== undefined && body.projectId !== null && typeof body.projectId !== "string") {
    return withAccountCookie(NextResponse.json({ error: "bad_project_id" }, { status: 400 }), caller);
  }
  const projectId =
    typeof body.projectId === "string" ? body.projectId : body.projectId === null ? null : undefined;
  const result = await completeGeminiOAuthLogin(caller.accountId, body.code, caller.runtime.geminiAccounts, {
    projectId,
  });
  if (!result.ok) {
    const { ok: _ok, status, ...rest } = result;
    return withAccountCookie(NextResponse.json(rest, { status }), caller);
  }

  const status = await caller.runtime.geminiAccounts.status(caller.accountId);
  return withAccountCookie(NextResponse.json({ ...status, available: true }), caller);
}
