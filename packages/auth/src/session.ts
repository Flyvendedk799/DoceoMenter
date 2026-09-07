/**
 * Who "this account" is, in an app with no accounts.
 *
 * `ai-auth` asks the host one question — which user is calling — and refuses to answer it
 * itself, because every project means something different by a signed-in user. DoceoMenter
 * has no login at all, so the honest answer here is *this browser*: a random id in a signed,
 * http-only cookie. It is not an identity and it does not pretend to be one; it is the
 * narrowest thing that can own a credential, so that one visitor's Claude subscription is not
 * quietly handed to the next.
 *
 * Signed rather than random-only, because the id is also the storage key: an unsigned cookie
 * lets anyone read another browser's credential by guessing — or by simply pasting — its
 * value. The HMAC makes an id nobody minted here unusable.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCOUNT_COOKIE = "doceomenter_account";

/** A year. The cookie carries no personal data and re-issuing it costs the user their keys. */
export const ACCOUNT_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

const ID_RE = /^[0-9a-f]{32}$/;

export function newAccountId(): string {
  return randomBytes(16).toString("hex");
}

export function signAccountId(accountId: string, secret: string): string {
  return `${accountId}.${mac(accountId, secret)}`;
}

/** The id inside a cookie value, or null when it was not signed with this secret. */
export function verifyAccountToken(token: string | undefined | null, secret: string): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!ID_RE.test(id)) return null;

  const expected = Buffer.from(mac(id, secret), "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? id : null;
}

/** Pull one cookie out of a raw `Cookie` header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function serializeAccountCookie(value: string, secure: boolean): string {
  const attributes = [
    `${ACCOUNT_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ACCOUNT_COOKIE_MAX_AGE}`,
  ];
  // Omitted rather than always set: a `Secure` cookie is dropped on plain http, and this app's
  // ordinary home is http://localhost.
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function mac(accountId: string, secret: string): string {
  return createHmac("sha256", `doceomenter-account:${secret}`).update(accountId).digest("hex");
}
