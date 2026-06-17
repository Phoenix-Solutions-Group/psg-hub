# Phase 14 / 14-04 — Operator Gate Batch (reviews + sentiment prod activation)

One ordered runbook to activate the Phase-14 reviews + sentiment vertical on prod: 14-01
per-review v4 ingest · 14-02 reply-publish plumbing (build-only; live publish stays gated) ·
14-03 LLM sentiment. Everything is build-local + LOCALLY gate-verified and **already committed to
`main`** (`e86b28c`) — but nothing is migrated to prod, nothing is deployed (main does NOT
auto-deploy: `vercel.json` `git.deploymentEnabled.main=false`), and no shop is linked under
`business.manage`.

**This is a DELTA over `13-04-GATE-BATCH.md`.** The shared deploy environment, the migration
PROTOCOL, the above-repo `../.vercel` hazard, and the Gate A/B mechanics are IDENTICAL — see
13-04 §"Verified deploy environment" + §Stage 0. This doc spells out ONLY what is new for Phase 14.

**Operator routing = "partial now, pending close"** (the 13-04 / Phases 9-12 pattern): apply the 3
Phase-14 migrations under PROTOCOL + `vercel --prod` (the gate-INDEPENDENT prod work) NOW so the
committed `gbp-reviews-sync` cron goes live (200/synced:0), then close 14-04 **ACTIVATION-PENDING**
on the shared Gate A/B + the live LIST/sentiment smokes. **Closes Phase 14** (last plan).

**Authority:** `14-RESEARCH.md` (v4 `reviews.list` READ + `updateReply` WRITE contracts, the
policy/consent gap, the LLM-sentiment design) + `13-RESEARCH.md` (Gate A/B + the empirical 7-day
token pass-gate). No new external API surface — live execution of already-researched + already-built
contracts.

---

## What 14-04 adds beyond 13-04's already-live prod state

13-04 already put on prod: the 3 Phase-13 source-CHECK migrations + the `gbp-sync` (`0 7`) +
`gbp-presence-sync` (`0 4 1`) crons (9 crons, 401-live). 14-04 adds, on top of that:

| Delta | Detail |
|-------|--------|
| 3 NEW migrations | review_items widen+UNIQUE · review_responses publish-state · review_sentiment table+RLS |
| 1 NEW cron deployed | `gbp-reviews-sync` (`0 8`) → **10 crons**; the `gbp-reviews-reply` cron stays OUT (legal-gated) |
| 2 live smoke axes | v4 reviews LIST (Google-gated) + gateway-Haiku sentiment (**NOT** Google-gated) |
| Secrets | **NONE new** (reuses the Phase-11 Google creds + `AI_GATEWAY_API_KEY` from 12-04) |

---

## Stage 0 — Gate status RE-CHECK (the partial-vs-full pivot; START FIRST)

Same two gates as 13-04 Stage 0 — 13-04 filed/kicked them ~1 day ago. **Re-check current status;
if both have cleared, 14-04 closes LIVE, not activation-pending.** These do NOT block Stage A-C.

### Gate A — Business Profile API access (quota 0 → 300 QPM)
- Re-check the GCP Quotas page for the OAuth client's project (the 13-04 check).
- **Phase-14-specific (the one new thing):** per-review `reviews.list` hits the **legacy Google
  My Business API** line specifically, and per-review pagination is more QPM-hungry than 13-03's
  `pageSize:1` aggregate. Confirm THAT line is **enabled** (Cloud Console) AND at **300 QPM** — not
  just the four newer GBP API lines 13-04 checked. (14-01 deferred item #4.) A per-API line can lag
  at 0 and 429 while the others work.

### Gate B — `business.manage` verification
- Shared with Phase 13's re-consent; **no Phase-14 delta.** Confirm cleared (sensitive-vs-restricted
  per 13-04 Stage 0).

(No chat-key revoke for Phase 14 — 13-04 owned it.)

---

## Stage A — Apply the 3 Phase-14 migrations (under PROTOCOL; RUNNABLE NOW)

Apply to `gylkkzmcmbdftxieyabw` in migration order, advisor baseline + per-migration diff
(06-01 PROTOCOL; MCP `apply_migration` per the 13-04 / 12-05 precedent, NOT `db push`). All 3 are
committed + tracked (`e86b28c`), unapplied. Claude drives each via the Supabase MCP when authorized.

1. `supabase/migrations/20260616163539_review_items_gbp_reviews.sql` (14-01) — `review_items` +=
   `external_review_id` + `updated_at` + `UNIQUE(shop_id, external_review_id)`; the
   **`analytics_sync_runs`** source CHECK += `'gbp_reviews'`.
   **Auto-named-CHECK trap (the 13-04 / 12-05 path — verify, do not assume):** the widen drops the
   CHECK by its LIVE `pg_constraint` name (resolved to `analytics_sync_runs_source_check` on prod at
   12-05c + 13-04). Confirm the live name first; a mismatch silently no-ops the IF-EXISTS drop and
   the old CHECK keeps rejecting `'gbp_reviews'`. NOTE: widens `analytics_sync_runs` ONLY — NOT
   `analytics_snapshots` (reviews land in `review_items`, no snapshot row is written).
2. `supabase/migrations/20260616231817_review_responses_publish_state.sql` (14-02) —
   `review_responses` += `publish_status` (named CHECK `pending|publishing|published|publish_failed`,
   default `pending`) + `publish_error` + `publish_attempts` + `published_version` +
   `external_reply_updated_at`. Additive/idempotent; NO `analytics_sync_runs` widen.
3. `supabase/migrations/20260617120000_review_sentiment.sql` (14-03) — NEW `review_sentiment` table
   (14 cols, `UNIQUE(review_item_id)`, polarity CHECK, denormalized `shop_id`, `classified_updated_at`)
   + RLS enabled + 4 `shop_id IN user_shop_ids()` policies (mirror `review_items`).

**Expected advisor diff:** migrations 1+2 are a pure CHECK swap + additive columns → ZERO new
ERROR/WARN. Migration 3 stands up a NEW RLS table **with its 4 policies in the same migration** →
expect NO `rls_enabled_no_policy` INFO (policies + ENABLE ship together; contrast the 11-01
`pending_states` +1 INFO). Note: a brand-new RLS table whose policies call `user_shop_ids()` MAY
surface an INFO-level perf lint (e.g. `auth_rls_initplan`) — but `review_sentiment`'s policies MIRROR
the live `review_items` policies, so the bar is **"matches `review_items`' advisor footprint, no new
ERROR/WARN,"** NOT literally 124→124. Pre-check against `review_items` to avoid a false ABORT on a
baselined INFO. **ABORT** on any unintended ERROR/WARN.

**PROOF the migrations took — insert-proof only where there is no FK blocker; STRUCTURAL elsewhere:**
- `analytics_sync_runs` (no FK blocker — the 13-04 pattern): insert `source='gbp_reviews'` (accepted)
  + a bogus source (rejected `23514`), then DELETE the proof rows.
- `review_items` / `review_responses` / `review_sentiment` are **STRUCTURAL proof, NOT insert-proof.**
  A bare insert is FK-blocked on prod: at synced:0 there are ZERO `review_items` parent rows, so an
  insert into `review_responses`/`review_sentiment` throws a **23503 FK violation**, not the 23514
  CHECK you want — and the local FK-disable-in-rolled-back-txn trick (14-02/14-03 summaries) does NOT
  translate to shared prod (privilege + blast radius). The accept/reject CHECK behavior was already
  proven LOCALLY (14-01/14-02/14-03); on prod you confirm the DDL **landed** via `\d` + `pg_constraint`:
  - `review_items`: `external_review_id` + `updated_at` columns + the `UNIQUE(shop_id, external_review_id)` constraint.
  - `review_responses`: the 5 publish-lifecycle columns + the named `publish_status` CHECK definition (`pending|publishing|published|publish_failed`).
  - `review_sentiment`: the table + the `polarity` CHECK definition + `UNIQUE(review_item_id)` + RLS enabled + the 4 `shop_id`-clamped policies (compare the definitions against the live `review_items` policies).

_Verify:_ advisor diff per the expectation above (incl. the `review_items`-footprint match for
migration 3); the auto-named `analytics_sync_runs_source_check` name confirmed; the
`analytics_sync_runs` insert-proof accepted/bogus-rejected/cleaned; the three FK-child tables
structurally confirmed via `\d` + `pg_constraint`.

---

## Stage B — Secrets (verify; NO new secret; RUNNABLE NOW)

Confirm present on the `psg-hub` Vercel project (Production); **nothing new to set:**
- The 4 Phase-11 Google creds (reviews ingest reuses these exactly as 13-04):
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI`,
  `CRON_SECRET`.
- `AI_GATEWAY_API_KEY` — set at 12-04 (the monthly-report narrative uses it); the Haiku sentiment
  classifier (`anthropic/claude-haiku-4.5`) rides the SAME gateway. No Phase-14 delta — confirm still present.

_Verify:_ `vercel env ls` shows the five. No developer token (unlike Google Ads).

---

## Stage C — Deploy the committed reviews cron (RUNNABLE NOW; operator-authorized)

`gbp-reviews-sync` (`0 8 * * *`) is the 10th cron in the committed `vercel.json`; main does not
auto-deploy.

1. `vercel --prod` from the repo toplevel `/Users/schoolcraft_mbpro/dev/psg/internal/psg-hub`
   (confirm the repo `.vercel` → `psg-hub` first; **NEVER** the above-repo `../.vercel` HAZARD — see 13-04).

_Verify:_ deploy READY; `vercel.json` shows **10 crons** with `gbp-reviews-sync` (`0 8`) after
`gbp-sync` (`0 7`); the build lists `ƒ /api/cron/gbp-reviews-sync`; the `gbp-reviews-reply` cron is
**ABSENT** (correct — legal-gated; do NOT add it). The cron answers `401` unauth and, with
`Bearer $CRON_SECRET`, `200` with `synced:0` + the merged `sentiment` field at `classified:0` (no
`business.manage`-linked shop yet — the expected partial). **A green cron proves NOTHING about
classification** — `classifyPendingSentiment` is contained-on-failure (14-03 AC-4: a classify throw
returns `{error}` while ingest still returns 200), so the real assertion is Stage D2 (rows, not 200).

---

## Stage D — Live activation (two INDEPENDENT axes; each runs when its own gate clears)

### D1 — v4 reviews LIST smoke (Google-gated: Gate A legacy-GMB-API + Gate B + Wallace re-consent)
Only once Gate A shows 300 QPM on the **legacy GMB API line** AND Gate B cleared AND Wallace is
re-consented under `business.manage` (13-04 Stage D — paid once for both phases; if 13-04 closed
pending, the re-consent happens now). Then (Claude can drive the `$CRON_SECRET` curl trigger):
- Trigger `POST /api/cron/gbp-reviews-sync` (or `POST /api/reviews/ingest` for the single shop) →
  confirm REAL `review_items` rows for Wallace (`inserted>0`), NOT cron-200.
- Confirm the 14-01 deferred LIST checklist: StarRating live word-enum values (`ONE`..`FIVE`); the
  non-verified-location LIST shape (the AC-2 DRIFT resolver — 200-empty→skipped vs 401/403→flip); an
  idempotent re-run nets ZERO new rows (the real `onConflict` dedup; mocked locally, constraint proven
  via `\d`); 300 QPM headroom on the legacy GMB line; the token authorizes the READ.

### D2 — gateway-Haiku sentiment smoke (NOT Google-gated — de-risk EARLY against a seeded row)
The classifier is an AI Gateway call; it does NOT need Gate A/B. The ONLY Google-gated input is
getting real `review_items` rows (D1). So de-risk the build-blind LLM parser INDEPENDENTLY:
- **Cleanest (ZERO prod write) — preferred:** a one-off LOCAL invocation of `classifyReviewSentiment`
  against the REAL gateway with `AI_GATEWAY_API_KEY` set → proves the live parser (the
  `anthropic/claude-haiku-4.5` slug resolves through the gateway + `Output.object` validates a real
  Haiku response against the zod schema) with NO prod seed, keeping the build-local rhythm.
- **Or on prod:** with ≥1 `review_items` row carrying text (from D1), run the classify path (the
  `gbp-reviews-sync` cron runs `classifyPendingSentiment` after ingest; or trigger it directly) →
  **assert a `review_sentiment` ROW exists with a VALID `polarity`** (`positive|neutral|negative`) +
  `confidence ∈ [0,1]` + the `themes`/`actionable_complaint` shape. **Assert rows, NOT cron 200**
  (see Stage C — classify is contained-on-failure).
- Confirm `anthropic/claude-haiku-4.5` resolves through the gateway and `Output.object` validates the
  real Haiku response against the zod schema. Inspect the cron response's `sentiment` field
  (`{classified, failed, skipped}`).

### D3 — the empirical 7-day token pass-gate
Shared with 13-04; the Phase-13 re-consent's token is the one under test. Not re-paid in 14-04.

If a row is `failed` / a parser shape mismatches, capture the JSON and diagnose before declaring
activation (the 12-04 / 13-04 precedent — two prod bugs surfaced at the live smoke).

---

## Stage E — Close

- **If Stage A-C done + Gate A/B not yet cleared (the expected outcome per 13-RESEARCH):** close
  14-04 **ACTIVATION-PENDING** — the 3 migrations live + the reviews cron deployed (200/synced:0), the
  Google-gated LIST smoke (D1) + the 7-day pass-gate (D3) pending. Honest partial; the surfaces hold
  no rows but degrade gracefully (the Phase-9/13 precedent).
  - **RECOMMENDED even in the pending case:** run D2 (the sentiment axis is NOT Google-gated) —
    preferably the one-off LOCAL `classifyReviewSentiment` invocation against the real gateway (ZERO
    prod write) — so the LLM half is verified and the build-blind Haiku parser is de-risked
    independently of Google.
- **If Gate A/B cleared + D1+D2 pass:** Phase 14 closes **LIVE on real Wallace reviews + sentiment**.
- Either way, 14-04 is the LAST Phase-14 plan → `/paul:unify 14-04` fires the Phase-14 transition →
  milestone v0.3.5 ready for `/paul:complete-milestone` (after the 14-03b / 14-02b sequencing decision below).

---

## OUT of scope — named follow-ups (NOT this gate batch)

- **14-02b — reply-publish LIVE activation:** the per-shop end-client authorization record + per-reply
  consent schema + approve-gate handling + the UI publish button + add `/api/cron/gbp-reviews-reply`
  to `vercel.json` + the v4 WRITE live-smokes. Gated on **EXPLICIT LEGAL SIGN-OFF** (STATE Decisions
  2026-06-16). The WRITE smokes do NOT run in 14-04.
- **14-03b — sentiment surface:** the report block + dashboard panel + the low-confidence human-review
  queue UI + a CI golden-set regression gate. Build-local + ungated; sequence before or after
  `/paul:complete-milestone` (operator's call).
