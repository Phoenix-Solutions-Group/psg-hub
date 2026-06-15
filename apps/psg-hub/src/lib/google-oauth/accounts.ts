import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptRefreshToken } from "@/lib/google-ads/crypto";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import { GoogleApiError } from "./client";

// Phase 11 / 11-01 — persist a linked GA4 property or GSC site.
// Phase 13 / 13-01 — extended to a third source 'gbp' (Google Business Profile).
// Mirrors google-ads/link.ts. The refresh token is supplied already encrypted, in
// Postgres `\x<hex>` bytea TEXT form (the 10-01 finding: a raw Buffer JSON-
// serializes wrong over PostgREST). A combined GA4+GSC link writes TWO rows (one
// per source) sharing the SAME encrypted token; a GBP link writes ONE row (its own
// separate consent + token). Upsert on (shop_id, source, external_account_id)
// allows reconnect/re-pick after revoke.

export type GoogleOAuthSource = "ga4" | "gsc" | "gbp";

export async function persistLinkedAccount(input: {
  shopId: string;
  source: GoogleOAuthSource;
  externalAccountId: string; // 'properties/<id>' | 'sc-domain:x' | 'https://.../' | 'locations/<id>'
  displayName: string | null;
  encryptedTokenHex: string; // "\\x...."
  keyVersion: number;
  scope: string;
  linkedBy: string;
  // GBP only: the parent `accounts/{id}` resource (external_parent_id). Omitted
  // for ga4/gsc -> null. Feeds the Phase-14 v4 Reviews + 13-03 star-rating calls,
  // which key off accounts/{aid}/locations/{lid}.
  externalParentId?: string | null;
}): Promise<{ error: string | null }> {
  const service = createServiceClient();
  const { error } = await service.from("google_oauth_accounts").upsert(
    {
      shop_id: input.shopId,
      source: input.source,
      external_account_id: input.externalAccountId,
      external_parent_id: input.externalParentId ?? null,
      display_name: input.displayName,
      encrypted_refresh_token: input.encryptedTokenHex,
      key_version: input.keyVersion,
      scope: input.scope,
      status: "linked",
      linked_by: input.linkedBy,
      linked_at: new Date().toISOString(),
      revoked_at: null,
      last_error: null,
    },
    { onConflict: "shop_id,source,external_account_id" }
  );
  return { error: error ? error.message : null };
}

// Phase 11 / 11-02 — shared read + decrypt of a linked account for the ingest
// verticals (GA4 now, GSC in 11-03). Mirrors getGoogleAdsClient's bytea `\x<hex>`
// decode (10-01 finding: a raw Buffer JSON-serializes wrong over PostgREST).

export type LinkedAccount = {
  accountId: string;
  externalAccountId: string; // 'properties/<id>' | 'sc-domain:x' | 'https://.../'
  refreshToken: string; // decrypted
};

/**
 * Read the ONE linked account for a shop+source and return its decrypted refresh
 * token. DETERMINISTIC: orders by linked_at desc and takes the first row, so a
 * shop that somehow holds two accounts of one source never silently double-writes
 * the property-less (shop,source,date,period) snapshot key (multi-property is
 * deferred — mirrors the Phase-10 ads decision). Returns null when nothing linked.
 * Throws GoogleApiError('auth_failed') on a decrypt failure.
 */
export async function getLinkedAccount(
  shopId: string,
  source: GoogleOAuthSource
): Promise<LinkedAccount | null> {
  const service = createServiceClient();
  const { data: row, error } = await service
    .from("google_oauth_accounts")
    .select("id, external_account_id, encrypted_refresh_token, key_version")
    .eq("shop_id", shopId)
    .eq("source", source)
    .eq("status", "linked")
    .order("linked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new GoogleApiError("upstream", error.message);
  }
  if (!row) return null;

  // bytea round-trips as a Postgres `\x<hex>` text string over PostgREST (NOT a
  // Buffer). Decode that form; keep the Buffer + ArrayBuffer fallbacks for other
  // transports/tests (mirrors getGoogleAdsClient l.181-187).
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
    throw new GoogleApiError("auth_failed", "Refresh token decrypt failed");
  }

  return {
    accountId: row.id as string,
    externalAccountId: row.external_account_id as string,
    refreshToken,
  };
}

/**
 * Flip a google_oauth_accounts row to status='error' with a sanitized last_error
 * so the link surface shows "needs re-link". Generic over source (GSC 11-03
 * reuses it). Mirrors markAccountAuthFailed; never throws (best-effort).
 */
export async function markAccountError(
  accountId: string,
  rawMessage: string
): Promise<void> {
  try {
    const service = createServiceClient();
    await service
      .from("google_oauth_accounts")
      .update({
        status: "error",
        last_error: sanitizeLastError(rawMessage),
      })
      .eq("id", accountId);
  } catch (err) {
    console.error("[google-oauth] failed to mark account error:", err);
  }
}
