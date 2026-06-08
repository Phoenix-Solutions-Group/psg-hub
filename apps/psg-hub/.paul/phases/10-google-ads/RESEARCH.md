# RESEARCH — Phase 10 Google Ads

> Source: ultracode multi-agent research Workflow `wf_a78f4fd7-d6b` (2026-06-08; 19 agents, adversarially validated).
> Sources: Context7 `google-ads-api@23.0.0` source + official Google Ads API docs + inherited-code validation.
> Feeds: 10-02 (daily ingest) and 10-03 (activation gate batch). Per the research-first gate (`.paul/SPECIAL-FLOWS.md`).
> Adversarial pass: 12 confirmed, 1 refuted, 1 uncertain (folded into "Confidence + gaps").

---

## Summary

Plan 10-02 builds a daily ingest that mirrors the SEMrush path: for each shop holding a `google_ads_accounts` row with `status='linked'`, run ONE account-level GAQL query, aggregate to a single row, and idempotent-upsert into `public.analytics_snapshots` with `source='google_ads'`, `period='daily'`, a settled `date`, and a `metrics` jsonb of `{spend, clicks, impressions, conversions, cpl}`. The single most important contract facts: (1) query `FROM customer` (not `FROM campaign`) so the account has exactly one resource_name and you get one totals row; (2) do NOT use `segments.date = 'YYYY-MM-DD'`, it is undocumented for `segments.date` and adversarially refuted; use `BETWEEN 'd' AND 'd'` or `DURING YESTERDAY`; (3) money is micros, `spend = cost_micros / 1_000_000`; (4) compute `cpl` in code as `spend / conversions` guarding zero, never read `metrics.cost_per_conversion`; (5) with `disable_parsing` unset (the inherited default), rows arrive snake_case with INT64 already coerced to Number, so `row.metrics.cost_micros` is a number. This is a NEW query; the inherited `fetchCampaignMetrics` is the wrong shape and is reference only.

## google-ads-api v23 contract

Installed library is `google-ads-api@23.0.0` targeting proto `v23` (confirmed in `node_modules`). Validated behavior:

- `customer.query(gaqlString)` returns `Promise<IGoogleAdsRow[]>`, a plain array of rows with no results wrapper. Iterating with `for...of` is correct.
- Rows nest snake_case fields: `row.metrics.cost_micros`, `row.metrics.clicks`, `row.metrics.impressions`, `row.metrics.conversions`. Parsing is ON by default; `decamelizeKeysIfNeeded` only returns input unchanged if `clientOptions.disable_parsing` is set, which the inherited `client.ts` never sets.
- Data types: `cost_micros`, `impressions`, `clicks` are INT64 and are auto-coerced to JS `Number` by the REST parser (`parserRest.js` INT64 -> `Number(value)`); `conversions` is a DOUBLE and arrives as a JS number directly. The inherited `Number(v ?? 0)` wrapping is redundant but harmless.
- Micros: `cost_micros` is millionths of the base currency unit. `spend = cost_micros / 1_000_000`. The library exports `fromMicros`/`toMicros` (`utils.js`) if you prefer them.
- Auth: `new GoogleAdsApi({ client_id, client_secret, developer_token })` then `api.Customer({ customer_id, login_customer_id, refresh_token })`. `login_customer_id` is the MCC/manager id and is only needed when the account is accessed through a manager. The inherited `client.ts:171-181` wiring matches the v23 `CustomerOptions` type exactly.
- `customer_id` and `login_customer_id` are sent verbatim; the library does NOT strip dashes. They must be bare 10-digit strings or the call fails with `INVALID_CUSTOMER_ID`.

Recommended query call (reuse the existing client plumbing):

```ts
// new helper, e.g. fetchAccountDailyMetrics(shopId, dateStr)
const customer = await getGoogleAdsClient(shopId); // builds Customer against the linked customer_id
const gaql = `
  SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
  FROM customer
  WHERE segments.date BETWEEN '${dateStr}' AND '${dateStr}'
`;
const rows = await withAdsRateLimit('SEARCH', shopId, () =>
  logAdsCall(shopId, 'fetchAccountDailyMetrics', () => customer.query(gaql)),
);
// dateStr is a code-derived literal (account-tz yesterday), not user input; keep it inside ^\d{4}-\d{2}-\d{2}$.
```

## Recommended account-level daily GAQL

GAQL string (one settled daily account-total row):

```sql
SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
FROM customer
WHERE segments.date BETWEEN '2026-06-07' AND '2026-06-07'
```

Why this shape produces exactly one row: GAQL has no `GROUP BY`. Every report is aggregated at minimum by the `resource_name` of the FROM resource. An account has exactly one `customer` resource_name, so `FROM customer` yields one totals row. Do NOT put `segments.date` (or any campaign field) in the SELECT; selecting a segment splits the totals into one row per segment value. `segments.date` in the WHERE filters the window and does not split rows.

Aggregation to one snapshot. Even though one row is expected, sum defensively over returned rows and initialize totals to zero, because a zero-activity day returns ZERO rows (not a row of zeros). This gives you the empty-day path for free and is correct for 0, 1, or N rows:

```ts
let cost_micros = 0, clicks = 0, impressions = 0, conversions = 0;
for (const r of rows) {
  cost_micros += r.metrics?.cost_micros ?? 0;
  clicks      += r.metrics?.clicks ?? 0;
  impressions += r.metrics?.impressions ?? 0;
  conversions += r.metrics?.conversions ?? 0;
}
const spend = cost_micros / 1_000_000;
const cpl = conversions > 0 ? spend / conversions : null;
```

GoogleAdsMetrics jsonb shape written to `analytics_snapshots.metrics`:

```jsonc
{
  "spend": 124.50,          // cost_micros / 1_000_000, USD
  "clicks": 312,            // INT64
  "impressions": 8044,      // INT64
  "conversions": 7.0,       // DOUBLE, can be fractional
  "cpl": 17.79,             // spend / conversions, null when conversions = 0
  "cost_micros": 124500000  // optional: store raw for audit
}
```

Micros conversion: `spend = cost_micros / 1_000_000`. CPL is derived in code, never read from the API. `metrics.cost_per_conversion` is a DOUBLE returned in micros-valued units (same confusion as `average_cpc`) and is an average that cannot be summed across rows; computing `spend / conversions` sidesteps both problems.

Contrast with the inherited per-campaign query. `fetchCampaignMetrics` (`campaigns.ts:204-247`) is `FROM campaign WHERE campaign.id = ... AND segments.date DURING LAST_30_DAYS`: per-campaign, multi-row, 30-day window that excludes today. That is the wrong entity, wrong cardinality, and wrong window for a daily account snapshot.

Does 10-02 write a NEW query? YES. The entity (`customer` vs `campaign`), cardinality (one totals row vs per-campaign), and window (single settled day vs `LAST_30_DAYS`) all differ. Reuse the wrapper pattern (`getGoogleAdsClient` + `withAdsRateLimit('SEARCH')` + `logAdsCall` + `mapGoogleAdsError`) but write a fresh `fetchAccountDailyMetrics`. Treat `fetchCampaignMetrics` as reference only.

## Inherited-code drift findings

This is the API-layer analog of 10-01's bytea bug. Validate or fix before the first live run.

| Risk | File:line | Severity | Fix |
|------|-----------|----------|-----|
| `single-day = segments.date = 'YYYY-MM-DD'` is undocumented for `segments.date` (only valid for week/month/quarter/year) and adversarially REFUTED. Do not adopt it in 10-02. | new 10-02 query (design) | HIGH | Use `segments.date BETWEEN 'd' AND 'd'`, or `>= 'd' AND <= 'd'`, or `DURING YESTERDAY`. Do not mix `BETWEEN` and `DURING` in one query. |
| `mapGoogleAdsError` does substring matching on `error.message`; real failures are `GoogleAdsFailure` objects (not `instanceof Error`), so structured auth/permission/quota errors fall through to generic `upstream` and stringify as `[object Object]`. | `client.ts:95-117` | HIGH | Branch on `instanceof errors.GoogleAdsFailure`, read `errors[0].error_code` to classify `auth_failed` / `rate_limited` / `permission`. Acceptable-but-imperfect for v1; recommend fixing in 10-02 since the ingest depends on per-shop `auth_failed` skip behavior. |
| `customer_id` / `login_customer_id` sent verbatim; a stored `"123-456-7890"` fails with `INVALID_CUSTOMER_ID`. | `client.ts:177-181` | HIGH | Confirm 10-01 callback stores bare 10-digit ids; if not guaranteed, normalize (`replace(/-/g,'')`) before constructing the Customer. |
| `types.ts` declares `encrypted_refresh_token: Buffer`, but `client.ts` actually reads a PostgREST `\x<hex>` STRING (direct sibling of the bytea bug, read-type side). | `types.ts:18` vs `client.ts:153-162` | MEDIUM | Change type to `string` (or `Buffer \| string`). Any 10-02 re-read of `google_ads_accounts` must not assume Buffer. |
| `disable_parsing` silently flips the row shape: if ever set, `row.metrics.cost_micros` becomes undefined and `?? 0` writes all-zero snapshots that look like a healthy empty account. | `client.ts:171-181` | MEDIUM | Keep `disable_parsing` unset; add a sanity check or test that a known non-zero day parses to non-zero. |
| `login_customer_id ?? undefined` silently drops the header; an MCC-linked account with a null value fails with `USER_PERMISSION_DENIED`. | `client.ts:177-181` | MEDIUM | For MCC-linked shops, fail loudly when `login_customer_id` is null rather than dropping the header. |
| `oauth.ts` assumes `refresh_token` always present on token exchange; only true because `access_type=offline` + `prompt=consent` are set. | `oauth.ts:104-113,158-196` | LOW | Keep both params; guard against undefined `refresh_token` before encrypt/store so a re-consent without one does not persist garbage. |
| `fetchCampaignMetrics` wrong shape for account daily totals. | `campaigns.ts:204-247` | INFO | Do not reuse; write `fetchAccountDailyMetrics`. |

Out of 10-02 scope but flagged: campaign creation (`campaigns.ts:49-83`) is non-atomic (two mutate round-trips) and creates a SEARCH campaign with no bidding strategy or network settings; Google may reject it with `REQUIRED_FIELD_MISSING` on a first live mutation. Mutation enum literals themselves are correct for v23.

## OAuth + developer-token + access (for the 10-03 gate batch)

The inherited OAuth code is structurally correct. The blockers are Google configuration, not code.

- Scope: exactly `https://www.googleapis.com/auth/adwords`, with `access_type=offline` and `prompt=consent` (`oauth.ts:6,104-113`). Together these reliably return a refresh token on every consent. Correct, no change needed.
- Developer-token access tiers (primary source confirmed):
  - Test: test accounts only, cannot read any production account. A fresh token defaults here.
  - Explorer: test + production, but capped at 2,880 ops/day on production; reporting reads (`GoogleAdsService.Search`/`SearchStream`) ARE allowed. This is the true minimum floor for reading a real pilot shop.
  - Basic: test + production, 15,000 ops/day, no feature restrictions. The right target for a fleet.
  - Standard: effectively unlimited.
  - For a pilot reading one account-level query per shop per day, Explorer is sufficient; Basic is the safer scaling target. The gate condition is "token approved to Explorer or higher," not merely "OAuth connected."
- `login_customer_id`: required only when the pilot is accessed through the agency MCC; set it to the manager id. For a direct per-shop link, leave it null. Wrong value or wrong null state both fail with `USER_PERMISSION_DENIED`. The DB column is nullable and the code supports both paths.
- Env / cred list the server needs: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_REDIRECT_URI` (must match the Cloud Console registered URI verbatim, prod callback not localhost), `ADS_STATE_SECRET` (HMAC for OAuth state), and the app AES-256-GCM key for refresh-token crypto. `login_customer_id` is per-account in the DB, not an env var.
- BLOCKERS that would stop a first-live-run:
  1. Developer token at Test tier. OAuth link succeeds but the first GAQL query against the pilot returns `DEVELOPER_TOKEN_NOT_APPROVED` / permission errors. Verify the tier in `ads.google.com/aw/apicenter` BEFORE 10-03. Basic approval is human-reviewed (~2 business days) and requires the Google Ads accounts to be linked to a manager account first; start this lead time before the gate.
  2. OAuth consent screen in Testing (External). The sensitive `adwords` scope causes Google to revoke refresh tokens 7 days after consent, even with `access_type=offline`. The daily ingest would work for a week in dev then break in production with `invalid_grant`. The consent screen must be moved to In Production (verification may be required) before scheduling the daily job. This is the single most likely delayed-failure cause.

Both blockers are operational lead-time items. The 10-02 orchestrator should treat `auth_failed` as a per-shop skip and surface it for re-link (mirroring the SEMrush ledger), not a whole-run failure; `client.ts` already maps `invalid_grant` -> `AdsApiError('auth_failed')` and flips the account to `status='error'`.

## Open decisions for the 10-02 plan

1. Row granularity: account-level-only vs also per-campaign rows. Recommendation: account-level-only (`FROM customer`, one snapshot row per shop per day). It is the simplest correct shape and matches the SEMrush surface. Revisit per-campaign only if the UI later needs a breakdown; if so, query `FROM campaign` and persist additional rows, never sum averages.
2. Target date and freshness: today vs yesterday vs trailing re-sync. Recommendation: ingest YESTERDAY (settled in account timezone), plus a trailing re-sync window (last 7 to 30 days) so conversion lag backfills earlier snapshots. The idempotent upsert makes re-syncing safe. Do NOT use `TODAY` (partial) or `LAST_30_DAYS` (30-day window excluding today). Note this departs from the plan's stated `date=today`; flag the tradeoff: `today` undercounts conversions and overstates CPL.
3. Date literal form: `BETWEEN 'd' AND 'd'` with an explicit account-tz date string. Recommendation: explicit `BETWEEN`, because it is safe for idempotent re-runs and backfills and is documented for `segments.date`. Avoid `segments.date = 'd'` (refuted) and avoid `DURING YESTERDAY` if you want deterministic backfill control.
4. Timezone source of the `date` column: derive the date string from the Google Ads account timezone, not the server clock, so it matches `segments.date` bucketing and stays idempotent against the unique key. A cron at 00:30 server time can otherwise request a "yesterday" that is still "today" in the account tz.
5. Eligibility filter: iterate only shops with a `google_ads_accounts` row where `status='linked'`. Skip `status='error'` and surface for re-link.
6. CPL derivation and zero policy: compute `cpl = conversions > 0 ? spend / conversions : null` in code. Decide null vs 0 for zero-conversion days; recommend null (true "no data" vs a real zero). Store raw `cost_micros` alongside derived `spend`/`cpl` for audit.
7. Empty-day policy: write a zero-metrics snapshot (all zeros, `cpl=null`) rather than skipping, so the time series has no gaps. The zero-init aggregation gives this for free.
8. Cron cadence and cost: one SEARCH call per linked shop per day is far under `ADS_READ_LIMIT_PER_HOUR` (default 500/hr) and under Explorer's 2,880 prod ops/day for a small pilot fleet. A trailing re-sync multiplies calls by the window size (one call per day per shop), so a 30-day re-sync on many shops can approach Explorer's cap; size the re-sync window against the token tier and shop count, or move to Basic.
9. `period` value: use `period='daily'` to match the existing analytics surface and the SEMrush convention.

## Confidence + gaps

High-confidence (validated against the installed `google-ads-api@23.0.0` source and primary Google docs, plus adversarial confirmation):
- Row shape, snake_case keys, INT64 -> Number coercion, parsing-on-by-default. Confirmed.
- `cost_micros` is micros; `spend = cost_micros / 1_000_000`; `fromMicros`/`toMicros` exported. Confirmed.
- Auth constructor shape and `login_customer_id` semantics for MCC. Confirmed.
- `FROM customer` yields account-level totals; one `customer` resource_name yields one totals row. Confirmed, with the precise mechanism that GAQL aggregates by the FROM resource_name (there is no `GROUP BY`).
- Selecting a segment splits rows; `segments.date` in WHERE filters without splitting. Confirmed.
- Developer-token tiers and the Explorer-minimum-for-production-reads conclusion. Confirmed against the live access-levels page.
- The `mapGoogleAdsError` structured-failure defect. Confirmed against library source.

Corrected / refuted by the adversarial pass (fold these into the plan):
- REFUTED: `segments.date = 'YYYY-MM-DD'` as a single-day filter. The `=` operator is documented only for `segments.week/month/quarter/year` (first-day-of-period value), not `segments.date`. Use `BETWEEN`, `>=`/`<=`, or `DURING`. This is the most important correction; the earlier researcher findings that recommended `= 'date'` are superseded.
- UNCERTAIN, citation corrected: the claim that "omitting a date filter returns all-available-time data" is real API behavior but is NOT on the cited `docs/query/date-ranges` page. The enforced documented rule is narrower: selecting any core date segment REQUIRES a date filter in WHERE. Engineering takeaway unchanged: always pin the window with an explicit WHERE filter.
- Precision note: `metrics.average_cpc` and `metrics.cost_per_conversion` are DOUBLE returned in micros-valued units; do not surface them directly without dividing, and never sum them. Computing CPL from `cost_micros / conversions` avoids this entirely.

Needs LIVE verification at the 10-03 gate batch (cannot be settled from docs/source):
- Actual developer-token tier of the PSG token (Test vs Explorer vs Basic) in `ads.google.com/aw/apicenter`.
- OAuth consent screen publishing status (Testing vs In Production) for the `GOOGLE_OAUTH_CLIENT_ID`, and whether the `adwords` scope has passed Google verification.
- Whether `getGoogleAdsClient(shopId)` builds the Customer against the individual linked `customer_id` (not the MCC), so `FROM customer` returns that shop's totals.
- Whether 10-01's callback stored `customer_id`/`login_customer_id` as bare 10-digit strings.
- Whether any pilot account sits under an MCC requiring a non-null `login_customer_id`.
- Empirically confirm the single-row cardinality and that a known non-zero day parses to non-zero metrics on the first real query.
