// Phase 11 / 11-01 — refresh-token crypto for the GA4 + GSC OAuth flow.
//
// Deliberately a thin RE-EXPORT of the Google Ads crypto, NOT a re-implementation.
// RESEARCH (11-ga4-gsc) + the 10-01 operator decision (recorded in
// 20260608000000_google_ads_tables.sql): all Google sources share the one
// versioned app-key AES-256-GCM keyed by ADS_ENCRYPTION_KEY (base64 -> 32 bytes,
// _V2.._V10 rotation). A single key map across Ads/GA4/GSC avoids re-keying and
// keeps one audited crypto path. The module name is data-agnostic despite living
// under google-ads/.
//
// Tokens are stored in Postgres `\x<hex>` bytea TEXT form (the 10-01 round-trip
// trap: a raw Buffer JSON-serializes wrong over PostgREST); the read side decodes
// `\x`-prefixed strings back to a Buffer before decrypt. See accounts.ts /
// callback for the encode site and (later) 11-02/11-03 ingest for the decode site.

export {
  encryptRefreshToken,
  decryptRefreshToken,
  _resetKeyMapCacheForTests,
} from "@/lib/google-ads/crypto";
