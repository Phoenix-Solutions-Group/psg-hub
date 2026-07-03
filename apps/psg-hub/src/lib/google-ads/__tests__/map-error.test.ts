import { describe, it, expect } from "vitest";
import { errors as googleAdsErrors } from "google-ads-api";
import { mapGoogleAdsError } from "../client";

/**
 * 10-02 RESEARCH HIGH defect: real GAQL failures are `GoogleAdsFailure` objects
 * (NOT instanceof Error), so the old substring-only mapper degraded them to a
 * generic `upstream` that stringifies as `[object Object]` — breaking the
 * per-shop auth_failed skip the ingest depends on. These assert the structured
 * branch classifies by the error_code oneof key, against the REAL library type.
 */
describe("mapGoogleAdsError — structured GoogleAdsFailure", () => {
  function failure(errorCode: Record<string, number>, message = "boom") {
    return new googleAdsErrors.GoogleAdsFailure({
      errors: [{ error_code: errorCode, message }],
    });
  }

  it("classifies an authentication_error as auth_failed", () => {
    const e = mapGoogleAdsError(failure({ authentication_error: 2 }));
    expect(e.code).toBe("auth_failed");
  });

  it("classifies an authorization_error as auth_failed", () => {
    const e = mapGoogleAdsError(failure({ authorization_error: 24 }));
    expect(e.code).toBe("auth_failed");
  });

  it("classifies a quota_error as rate_limited", () => {
    const e = mapGoogleAdsError(failure({ quota_error: 1 }));
    expect(e.code).toBe("rate_limited");
  });

  it("classifies a query_error as bad_request", () => {
    const e = mapGoogleAdsError(failure({ query_error: 50 }));
    expect(e.code).toBe("bad_request");
  });

  it("falls back to upstream for an unknown structured code", () => {
    const e = mapGoogleAdsError(failure({ internal_error: 1 }));
    expect(e.code).toBe("upstream");
  });

  it("still handles plain string-shaped throws (OAuth invalid_grant) via the fallback", () => {
    const e = mapGoogleAdsError(new Error("invalid_grant: token revoked"));
    expect(e.code).toBe("auth_failed");
  });

  // PSG-533: an `invalid_client` OAuth token-refresh failure (wrong client
  // id/secret in prod env) must classify as auth_failed so the orchestrator
  // flips the account to status='error'. Before the fix it fell through to the
  // generic `invalid` -> bad_request branch (the string contains "invalid"),
  // leaving the account masked as 'linked' while every fetch silently threw —
  // the exact 06-30 PSG-532 stall.
  it("classifies an invalid_client refresh failure as auth_failed (not bad_request)", () => {
    const e = mapGoogleAdsError(
      new Error("invalid_client: The OAuth client was not found.")
    );
    expect(e.code).toBe("auth_failed");
  });
});
