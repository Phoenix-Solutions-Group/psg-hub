import { describe, it, expect } from "vitest";
import { friendlyAuthError } from "../auth-errors";

/** No mapped message should ever leak a raw Supabase system string. */
const RAW_STRINGS = [
  "Invalid login credentials",
  "Email not confirmed",
  "User already registered",
  "Failed to fetch",
];

describe("friendlyAuthError", () => {
  it("returns a friendly generic for null/undefined", () => {
    expect(friendlyAuthError(null)).toMatch(/something went wrong/i);
    expect(friendlyAuthError(undefined)).toMatch(/something went wrong/i);
    expect(friendlyAuthError({})).toMatch(/something went wrong/i);
  });

  it("maps wrong credentials by code and by message, and points at reset", () => {
    const byCode = friendlyAuthError({ code: "invalid_credentials" });
    const byMsg = friendlyAuthError({ message: "Invalid login credentials" });
    expect(byCode).toBe(byMsg);
    expect(byCode).toMatch(/don't match/i);
    expect(byCode).toMatch(/forgot password/i);
  });

  it("maps unconfirmed email to a check-your-inbox sentence", () => {
    expect(friendlyAuthError({ message: "Email not confirmed" })).toMatch(
      /confirm your email/i
    );
    expect(friendlyAuthError({ code: "email_not_confirmed" })).toMatch(
      /confirmation link/i
    );
  });

  it("maps an already-registered email to 'sign in instead'", () => {
    expect(friendlyAuthError({ message: "User already registered" })).toMatch(
      /already exists/i
    );
    expect(friendlyAuthError({ code: "user_already_exists" })).toMatch(
      /signing in instead/i
    );
  });

  it("maps rate limiting (code, 429, and message)", () => {
    const expected = /too many attempts/i;
    expect(friendlyAuthError({ code: "over_request_rate_limit" })).toMatch(expected);
    expect(friendlyAuthError({ status: 429 })).toMatch(expected);
    expect(friendlyAuthError({ message: "Email rate limit exceeded" })).toMatch(expected);
  });

  it("maps weak-password rules", () => {
    expect(
      friendlyAuthError({ message: "Password should be at least 6 characters" })
    ).toMatch(/too weak/i);
    expect(friendlyAuthError({ code: "weak_password" })).toMatch(/8 characters/i);
  });

  it("maps invalid email addresses", () => {
    expect(friendlyAuthError({ code: "email_address_invalid" })).toMatch(
      /doesn't look right/i
    );
    expect(friendlyAuthError({ message: "Unable to validate email address" })).toMatch(
      /doesn't look right/i
    );
  });

  it("maps expired/used links", () => {
    expect(friendlyAuthError({ code: "otp_expired" })).toMatch(/expired|already used/i);
    expect(friendlyAuthError({ message: "Token has expired or is invalid" })).toMatch(
      /expired|already used/i
    );
  });

  it("maps network/transport failures ahead of everything else", () => {
    expect(friendlyAuthError({ message: "Failed to fetch" })).toMatch(
      /couldn't reach the server/i
    );
    expect(
      friendlyAuthError({ name: "AuthRetryableFetchError", message: "" })
    ).toMatch(/couldn't reach the server/i);
  });

  it("maps disabled signups", () => {
    expect(friendlyAuthError({ code: "signup_disabled" })).toMatch(/paused/i);
  });

  it("never echoes a raw Supabase system string verbatim", () => {
    for (const raw of RAW_STRINGS) {
      const out = friendlyAuthError({ message: raw });
      expect(out).not.toBe(raw);
      expect(out.length).toBeGreaterThan(raw.length);
    }
  });

  it("is case-insensitive on messages", () => {
    expect(friendlyAuthError({ message: "INVALID LOGIN CREDENTIALS" })).toMatch(
      /don't match/i
    );
  });
});
