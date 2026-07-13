import "server-only";
import { GoogleAdsApi, errors as googleAdsErrors } from "google-ads-api";
import { createServiceClient } from "@/lib/supabase/service";
import { getGoogleAdsOAuthCredentials } from "./credentials";
import { decryptRefreshToken } from "./crypto";
import { sanitizeLastError } from "./sanitize";
import {
  AdsApiError,
  type AdsApiMethod,
  type AdsApiCallResult,
  type GoogleAdsAccountRow,
} from "./types";

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function validateGaqlId(s: string): void {
  if (!/^\d+$/.test(s)) {
    throw new AdsApiError("bad_request", `invalid id format: ${s}`);
  }
}

export async function withAdsRateLimit<T>(
  shopId: string,
  method: AdsApiMethod,
  fn: () => Promise<T>
): Promise<T> {
  const mutateLimit = envInt("ADS_MUTATE_LIMIT_PER_HOUR", 20);
  const readLimit = envInt("ADS_READ_LIMIT_PER_HOUR", 500);

  const service = createServiceClient();
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const methods: AdsApiMethod[] =
    method === "MUTATE" ? ["MUTATE"] : ["GET", "SEARCH"];
  const limit = method === "MUTATE" ? mutateLimit : readLimit;

  const { count, error } = await service
    .from("ads_api_call_log")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .in("method", methods)
    .gte("created_at", windowStart);

  if (error) {
    throw new AdsApiError("upstream", `rate-limit check failed: ${error.message}`);
  }
  if ((count ?? 0) >= limit) {
    throw new AdsApiError(
      "rate_limited",
      `Rate limit: ${method} exceeds ${limit}/hour`
    );
  }

  return fn();
}

export type LogAdsCallInput = {
  userId: string | null;
  shopId: string | null;
  accountId: string | null;
  endpoint: string;
  method: AdsApiMethod;
  resourceName?: string | null;
  latencyMs?: number | null;
  result: AdsApiCallResult;
  errorCode?: string | null;
};

export async function logAdsCall(entry: LogAdsCallInput): Promise<void> {
  try {
    const service = createServiceClient();
    const { error } = await service.from("ads_api_call_log").insert({
      user_id: entry.userId,
      shop_id: entry.shopId,
      account_id: entry.accountId,
      endpoint: entry.endpoint,
      method: entry.method,
      resource_name: entry.resourceName ?? null,
      latency_ms: entry.latencyMs ?? null,
      result: entry.result,
      error_code: entry.errorCode ?? null,
    });
    if (error) {
      console.error("[ads-log] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[ads-log] unexpected:", err);
  }
}

export function mapGoogleAdsError(err: unknown): AdsApiError {
  // 10-02: real GAQL failures are `GoogleAdsFailure` objects (NOT instanceof
  // Error), so the substring fallback below misses them and they degrade to a
  // generic `upstream` that stringifies as `[object Object]`. Branch on the
  // structured failure FIRST and classify by the first error's `error_code`
  // oneof key — the per-shop `auth_failed` skip in the ingest depends on this.
  if (err instanceof googleAdsErrors.GoogleAdsFailure) {
    const first = err.errors?.[0];
    const codeKey = first?.error_code
      ? (Object.keys(first.error_code)[0] ?? "")
      : "";
    const msg = sanitizeLastError(first?.message ?? "Google Ads request failed");
    if (codeKey.includes("authentication") || codeKey.includes("authorization")) {
      return new AdsApiError("auth_failed", msg);
    }
    if (codeKey.includes("quota") || codeKey.includes("rate")) {
      return new AdsApiError("rate_limited", msg);
    }
    if (codeKey.includes("request") || codeKey.includes("query")) {
      return new AdsApiError("bad_request", msg);
    }
    return new AdsApiError("upstream", msg);
  }

  // google-ads-api throws errors with varying shapes; normalize.
  // Fallback for non-Failure throws (e.g. OAuth `invalid_grant` / `invalid_client`
  // from the token refresh, network/timeout) — kept as the string-match path.
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("quota") || lower.includes("rate")) {
    return new AdsApiError("rate_limited", "Google rate limit");
  }
  // PSG-533: `invalid_client` (a wrong OAuth client_id/secret at the token
  // refresh endpoint) MUST classify as auth_failed so the orchestrator flips the
  // account to status='error' ("needs re-link"). It is matched BEFORE the generic
  // `invalid` -> bad_request branch below, which would otherwise swallow it (the
  // string contains "invalid") and leave the account masked as 'linked' while
  // every fetch silently throws — the exact 06-30 PSG-532 silent stall.
  if (
    lower.includes("unauth") ||
    lower.includes("permission") ||
    lower.includes("invalid_grant") ||
    lower.includes("invalid_client") ||
    lower.includes("401")
  ) {
    return new AdsApiError("auth_failed", "Auth failed with Google");
  }
  if (lower.includes("timeout") || lower.includes("deadline")) {
    return new AdsApiError("timeout", "Google request timed out");
  }
  if (lower.includes("invalid")) {
    return new AdsApiError("bad_request", sanitizeLastError(raw));
  }
  return new AdsApiError("upstream", sanitizeLastError(raw));
}

export async function getGoogleAdsClient(
  shopId: string
): Promise<{
  customer: ReturnType<GoogleAdsApi["Customer"]>;
  account: GoogleAdsAccountRow;
}> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!developerToken) {
    throw new AdsApiError(
      "upstream",
      "Server missing Google Ads credentials"
    );
  }
  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = getGoogleAdsOAuthCredentials());
  } catch {
    throw new AdsApiError(
      "upstream",
      "Server missing Google Ads credentials"
    );
  }

  const service = createServiceClient();
  const { data: row, error } = await service
    .from("google_ads_accounts")
    .select(
      "id, shop_id, customer_id, login_customer_id, encrypted_refresh_token, key_version, scope, status, linked_by, linked_at, revoked_at, last_error"
    )
    .eq("shop_id", shopId)
    .eq("status", "linked")
    .maybeSingle();

  if (error) {
    throw new AdsApiError("upstream", error.message);
  }
  if (!row) {
    throw new AdsApiError("auth_failed", "No linked Google Ads account");
  }

  // bytea round-trips as a Postgres `\x<hex>` text string over PostgREST (NOT a
  // Buffer). Decode that form; keep the Buffer + ArrayBuffer fallbacks for other
  // transports/tests. (10-01: the write side now stores `\x<hex>` from callback.)
  const rawTok = row.encrypted_refresh_token as unknown;
  const ct =
    rawTok instanceof Buffer
      ? rawTok
      : typeof rawTok === "string" && rawTok.startsWith("\\x")
        ? Buffer.from(rawTok.slice(2), "hex")
        : Buffer.from(rawTok as ArrayBufferLike);

  let refreshToken: string;
  try {
    refreshToken = decryptRefreshToken(ct, row.key_version as number);
  } catch {
    throw new AdsApiError("auth_failed", "Refresh token decrypt failed");
  }

  const api = new GoogleAdsApi({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  });

  const customer = api.Customer({
    customer_id: row.customer_id as string,
    login_customer_id: row.login_customer_id ?? undefined,
    refresh_token: refreshToken,
  });

  return {
    customer,
    account: row as unknown as GoogleAdsAccountRow,
  };
}

export async function markAccountAuthFailed(
  accountId: string,
  rawMessage: string
): Promise<void> {
  try {
    const service = createServiceClient();
    await service
      .from("google_ads_accounts")
      .update({
        status: "error",
        last_error: sanitizeLastError(rawMessage),
      })
      .eq("id", accountId);
  } catch (err) {
    console.error("[ads-client] failed to mark account error:", err);
  }
}
