import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { sanitizeLastError } from "./sanitize";
import {
  CccApiError,
  NotImplementedError,
  type CccApiMethod,
  type CccApiCallResult,
  type CccAccountRow,
} from "./types";

// CCC Secure Share provider client. Mirrors src/lib/google-ads/client.ts.
//
// Phase 1A SCAFFOLD: the AUTH SEAM is intentionally left abstract — Phase 0
// (PSG-251) confirms whether CCC Secure Share authenticates via OAuth refresh
// token, API key, or client cert. Everything that does NOT depend on the auth
// scheme is real here: error normalization, the rolling-window rate limiter over
// ccc_api_call_log, and the fire-and-forget call logger. `getCccClient()` is a
// `NotImplementedError`-throwing stub so the module compiles and downstream code
// can wire against the interface today.

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function withCccRateLimit<T>(
  shopId: string,
  method: CccApiMethod,
  fn: () => Promise<T>
): Promise<T> {
  const mutateLimit = envInt("CCC_MUTATE_LIMIT_PER_HOUR", 20);
  const readLimit = envInt("CCC_READ_LIMIT_PER_HOUR", 500);

  const service = createServiceClient();
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const methods: CccApiMethod[] =
    method === "MUTATE" ? ["MUTATE"] : ["GET", "SEARCH"];
  const limit = method === "MUTATE" ? mutateLimit : readLimit;

  const { count, error } = await service
    .from("ccc_api_call_log")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .in("method", methods)
    .gte("created_at", windowStart);

  if (error) {
    throw new CccApiError("upstream", `rate-limit check failed: ${error.message}`);
  }
  if ((count ?? 0) >= limit) {
    throw new CccApiError(
      "rate_limited",
      `Rate limit: ${method} exceeds ${limit}/hour`
    );
  }

  return fn();
}

export type LogCccCallInput = {
  userId: string | null;
  shopId: string | null;
  accountId: string | null;
  endpoint: string;
  method: CccApiMethod;
  resourceName?: string | null;
  latencyMs?: number | null;
  result: CccApiCallResult;
  errorCode?: string | null;
};

// Fire-and-forget audit + rate-limit ledger write. Never throws into the caller.
export async function logCccCall(entry: LogCccCallInput): Promise<void> {
  try {
    const service = createServiceClient();
    const { error } = await service.from("ccc_api_call_log").insert({
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
      console.error("[ccc-log] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[ccc-log] unexpected:", err);
  }
}

// Normalize an arbitrary upstream throw into a classified CccApiError. The CCC
// Secure Share error envelope is confirmed in Phase 0; until then this is the
// string-match fallback (the same shape google-ads uses for non-structured
// throws) so callers already get a stable `.code` to branch on.
export function mapCccError(err: unknown): CccApiError {
  if (err instanceof CccApiError) {
    return err;
  }
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("quota") || lower.includes("rate")) {
    return new CccApiError("rate_limited", "CCC rate limit");
  }
  if (
    lower.includes("unauth") ||
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("invalid_grant") ||
    lower.includes("401") ||
    lower.includes("403")
  ) {
    return new CccApiError("auth_failed", "Auth failed with CCC Secure Share");
  }
  if (lower.includes("timeout") || lower.includes("deadline")) {
    return new CccApiError("timeout", "CCC request timed out");
  }
  if (lower.includes("invalid") || lower.includes("bad request")) {
    return new CccApiError("bad_request", sanitizeLastError(raw));
  }
  return new CccApiError("upstream", sanitizeLastError(raw));
}

// The provider surface downstream ingest/link code will wire against. Methods
// stay deliberately thin until Phase 0 pins the BMS event-sink contract.
export interface CccSecureShareClient {
  /** Verify the linked credential is still valid against CCC Secure Share. */
  verifyCredential(): Promise<void>;
  /** Pull pending CIECA BMS messages for the linked facility. */
  fetchPendingMessages(): Promise<unknown[]>;
}

// AUTH SEAM (stub). Resolves the linked ccc_accounts row and would build an
// authenticated client — but the auth scheme is unconfirmed (PSG-251), so it
// throws NotImplementedError. Shape mirrors getGoogleAdsClient().
export async function getCccClient(shopId: string): Promise<{
  client: CccSecureShareClient;
  account: CccAccountRow;
}> {
  void shopId;
  throw new NotImplementedError(
    "CCC Secure Share auth scheme is confirmed in Phase 0 (PSG-251); " +
      "client construction is intentionally stubbed in Phase 1A."
  );
}

export async function markCccAccountAuthFailed(
  accountId: string,
  rawMessage: string
): Promise<void> {
  try {
    const service = createServiceClient();
    await service
      .from("ccc_accounts")
      .update({
        status: "error",
        last_error: sanitizeLastError(rawMessage),
      })
      .eq("id", accountId);
  } catch (err) {
    console.error("[ccc-client] failed to mark account error:", err);
  }
}
