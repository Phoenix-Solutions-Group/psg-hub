import "server-only";
import { OAuth2Client } from "google-auth-library";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";

// Phase 11 / 11-01 — shared OAuth client builder + error mapper for GA4 + GSC.
//
// ONE OAuth2Client built per shop from the decrypted refresh token, injected into
// BOTH Google client families. The injection idiom is NOT interchangeable
// (RESEARCH, the single easiest mistake):
//   - gax clients (@google-analytics/admin|data): pass `authClient: oauth2`.
//   - googleapis (GSC webmasters): pass `auth: oauth2`.
// buildOAuth2Client is the single construction helper; the per-family injection
// lives in ga4-enumerate.ts / gsc-enumerate.ts (one line each), so the UNVERIFIED
// gax `authClient` field (RESEARCH Open Question #1 — real in the v10.7.0 types,
// absent from the rendered cloud.google.com reference) is a one-line fix if a live
// smoke shows different behavior.

export type GoogleApiErrorCode =
  | "auth_failed"
  | "rate_limited"
  | "bad_request"
  | "timeout"
  | "upstream";

/** Normalized upstream-Google error (mirrors the AdsApiError shape; separate type
 *  because GA4/GSC throw gax ServiceError / Gaxios, never GoogleAdsFailure). */
export class GoogleApiError extends Error {
  constructor(
    public code: GoogleApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Read the shared Google OAuth client env (id/secret + the Phase-11 redirect). */
export function googleOAuthClientEnv(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleApiError(
      "upstream",
      "Server missing Google OAuth credentials"
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * Build a google-auth-library OAuth2Client primed with a refresh token. The
 * library auto-mints/refreshes the access token on each API call; the access
 * token is never persisted. Scopes are fixed at consent time, so the injected
 * refresh token must already carry analytics.readonly + webmasters.readonly.
 * `onRefreshToken` captures a rotated refresh token if Google ever returns one.
 */
export function buildOAuth2Client(input: {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  refreshToken: string;
  onRefreshToken?: (refreshToken: string) => void;
}): OAuth2Client {
  const oauth2 = new OAuth2Client({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
  });
  oauth2.setCredentials({ refresh_token: input.refreshToken });
  if (input.onRefreshToken) {
    oauth2.on("tokens", (tokens) => {
      if (tokens.refresh_token) input.onRefreshToken!(tokens.refresh_token);
    });
  }
  return oauth2;
}

function statusToCode(status: number): GoogleApiErrorCode {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 400 && status < 500) return "bad_request";
  return "upstream";
}

// gRPC canonical status codes (gax ServiceError.code is numeric 0..16).
function grpcToCode(code: number): GoogleApiErrorCode {
  if (code === 16 || code === 7) return "auth_failed"; // UNAUTHENTICATED, PERMISSION_DENIED
  if (code === 8) return "rate_limited"; // RESOURCE_EXHAUSTED
  if (code === 3 || code === 5 || code === 9) return "bad_request"; // INVALID_ARGUMENT, NOT_FOUND, FAILED_PRECONDITION
  if (code === 4) return "timeout"; // DEADLINE_EXCEEDED
  return "upstream"; // UNAVAILABLE(14), INTERNAL(13), UNKNOWN(2), ...
}

/**
 * Classify an upstream Google failure. Handles the three real shapes:
 *  - Gaxios (googleapis/GSC): HTTP status on `.response.status` or `.status`.
 *  - gax ServiceError (GA4 Admin/Data): numeric gRPC `.code` (0..16).
 *  - OAuth/network throws (invalid_grant, ETIMEDOUT): string code / message.
 * Already-mapped GoogleApiError passes through. Messages are sanitized.
 */
export function mapGoogleApiError(err: unknown): GoogleApiError {
  if (err instanceof GoogleApiError) return err;

  const e = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: number };
    message?: unknown;
  };
  const message = sanitizeLastError(
    typeof e?.message === "string" && e.message
      ? e.message
      : "Google API request failed"
  );

  // Gaxios (googleapis): HTTP status.
  const httpStatus =
    typeof e?.response?.status === "number"
      ? e.response.status
      : typeof e?.status === "number"
        ? (e.status as number)
        : undefined;
  if (typeof httpStatus === "number") {
    return new GoogleApiError(statusToCode(httpStatus), message);
  }

  // gax ServiceError: numeric gRPC code in 0..16.
  if (typeof e?.code === "number" && e.code >= 0 && e.code <= 16) {
    return new GoogleApiError(grpcToCode(e.code), message);
  }

  // string code / message fallback.
  const lower = `${typeof e?.code === "string" ? `${e.code} ` : ""}${
    typeof e?.message === "string" ? e.message.toLowerCase() : ""
  }`;
  if (
    lower.includes("invalid_grant") ||
    lower.includes("unauth") ||
    lower.includes("permission") ||
    lower.includes("401") ||
    lower.includes("403")
  ) {
    return new GoogleApiError("auth_failed", message);
  }
  if (
    lower.includes("quota") ||
    lower.includes("rate") ||
    lower.includes("429") ||
    lower.includes("resource_exhausted")
  ) {
    return new GoogleApiError("rate_limited", message);
  }
  if (
    lower.includes("timeout") ||
    lower.includes("deadline") ||
    lower.includes("etimedout")
  ) {
    return new GoogleApiError("timeout", message);
  }
  if (lower.includes("invalid") || lower.includes("400")) {
    return new GoogleApiError("bad_request", message);
  }
  return new GoogleApiError("upstream", message);
}
