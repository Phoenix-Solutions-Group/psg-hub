# 10-03 GATE BATCH — Combined Phase-9 (SEMrush) + Phase-10 (Google Ads) prod activation

> **Operator runbook.** Claude authored this; the operator executes it. Nothing here was run by Claude.
> **Why combined:** nothing from Phase 9 or Phase 10 is activated. 3 migrations unapplied, secrets unset,
> nothing pushed/deployed — all sit in ONE `feature/09-analytics` tree, so one deploy ships both.
> **Loop closes on REAL NUMBERS** on the live surface (SEMrush 4 url-shops + the Ads pilot), never "cron returned 200".
> **Run order:** Stage 0 (start first, has lead time) → Stage A (SEMrush, no external lead time) → Stage B (Google Ads, gated on Stage 0) → Stage C (merge/push).

---

## Verified environment (pinned 2026-06-08 — supersedes any stale `psg-internal` / `data` notes)

| Fact | Value |
|------|-------|
| Repo | `github.com/Phoenix-Solutions-Group/psg-hub.git` |
| Repo toplevel | `/Users/schoolcraft_mbpro/dev/psg/internal/psg-hub` |
| Branch | `feature/09-analytics` (ahead of `origin/main`; **main auto-deploy OFF** via `vercel.json git.deploymentEnabled.main=false`) |
| Deploy cmd | `vercel --prod` run **from the repo toplevel** (its `.vercel` → `prj_CBrI1FRqqgPzCbAwin6LbSknY48U`, `projectName psg-hub`, `rootDirectory apps/psg-hub/`) |
| ⚠️ HAZARD | a **2nd `.vercel` exists at `/dev/psg/internal/`** (above the repo). Do NOT deploy from there, and not from `apps/psg-hub/`. Deploy only from `/dev/psg/internal/psg-hub`. Confirm `cat .vercel/project.json` shows `rootDirectory apps/psg-hub/` before deploying. |
| Prod DB | shared Supabase `gylkkzmcmbdftxieyabw` |
| Migrations dir | `apps/psg-hub/supabase/migrations/` |
| Migration gate | `.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md` + `CHECKLIST-rls-review.md` — advisor baseline BEFORE → apply ONE → advisor diff AFTER → ABORT on any unintended diff |

---

## STAGE 0 — Lead-time blockers (START FIRST — these gate Stage B; days of latency)

These are Google Console config, not code. The code is correct; these are operational.

**0.1 Developer-token tier** — open `ads.google.com/aw/apicenter` for the PSG token.
- A fresh token is **Test** tier (test accounts only — cannot read a real pilot account).
- **Explorer** is the minimum to read a production account (2,880 ops/day cap — fine for a small pilot).
- **Basic** (15,000 ops/day) is the scaling target; approval is **human-reviewed ~2 business days** and requires the Google Ads accounts linked to a manager account first. **Start this now if not already ≥ Explorer.**
- ☐ **Pass-gate:** apicenter shows the token at **Explorer or higher**.

**0.2 OAuth consent screen → In Production** — for `GOOGLE_OAUTH_CLIENT_ID` in Google Cloud Console.
- The sensitive `https://www.googleapis.com/auth/adwords` scope causes Google to **revoke refresh tokens 7 days after consent** while the consent screen is in **Testing**. The daily ingest would work for a week, then break in prod with `invalid_grant`. This is the single most likely delayed failure.
- ☐ **Pass-gate:** consent screen **publishing status = In Production** (scope verification passed if prompted).

> Stage A does NOT depend on Stage 0 — run Stage A while 0.1/0.2 are in review.

---

## STAGE A — Phase 9 SEMrush activation (no external lead time; can fully close on its own)

**A.1 Prod migration `20260604000000_analytics_snapshots.sql`** (includes the 09-02 `location_id drop not null` amendment).
- Follow `PROTOCOL-migration-safety.md`: capture advisor **baseline** (`get_advisors` security + performance) → apply **this migration only** (`supabase db push --linked` for the single file, or MCP `apply_migration`) → capture advisor **diff**.
- ☐ **Pass-gate:** diff shows ONLY the intended objects; `analytics_snapshots` source CHECK admits `semrush` AND `google_ads`, `location_id` is **nullable**, RLS intact. **ABORT** if anything else appears.

**A.2 Prod migration `20260605000000_analytics_sync_runs.sql`** — same PROTOCOL (fresh baseline → apply → diff).
- ☐ **Pass-gate:** `analytics_sync_runs` exists, **RLS on, 0 policies (default-deny)**, source CHECK admits `semrush`+`google_ads`. No unintended diff.

**A.3 Prod secrets** (Vercel, production scope):
```
vercel env add SEMRUSH_API_KEY production      # paste the prepaid SEMrush key
vercel env add CRON_SECRET production          # the cron is LOCKED without this (both crons gate on it)
```
- ☐ **Pass-gate:** `vercel env ls` shows both at production scope.

**A.4 Deploy** — from `/dev/psg/internal/psg-hub` (NOT the above-repo dir):
```
cd /Users/schoolcraft_mbpro/dev/psg/internal/psg-hub
cat .vercel/project.json    # confirm rootDirectory "apps/psg-hub/"
vercel --prod
```
- ☐ **Pass-gate:** deployment **Ready**; `hub.psgweb.me` serves; `/api/cron/semrush-sync` exists on the build.

**A.5 SEMrush first-live-run** — trigger the cron (or wait for 06:00 UTC):
```
curl -H "Authorization: Bearer $CRON_SECRET" https://hub.psgweb.me/api/cron/semrush-sync
```
- Then open **`/dashboard/analytics`** for the **4 url-bearing shops** and read the organic KPIs.
- The `SemrushContractError` guard throws on a full header mismatch, but a **partial rename could zero one metric** silently. **If any metric reads 0, log the raw SEMrush response headers** and compare to the contract before accepting.
- ☐ **Pass-gate (REAL NUMBERS, not cron-200):** ≥1 real non-zero organic metric for each of the 4 url-shops on the live surface. A green cron with zero rows is a FAIL — investigate headers.

> **Stage A done = Phase 9 live.** If Stage B is blocked on Stage-0 review, Phase 9 closes here; Google Ads stays activation-pending (see Stage C.2).

---

## STAGE B — Phase 10 Google Ads activation (gated: Stage 0 tiers must be approved)

**B.1 Prod migration `20260608000000_google_ads_tables.sql`** — PROTOCOL (baseline → apply → diff).
- ☐ **Pass-gate:** 4 tables (`google_ads_accounts`, `google_ads_campaigns`, `google_ads_oauth_states`, `ads_api_call_log`) **RLS on**; ONLY the **2 membership SELECT policies** (accounts + campaigns); `oauth_states` + `ads_api_call_log` **default-deny (0 policies)**; both onConflict unique keys present (`accounts` shop_id+customer_id, `campaigns` shop_id+external_id); the `ads_api_call_log (shop_id, method, created_at)` rate-limit index present. No unintended diff.

**B.2 Prod secrets** (Vercel, production scope) — 6 required + 1 conditional + optional tunables:
```
vercel env add GOOGLE_OAUTH_CLIENT_ID production
vercel env add GOOGLE_OAUTH_CLIENT_SECRET production
vercel env add GOOGLE_ADS_DEVELOPER_TOKEN production
vercel env add GOOGLE_ADS_OAUTH_REDIRECT_URI production   # MUST match the Cloud Console registered URI verbatim — the PROD callback (https://hub.psgweb.me/api/ads/google/callback), not localhost
vercel env add ADS_STATE_SECRET production                # HMAC for the OAuth state token
vercel env add ADS_ENCRYPTION_KEY production              # base64 that decodes to EXACTLY 32 bytes (AES-256-GCM, key_version 1) — NOT the throwaway .env.test.local key
# Conditional — only if the pilot account is accessed through the agency MCC:
vercel env add GOOGLE_ADS_LOGIN_CUSTOMER_ID production    # the manager (MCC) id; leave UNSET for a direct per-shop link
# Optional tunables (defaults are fine): ADS_RESYNC_DAYS (7), ADS_READ_LIMIT_PER_HOUR (500), ADS_MAX_DAILY_MICROS
```
- Generate the AES key if needed: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- ☐ **Pass-gate:** `vercel env ls` shows all 6 (+ MCC if used). **Redeploy** (`vercel --prod` from the repo toplevel) so the new env reaches the running functions. The `/api/cron/google-ads-sync` 503-gate clears once `GOOGLE_ADS_DEVELOPER_TOKEN` + `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` are present.

**B.3 Pilot-shop OAuth link** — operator-only (no CLI; this is the real `checkpoint:human-action`).
- Visit the prod `/dashboard/ads` link flow for a pilot shop (Wallace / Tedesco / Tracy's) → complete Google consent (`access_type=offline` + `prompt=consent` are set → refresh token returned).
- ☐ **Pass-gate:** `google_ads_accounts` has a row for the shop with **`status='linked'`**; the `/dashboard/ads` surface shows the linked account (not the unlinked state). The refresh token round-trips (the 10-01 bytea `\x<hex>` fix decodes it).

**B.4 Google Ads first-live-run** — trigger the cron:
```
curl -H "Authorization: Bearer $CRON_SECRET" https://hub.psgweb.me/api/cron/google-ads-sync
```
- Then open **`/dashboard/analytics`** → the **Paid advertising** panel for the pilot. RESEARCH live-verification checks (cannot be settled from docs):
  - ☐ **single-row cardinality** — `FROM customer` returns exactly one totals row.
  - ☐ **non-zero parse** — a known active day parses to non-zero spend/clicks (not `?? 0` masking an undefined shape).
  - ☐ **account-tz date bucket** — the stored `date` matches the account-timezone `segments.date` bucket (UTC-yesterday derivation; the 7-day trailing re-sync backfills any skew).
  - ☐ **individual customer_id** — `getGoogleAdsClient(shopId)` built the Customer against the pilot's own linked `customer_id`, not the MCC; the stored `customer_id` is a **bare 10-digit** string (a dashed `123-456-7890` fails `INVALID_CUSTOMER_ID`).
- ☐ **Pass-gate (REAL NUMBERS):** real non-zero paid metrics for the pilot on the live panel — OR a confirmed genuine-zero day. A green cron alone is a FAIL.

---

## STAGE C — Close-out

**C.1 Merge + push** (the 10-02 tree was already committed locally by the 10-03 apply; nothing to commit if clean):
```
cd /Users/schoolcraft_mbpro/dev/psg/internal/psg-hub
git checkout main && git merge feature/09-analytics && git push origin main
```
- ☐ **Pass-gate:** `origin/main` carries the Phase-9 + Phase-10 commits. (Main auto-deploy is OFF, so the Stage-A/B `vercel --prod` already served prod; pushing main does not re-trigger a deploy.)

**C.2 Honest close** — report results to close the 10-03 loop:
- **Both first-live-runs passed** → "SEMrush live (N/4 shops real) + Google Ads live (pilot real)" → **Phase 10 ✅ complete**, milestone v0.3 advances (2 of 4 phases).
- **Stage 0 still blocking Ads** → "SEMrush/Phase 9 live; Google Ads **activation-pending** (dev-token review / consent verification)" → close 10-03 with Phase 9 live + Google Ads recorded activation-pending. This is honest, not a defect — never mark Ads live on a green cron alone.
- **A PROTOCOL diff aborted or a gate failed** → paste the advisor diff / error and fix-forward before resuming.

---

## Quick checklist

- [ ] 0.1 dev-token ≥ Explorer · 0.2 OAuth consent In Production *(start first)*
- [ ] A.1 migrate analytics_snapshots (PROTOCOL) · A.2 migrate analytics_sync_runs (PROTOCOL)
- [ ] A.3 secrets SEMRUSH_API_KEY + CRON_SECRET · A.4 `vercel --prod` from repo toplevel
- [ ] A.5 **SEMrush real numbers, 4 url-shops** (not cron-200)
- [ ] B.1 migrate google_ads_tables (PROTOCOL) · B.2 6 Google secrets + redeploy
- [ ] B.3 pilot OAuth link → status='linked' · B.4 **Ads real numbers, pilot** (single-row/non-zero/account-tz/bare-id)
- [ ] C.1 merge → main → push · C.2 honest close (both-live vs SEMrush-live + Ads-pending)
