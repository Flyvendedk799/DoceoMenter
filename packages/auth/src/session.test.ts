import { describe, expect, it } from "vitest";
import {
  ACCOUNT_COOKIE,
  newAccountId,
  readCookie,
  serializeAccountCookie,
  signAccountId,
  verifyAccountToken,
} from "./session.js";

describe("account cookie", () => {
  const secret = "a".repeat(48);

  it("round-trips an id it signed", () => {
    const id = newAccountId();
    expect(verifyAccountToken(signAccountId(id, secret), secret)).toBe(id);
  });

  it("refuses an id signed with another secret", () => {
    const token = signAccountId(newAccountId(), "another secret");
    expect(verifyAccountToken(token, secret)).toBeNull();
  });

  it("refuses an unsigned or tampered value", () => {
    const id = newAccountId();
    expect(verifyAccountToken(id, secret)).toBeNull();
    expect(verifyAccountToken(`${id}.deadbeef`, secret)).toBeNull();
    const token = signAccountId(id, secret);
    // Swap the id but keep the signature: the pair no longer matches.
    expect(verifyAccountToken(`${newAccountId()}.${token.split(".")[1]}`, secret)).toBeNull();
  });

  it("refuses anything that is not a minted id shape", () => {
    expect(verifyAccountToken("../../etc/passwd.abc", secret)).toBeNull();
    expect(verifyAccountToken("", secret)).toBeNull();
    expect(verifyAccountToken(undefined, secret)).toBeNull();
  });

  it("reads one cookie out of a header with several", () => {
    const header = `theme=dark; ${ACCOUNT_COOKIE}=abc.def; other=1`;
    expect(readCookie(header, ACCOUNT_COOKIE)).toBe("abc.def");
    expect(readCookie(header, "missing")).toBeUndefined();
    expect(readCookie(null, ACCOUNT_COOKIE)).toBeUndefined();
  });

  it("serialises an http-only cookie, and only marks it Secure over https", () => {
    const insecure = serializeAccountCookie("abc.def", false);
    expect(insecure).toContain("HttpOnly");
    expect(insecure).toContain("SameSite=Lax");
    expect(insecure).not.toContain("Secure");
    expect(serializeAccountCookie("abc.def", true)).toContain("Secure");
  });
});
