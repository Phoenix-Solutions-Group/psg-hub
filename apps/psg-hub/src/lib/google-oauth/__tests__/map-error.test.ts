import { describe, it, expect } from "vitest";
import { mapGoogleApiError, GoogleApiError } from "@/lib/google-oauth/client";

// Built from REALISTIC error shapes, not bare Error()s — a generic-Error test
// passes while proving nothing about classification (the 10-02 lesson).

describe("mapGoogleApiError — gax ServiceError (numeric gRPC code)", () => {
  const cases: Array<[number, string, string]> = [
    [16, "16 UNAUTHENTICATED: invalid credentials", "auth_failed"],
    [7, "7 PERMISSION_DENIED: caller lacks permission", "auth_failed"],
    [8, "8 RESOURCE_EXHAUSTED: quota exceeded", "rate_limited"],
    [3, "3 INVALID_ARGUMENT: bad request", "bad_request"],
    [5, "5 NOT_FOUND: property missing", "bad_request"],
    [4, "4 DEADLINE_EXCEEDED: timed out", "timeout"],
    [14, "14 UNAVAILABLE: backend down", "upstream"],
  ];
  for (const [code, message, expected] of cases) {
    it(`gRPC code ${code} -> ${expected}`, () => {
      const err = Object.assign(new Error(message), { code });
      const mapped = mapGoogleApiError(err);
      expect(mapped).toBeInstanceOf(GoogleApiError);
      expect(mapped.code).toBe(expected);
    });
  }
});

describe("mapGoogleApiError — Gaxios (HTTP status)", () => {
  const cases: Array<[number, string]> = [
    [401, "auth_failed"],
    [403, "auth_failed"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [404, "bad_request"],
    [504, "timeout"],
    [500, "upstream"],
  ];
  for (const [status, expected] of cases) {
    it(`HTTP ${status} -> ${expected}`, () => {
      const err = Object.assign(
        new Error(`Request failed with status code ${status}`),
        { code: "ERR_BAD_RESPONSE", response: { status } }
      );
      expect(mapGoogleApiError(err).code).toBe(expected);
    });
  }
});

describe("mapGoogleApiError — OAuth / string fallbacks", () => {
  it("OAuth invalid_grant -> auth_failed", () => {
    expect(mapGoogleApiError(new Error("invalid_grant")).code).toBe(
      "auth_failed"
    );
  });
  it("network ETIMEDOUT (string code) -> timeout", () => {
    const err = Object.assign(new Error("connect ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
    expect(mapGoogleApiError(err).code).toBe("timeout");
  });
  it("unknown -> upstream", () => {
    expect(mapGoogleApiError(new Error("something odd")).code).toBe("upstream");
  });
  it("already-mapped GoogleApiError passes through unchanged", () => {
    const original = new GoogleApiError("rate_limited", "slow down");
    expect(mapGoogleApiError(original)).toBe(original);
  });
});

describe("mapGoogleApiError — message hygiene", () => {
  it("redacts long digit runs + emails from the surfaced message", () => {
    const err = Object.assign(
      new Error("denied for user admin@example.com property 1234567890123"),
      { code: 7 }
    );
    const mapped = mapGoogleApiError(err);
    expect(mapped.message).not.toContain("admin@example.com");
    expect(mapped.message).not.toContain("1234567890123");
  });
});
