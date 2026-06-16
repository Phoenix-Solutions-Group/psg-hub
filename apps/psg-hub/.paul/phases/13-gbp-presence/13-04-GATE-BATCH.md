# Phase 13 / 13-04 — Combined Operator Gate Batch (GBP prod activation)

One ordered runbook to activate the entire Phase-13 GBP vertical on prod: 13-01 OAuth
link foundation · 13-02 daily insights ingest · 13-03 monthly presence + star rating.
Everything is build-local + LOCALLY gate-verified and **already committed + pushed to
`main`** (`916ace1` / `14e27cc` / `b9a9cba`) — but nothing is migrated to prod, nothing is
deployed (main does NOT auto-deploy: `vercel.json` `git.deploymentEnabled.main=false`), and
no shop has re-consented under `business.manage`.

**Operator routing (2026-06-15): "partial now, pending close."** Execute the
gate-INDEPENDENT prod work NOW (Stage A migrations under PROTOCOL + Stage C `vercel --prod`
so the committed gbp crons go live, 200/synced:0), then close 13-04 **ACTIVATION-PENDING**
on the two external Google gates (Stage 0 Gate A + Gate B), Wallace re-consent, the live
smokes, and the empirical 7-day token pass-gate (Stage D). Same build-local → operator-gate
pattern as Phases 9/10/11 and 12-05c. **Closes Phase 13** (last plan).

**Authority:** `13-RESEARCH.md` (Gate A/B mechanics, the empirical pass-gate, the In-Production
verification trap) + `13-03-RESEARCH.md` (the v4 reviews deferrals). No new external API
surface — this is the LIVE execution of the already-researched + already-built GBP contracts.

---

## Verified deploy environment (re-confirmed 2026-06-15)

| Fact | Value |
|------|-------|
| Repo | `https://github.com/Phoenix-Solutions-Group/psg-hub.git` |
| Toplevel (deploy from HERE) | `/Users/schoolcraft_mbpro/dev/psg/internal/psg-hub` |
| Branch | `main` (build already pushed; main deploy is OFF, so `vercel --prod` is explicit) |
| Repo-root `.vercel` | `prj_CBrI1FRqqgPzCbAwin6LbSknY48U` (project `psg-hub`, rootDirectory `apps/psg-hub/` server-side) |
| ⚠️ HAZARD | An **above-repo** `../.vercel` exists (a DIFFERENT project). Deploy ONLY from the repo toplevel; never from above the repo. |
| Prod Supabase | `gylkkzmcmbdftxieyabw` |
| Migration safety | `.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md` (baseline → apply ONE → diff → ABORT) |

---

## Stage 0 — The two external Google gates + the chat-key revoke (START FIRST; the activation-pending axis)

These are external Google reviews with real lead time and are **already on the clock**. They
do NOT block Stage A-C (migrations + deploy), but they DO block Stage D (the live link +
smoke). Start them day 1; Phase 13 stays activation-pending until they clear.

### Gate A — Business Profile API access (quota 0 → 300 QPM)
- **Check first (the single biggest schedule unknown — 13-RESEARCH Open Q #1):** open the
  GCP Quotas page for the OAuth client's project. Is the Business Profile API at **300 QPM**
  (already approved) or **0 QPM** (must file)?
- **If 0:** file "Application for Basic API Access" at `support.google.com/business/contact/api_default`.
  Official anchor: **reviewed within 14 days** (do NOT plan against the unverified "4 days–6 weeks").
- **Per-API trap:** after approval, confirm **300 QPM on EVERY API called**, not just one —
  My Business Account Management, My Business Business Information, Business Profile Performance,
  AND the legacy **Google My Business API** (v4 reviews; enable it in Cloud Console — visible
  only after Gate A approval). A per-API line can lag at 0 and 429 while others work.

### Gate B — OAuth verification for `business.manage`
- The Phase-11 consent grants only `analytics.readonly webmasters.readonly`. Adding
  `business.manage` to the In-Production OAuth client **re-triggers sensitive-scope verification**
  (the Testing-mode escape hatch does NOT apply — the app is In Production since Phase 10).
- **Confirm the classification in the Cloud Console OAuth config: sensitive vs restricted.**
  Restricted adds an annual **CASA Tier 2** third-party assessment (weeks, paid) and materially
  changes the timeline. 13-RESEARCH could not pin this to a primary source — confirm before
  committing any date.
- Verification typically wants a demo video showing the consent screen + each scope's use.

### Chat-key revoke (housekeeping, do now)
- Revoke the GCP key pasted in chat (commit `26cd29f` redacted the leaked value; the key
  itself must be revoked operator-side).

---

## Stage A — Apply the 3 Phase-13 migrations (under PROTOCOL; RUNNABLE NOW)

Apply to `gylkkzmcmbdftxieyabw` in migration order, advisor baseline + per-migration diff.
Claude can drive each via the Supabase MCP `apply_migration` when you authorize it.

1. `supabase/migrations/20260614194040_gbp_oauth_source.sql` (13-01) — a DO-block resolves
   the auto-named `google_oauth_accounts` source CHECK by its real name → adds `'gbp'`, and adds
   the **nullable `external_parent_id`** column.
2. `supabase/migrations/20260614202719_gbp_insights_source.sql` (13-02a) — drop+recreate the
   `analytics_snapshots` + `analytics_sync_runs` source CHECKs adding `'gbp'` (full prior set).
3. `supabase/migrations/20260615123218_gbp_presence_source.sql` (13-03a) — drop+recreate both
   source CHECKs adding `'gbp_presence'` (full set: semrush, google_ads, ga4, gsc, ga4_dimensions,
   performance, gbp, gbp_presence).

**Auto-named-constraint trap (the 12-05a/b/c path — verify, do not assume):** the
`analytics_sync_runs` source CHECK was declared inline so Postgres auto-named it. Before trusting
the widen, confirm the live name is `analytics_sync_runs_source_check`
(`\d+ public.analytics_sync_runs` / `pg_constraint`). If the live name differs, the IF-EXISTS
drop silently no-ops and the OLD constraint keeps rejecting the new sources. (12-05c proved the
standard name resolved on prod; 13-01's google_oauth_accounts widen uses a DO-block precisely to
resolve its own auto-named CHECK.)

**Expected advisor diff:** ZERO new ERROR/WARN — these are pure CHECK swaps + one nullable
column (mirrors 12-05a/b's 124→124 zero-delta). **ABORT** on any unintended diff.

**PROOF the widens took (then clean the proof rows):**
- Insert one `source='gbp'` AND one `source='gbp_presence'` row into BOTH
  `public.analytics_snapshots` (period='monthly', date=`YYYY-MM-01`) and
  `public.analytics_sync_runs` (status='success'). All four inserts must succeed; a bogus source
  must be REJECTED.
- Delete the four proof rows.

_Verify (Claude can assist):_ advisor diff clean; the `analytics_sync_runs_source_check` name
confirmed; `google_oauth_accounts` admits `'gbp'` + `external_parent_id` is nullable; four proof
inserts accepted + bogus rejected; proof rows cleaned.

---

## Stage B — Secrets (verify; NO new secret; RUNNABLE NOW)

GBP reuses the in-place Phase-11 Google OAuth creds. **Nothing new to set.** Confirm present on
the `psg-hub` Vercel project (Production):
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI`
  (the gbp crons' `googleCredsPresent()` guard reads exactly these), `CRON_SECRET`.

_Verify:_ `vercel env ls` shows the four. No developer-token gate (unlike Google Ads).

---

## Stage C — Deploy the committed crons (RUNNABLE NOW; operator-authorized)

The gbp-sync (`0 7 * * *`) + gbp-presence-sync (`0 4 1 * *`) crons are already in the committed
`vercel.json` (9 crons), but main does not auto-deploy.

1. `vercel --prod` from the repo toplevel `/Users/schoolcraft_mbpro/dev/psg/internal/psg-hub`
   (confirm the repo `.vercel` → `psg-hub` first; **never deploy from the above-repo `../.vercel`**).

_Verify:_ deploy READY; `vercel.json` shows **9 crons** with `gbp-presence-sync` (`0 4 1 * *`)
between `perf-sync` (`0 3 1`) and `monthly-report` (`0 5 1`); the build lists
`ƒ /api/cron/gbp-sync` + `ƒ /api/cron/gbp-presence-sync`. Both crons answer `401` unauth and,
with `Bearer $CRON_SECRET`, `200` with **synced:0** (no shop linked under `business.manage` yet —
the expected partial, NOT a defect).

---

## Stage D — Live activation (ACTIVATION-PENDING on Gate A + Gate B; runs when they clear)

Only attempt once Gate A shows 300 QPM on every called API AND Gate B verification has cleared.

1. **Wallace re-consent under `business.manage`** — the operator runs the GBP link flow
   (`/dashboard/analytics` → Connect Google Business Profile) and consents. This mints a NEW
   refresh token carrying `business.manage` and writes the `source='gbp'` `google_oauth_accounts`
   row (bare `locations/{id}` + parent `accounts/{id}` → `external_parent_id`).
2. **Confirm/backfill `external_parent_id` on the Wallace row** (13-03-RESEARCH open-item 183 /
   13-03b deferral): the v4 reviews aggregate returns `{null,null}` if `external_parent_id` is
   null. The 13-01 select-route callback populates it, so a fresh re-consent should carry it —
   but VERIFY the row has a non-null `external_parent_id`; if it predates parent-capture,
   re-enumerate or backfill. (This silent-null cannot be caught by local tests.)
3. **Live smokes — confirm the build-blind parsers + the 13-03 deferrals** (Claude can drive the
   curl triggers with `$CRON_SECRET`):
   - **Daily insights** — `POST /api/cron/gbp-sync` → a `source='gbp'`, `period='daily'` row for
     Wallace with the 8 enum metrics + derived `impressions_total` (confirms
     `fetchMultiDailyMetricsTimeSeries`: dotted-integer params, doubly-nested response, int64-as-
     string, empty=valid-zero, 404=not-accessible).
   - **Monthly presence** — `POST /api/cron/gbp-presence-sync` → a `source='gbp_presence'`,
     `period='monthly'` row: presence state (confirms `locations.get` readMask + field paths +
     the `metadata.hasVoiceOfMerchant`/empty shapes) merged with the v4 rating aggregate (confirms
     **deferral (a)** `pageSize:1` returns `averageRating`+`totalReviewCount` with `reviews[]`
     length 1, and **deferral (b)** the non-VoM/non-verified shape → `{null,null}`, not a breaker
     trip). Enable the legacy **Google My Business API** + confirm its 300 QPM (**deferral (d)**).
   - **Surfaces** — `/dashboard/analytics` "Local presence" shows REAL non-zero daily KPIs + the
     per-shop presence header (rating + open status); the next monthly report PDF renders the
     "Reviews and listing" block.
4. **The empirical 7-day token pass-gate (the activation condition):** a refresh token minted at
   re-consent must STILL mint an access token **>7 days later**, with no "Google hasn't verified
   this app" hard wall. Until this passes, the pilot is activation-pending (the documented
   Phase-10 unverified-app revoke-at-7-days failure mode).

If a row is `failed` / a parser shape mismatches, capture the JSON and diagnose before declaring
activation (the 12-04 precedent — two prod bugs surfaced at the live smoke).

---

## Stage E — Close

- **If Stage A-C done + Gate A/B not yet cleared (the expected outcome):** close 13-04
  **ACTIVATION-PENDING** — migrations live, crons deployed + 200/synced:0, the Google-gated live
  link + smoke + 7-day pass-gate pending. This is the honest partial, NOT a defect (the Phase-9
  precedent; the surfaces degrade gracefully with no row).
- **If Gate A/B cleared + Stage D passes:** Phase 13 closes **LIVE on real Wallace numbers**.
- Either way, 13-04 is the LAST Phase-13 plan → `/paul:unify 13-04` fires the Phase-13 transition
  (PROJECT.md + ROADMAP.md evolve; Phase 13 → Complete or Complete+activation-pending) → milestone
  v0.3.5 continues to Phase 14 (reviews + sentiment), which SHARES Gate A + the `business.manage`
  re-consent (already paid here).
