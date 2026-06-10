# 11-04 GATE BATCH — Phase-11 GA4 + GSC prod activation

> **Operator runbook.** Claude authored this; the operator executes it. Nothing here was run by Claude.
> **What it activates:** the entire Phase-11 build (11-01 OAuth foundation · 11-02 GA4 ingest · 11-03 GSC ingest),
> all local + gate-checked, ZERO prod contact so far. Two un-applied prod migrations, one new secret, nothing
> committed/deployed.
> **Loop closes on REAL NUMBERS** on the live surface (a pilot shop's GA4 "Website traffic" + GSC "Search
> performance" panels), never "cron returned 200".
> **Run order:** Stage 0 (start first — consent + a verified GSC site have lead time) → Stage A (migrations) →
> Stage B (secret) → Stage C (commit + deploy) → Stage D (pilot link + first-live-run) → Stage E (close).

---

## Verified environment (re-confirmed 2026-06-09 — supersedes the stale 08-01 `psg-internal` note)

| Fact | Value |
|------|-------|
| Repo | `github.com/Phoenix-Solutions-Group/psg-hub.git` (confirmed `git remote -v`) |
| Repo toplevel | `/Users/schoolcraft_mbpro/dev/psg/internal/psg-hub` |
| Branch | currently `main`, NOT ahead of `origin/main` (Phase-11 work is working-tree only). **main auto-deploy OFF** (`vercel.json git.deploymentEnabled.main=false`). Task 2 branches `feature/11-ga4-gsc` and commits there. |
| Deploy cmd | `vercel --prod` run **from the repo toplevel** (its `.vercel` → `prj_CBrI1FRqqgPzCbAwin6LbSknY48U`, `projectName psg-hub`, `rootDirectory apps/psg-hub/`) |
| ⚠️ HAZARD | a **2nd `.vercel` exists at `/dev/psg/internal/`** (above the repo) — confirmed present. Deploy ONLY from `/dev/psg/internal/psg-hub`, never from there or from `apps/psg-hub/`. `cat .vercel/project.json` must show `rootDirectory "apps/psg-hub/"` before deploying. |
| Prod DB | shared Supabase `gylkkzmcmbdftxieyabw` |
| Migrations dir | `apps/psg-hub/supabase/migrations/` |
| Migration gate | `.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md` + `CHECKLIST-rls-review.md` — advisor baseline BEFORE → apply ONE → advisor diff AFTER → ABORT on any unintended diff |
| Already live (do NOT re-apply) | `20260609000000_google_ads_oauth_pending.sql` (the 10-04 MCC migration, applied in the 10-03/10-04 batch). This batch applies ONLY the two `20260609183451/52` 11-01 tables. |

**Encryption / no-pgsodium:** Phase 11 reuses the Phase-10 app-key AES-256-GCM (`ADS_ENCRYPTION_KEY`, `\x<hex>` bytea round-trip) — the recorded, operator-approved deviation from the PROJECT pgsodium constraint. No re-key, no new key.

---

## STAGE 0 — Lead-time blockers (START FIRST — these gate Stage D; can have days of latency)

Google Console config + property verification, not code. The code is correct; these are operational.

**0.1 OAuth consent — add the two new SENSITIVE scopes** to the existing `GOOGLE_OAUTH_CLIENT_ID` consent screen.
- Phase 10 already published this screen In Production with the `adwords` scope. Phase 11 ADDS
  `https://www.googleapis.com/auth/analytics.readonly` + `https://www.googleapis.com/auth/webmasters.readonly`.
- These are **sensitive** scopes (not *restricted* — no CASA security assessment), but adding them to a published
  app **may re-trigger Google's verification review**. While the screen is unverified for the new scopes, refresh
  tokens can be **revoked 7 days after consent** (the Testing-mode death that bit the Phase-10 `adwords` path).
  **Confirm current Google policy before relying on a timeline** — do NOT assume an ETA.
- ☐ **Pass-gate (EMPIRICAL, not an asserted timeline):** run the real OAuth link flow (Stage D.1 can be done early
  against the *current* deploy if Stage A/B/C are not yet done — or just dry-run the consent) and confirm (a) NO
  "Google hasn't verified this app" hard wall for these scopes, AND (b) a refresh token minted today still mints an
  access token **>7 days later**. If either fails, the consent is not production-ready — resolve before Stage D.

**0.2 Google Cloud APIs enabled** in the project behind `GOOGLE_OAUTH_CLIENT_ID`:
- ☐ **GA4:** Google Analytics Admin API **and** Google Analytics Data API enabled.
- ☐ **GSC:** Google Search Console API enabled.
- (Enable in console.cloud.google.com → APIs & Services → Enable APIs. A disabled API returns a clear 403
  `SERVICE_DISABLED` at first call — but enabling now removes a Stage-D stall.)

**0.3 Pilot prerequisites — does a pilot shop have BOTH a GA4 property AND a verified GSC site?**
- **GA4:** ⭐ Wallace GA4 access is available (operator 2026-06-09) — GA4 side is unblocked.
- **GSC:** GSC requires a **verified** Search Console property (`sc-domain:<host>` via DNS, or a URL-prefix via
  HTML/DNS) reachable under the Google account the operator consents with. **Verify a pilot site exists** — site
  verification has its OWN lead time (DNS propagation).
- ☐ **Pass-gate:** the pilot shop has a GA4 property the consenting account can read AND a verified GSC site the
  consenting account owns/can-query. If only GA4 exists, see Stage E — **GA4 closes live, GSC = activation-pending**
  (honest partial, exactly as 10-03 did for Ads-vs-SEMrush). Do NOT block GA4 on a missing GSC site.

> Stage A/B/C (migrations + secret + deploy) do NOT depend on Stage 0 — run them while 0.1/0.3 are in review.

---

## STAGE A — prod migrations ×2 (the two 11-01 tables) under PROTOCOL

Each migration: capture advisor **baseline** (`get_advisors` security + performance) → apply **this migration only**
(`supabase db push --linked` for the single file, or MCP `apply_migration`) → capture advisor **diff** → ABORT on any
unintended diff. The 10-04 `20260609000000` migration is ALREADY LIVE — `db push` should see only the two below as pending.

**A.1 `20260609183451_google_oauth_accounts.sql`**
- ☐ **Pass-gate (expected diff, anything else = ABORT):** `google_oauth_accounts` exists (source CHECK `ga4`/`gsc`,
  `external_account_id`, `encrypted_refresh_token bytea` + `key_version`, status CHECK, `UNIQUE(shop_id,source,
  external_account_id)`, FK→shops); **RLS ON with exactly 1 membership SELECT policy** (`shop_id in user_shop_ids()`,
  cmd=r). The only new advisor line should reference this table's RLS as intended.

**A.2 `20260609183452_google_oauth_pending_states.sql`**
- ☐ **Pass-gate (expected diff, anything else = ABORT):** `google_oauth_pending_states` exists (mirror of the ads
  oauth_states + `source` col + `pending_accounts` jsonb, NO `login_customer_id`); **RLS ON, 0 policies (default-deny)**
  → expect exactly ONE new `rls_enabled_no_policy` INFO advisor line. No other ERROR/WARN/new object.

---

## STAGE B — prod secret (one new env; the rest are already set from Phase 10)

```
cd /Users/schoolcraft_mbpro/dev/psg/internal/psg-hub
vercel env add GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI production
   # value: https://hub.psgweb.me/api/analytics/google/callback  (the 11-01 combined-consent redirect)
```
- ☐ **Verify already present** (set in the Phase-10 batch — do NOT re-add): `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `ADS_STATE_SECRET`, `ADS_ENCRYPTION_KEY`, `CRON_SECRET`.
- **NO developer token** for GA4/GSC (unlike Ads). The ga4-sync + gsc-sync cron 503-gate keys ONLY on
  `GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI`.
- ☐ **Pass-gate:** `vercel env ls` shows `GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI` at production scope + the 5 above present.

---

## STAGE C — commit + deploy

**C.1 Branch + commit** the Phase-11 trees (11-01 + 11-02 + 11-03 code, plans, summaries) — on `main`, so branch first:
```
cd /Users/schoolcraft_mbpro/dev/psg/internal/psg-hub
git checkout -b feature/11-ga4-gsc
git add -A   # the google-oauth lib, /api/analytics/google + /api/cron/{ga4,gsc}-sync routes, the 2 migrations,
             # page.tsx panels, types, vercel.json, e2e, and the .paul/phases/11-ga4-gsc/* plan+summary docs
git commit -m "feat(11-ga4-gsc): Phase 11 — GA4 + GSC ingest (11-01 + 11-02 + 11-03)"
```
- ☐ **Pass-gate:** one clean Phase-11 commit; `git status` clean.

**C.2 Deploy** — from the repo toplevel (NOT the above-repo dir, NOT `apps/psg-hub/`):
```
cd /Users/schoolcraft_mbpro/dev/psg/internal/psg-hub
cat .vercel/project.json     # MUST show rootDirectory "apps/psg-hub/"
vercel --prod
```
- ☐ **Pass-gate:** deployment **Ready**; `hub.psgweb.me` serves; the build lists `ƒ /api/cron/ga4-sync` AND
  `ƒ /api/cron/gsc-sync` (4 crons total with semrush + google-ads).

---

## STAGE D — pilot link + first-live-run (REAL NUMBERS, gated on Stage 0)

**D.1 Link the pilot Google account** (combined consent):
- As an OWNER of the pilot shop, open `/dashboard/analytics` → "Connect Google Analytics & Search Console" → run the
  OAuth flow once. One consent mints one refresh token; the picker offers GA4 properties + GSC sites; pick one of each.
- ☐ **Pass-gate:** two `google_oauth_accounts` rows for the shop (`source='ga4'` + `source='gsc'`), both
  `status='linked'`, sharing one encrypted token.

**D.2 Trigger both ingests** (or wait for the 06:30 / 06:45 UTC crons):
```
curl -H "Authorization: Bearer $CRON_SECRET" https://hub.psgweb.me/api/cron/ga4-sync
curl -H "Authorization: Bearer $CRON_SECRET" https://hub.psgweb.me/api/cron/gsc-sync
```
- ☐ Both return 200 `{synced,skipped,failed}` (a 503 = a missing creds env from Stage B; a 401 = wrong CRON_SECRET).

**D.3 Verify REAL NUMBERS on the live surface** — open `/dashboard/analytics` for the pilot shop:
- ☐ **GA4 "Website traffic" pass-gate:** sessions / users / key events read **non-zero** for the linked property; the
  sessions chart renders real points. (This is also the live smoke for RESEARCH #1 — the gax `authClient` injection
  authenticates at runtime, not just at compile.)
- ☐ **GSC "Search performance" pass-gate:** clicks / impressions / position read **non-zero**; the clicks chart renders.

**D.4 Live probes baked into D.3 (diagnose, do not assume):**
- **RESEARCH #4 — siteUrl encoding (RESOLVED IN CODE):** gsc-metrics passes `siteUrl` RAW because googleapis@173
  percent-encodes the `{siteUrl}` path param itself (verified against `googleapis-common/apirequest.js` RFC-6570
  url-template). If the GSC query nonetheless **404/403s on the site key**, the diagnosis is a *double-encode
  regression* — confirm gsc-metrics sends raw, not `encodeURIComponent`. This is a code round-trip, not a console toggle.
- **RESEARCH #3 — GSC data lag / max-date:** GSC data lags ~2-3 days; recent days in the 7-day window may return NO
  rows. That is **expected, not a failure** — the panel shows the most recent *available* day. To confirm the window
  is wide enough, check that the max stored `gsc` date is within the last few days (older finalized days are present).
  If ALL 7 days are empty for a site with known traffic, THEN investigate (wrong site key, no `web` data, API not enabled).
- **GA4 freshness:** GA4 reprocesses ~18-48h; GA4_RESYNC_DAYS=3 backfills the settling days. Recent-day numbers may
  rise on the next run — the idempotent upsert handles it.

---

## STAGE E — close

- ☐ **Both sources live** (GA4 + GSC real numbers) → **Phase 11 ✅ COMPLETE + LIVE.** Merge `feature/11-ga4-gsc` →
  `main` + push. Run `/paul:unify 11-04` → transition → `/paul:plan` Phase 12 (PSG report).
- ☐ **Honest partial** (GA4 live, GSC site not yet verified per Stage 0.3): close Phase 11 with **GA4 live + GSC
  activation-pending**; the GSC cron is deployed and 200s with `synced:0` until a verified site is linked. Record the
  GSC-pending state; do NOT mark it a defect (it is a missing operator prerequisite, exactly like 10-03's Ads-lead-time path).

---

## Failure → fix-path quick reference

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| cron returns 503 `ga4_not_configured` / `gsc_not_configured` | `GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI` (or id/secret) unset in prod | Stage B — `vercel env add`, redeploy |
| cron 401 | wrong/empty `CRON_SECRET` in the curl | use the prod `CRON_SECRET` value |
| OAuth link dies after ~7 days with `invalid_grant` | consent screen unverified for the new sensitive scopes (Testing-mode token death) | Stage 0.1 — publish/verify the new scopes, re-link |
| GA4 runReport 403 `SERVICE_DISABLED` | GA4 Admin/Data API not enabled | Stage 0.2 |
| GSC query 404/403 on the site key | double-encoded siteUrl OR the site isn't verified under the consenting account | confirm gsc-metrics sends RAW siteUrl (Stage D.4); confirm Stage 0.3 site verification |
| GSC all days empty, GA4 fine | GSC lag (recent days) OR wrong site key OR no `web`-type data | widen check to older days; confirm the linked `external_account_id` matches the verified property exactly |
| migration advisor diff shows unexpected objects | not the clean 2-table diff | ABORT per PROTOCOL; do not proceed |
