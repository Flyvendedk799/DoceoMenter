import "server-only";
import {
  ACCOUNT_COOKIE,
  getAuthRuntime,
  readCookie,
  newAccountId,
  serializeAccountCookie,
  type AuthRuntime,
} from "@doceomenter/auth";

export type Caller = {
  accountId: string;
  runtime: AuthRuntime;
  /** Present when the browser arrived without a valid cookie and has just been given one. */
  setCookie?: string;
};

/**
 * Who is asking, and a cookie for them if they did not have one.
 *
 * DoceoMenter has no accounts, so "this browser" is the honest unit of ownership: it is the
 * narrowest thing that can hold a credential, and it stops one visitor's connected
 * subscription from being spent by the next person to open the page. The cookie is minted on
 * first contact rather than by a middleware, so the id exists exactly when something is about
 * to be stored against it.
 */
export async function resolveCaller(request: Request): Promise<Caller> {
  const runtime = await getAuthRuntime();
  const existing = runtime.session.verify(readCookie(request.headers.get("cookie"), ACCOUNT_COOKIE));
  if (existing) return { accountId: existing, runtime };

  const accountId = newAccountId();
  return {
    accountId,
    runtime,
    setCookie: serializeAccountCookie(runtime.session.sign(accountId), isHttps(request)),
  };
}

/** The account this request already has, or null. Never mints one — for reads that only look. */
export async function currentAccountId(request: Request): Promise<string | null> {
  const runtime = await getAuthRuntime();
  return runtime.session.verify(readCookie(request.headers.get("cookie"), ACCOUNT_COOKIE));
}

/** Attach a freshly minted account cookie to a response, when there is one to attach. */
export function withAccountCookie(response: Response, caller: Caller): Response {
  if (caller.setCookie) response.headers.append("set-cookie", caller.setCookie);
  return response;
}

/**
 * Whether this request arrived over https.
 *
 * `x-forwarded-proto` is trusted because the only deployments that set it are the ones that
 * put a proxy in front, and the cost of getting it wrong is a cookie that is either marked
 * `Secure` on plain http — where the browser drops it, and nothing works — or not marked on
 * https, which is what the header exists to prevent.
 */
function isHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  return new URL(request.url).protocol === "https:";
}
