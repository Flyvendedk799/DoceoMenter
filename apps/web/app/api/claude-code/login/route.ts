import { NextResponse } from "next/server";
import { startLogin } from "@doceomenter/auth";
import { resolveCaller, withAccountCookie } from "../../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Begin the login: mint a PKCE pair, keep the verifier here, hand back only the URL to approve.
 *
 * Nothing about the exchange crosses to the browser, so there is nothing in the page worth
 * stealing and nothing it could leak if it tried.
 */
export async function POST(request: Request) {
  const caller = await resolveCaller(request);
  if (!caller.runtime.available) {
    return withAccountCookie(
      NextResponse.json(
        {
          error: "no_store",
          message:
            caller.runtime.reason ??
            "Connecting a subscription needs somewhere to keep the credential, and this deployment has nowhere.",
        },
        { status: 503 },
      ),
      caller,
    );
  }
  return withAccountCookie(NextResponse.json(startLogin(caller.accountId)), caller);
}
