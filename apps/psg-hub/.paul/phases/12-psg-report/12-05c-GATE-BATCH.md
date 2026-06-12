# Phase 12 / 12-05c — Combined Operator Gate Batch (GA4-dims + performance expansion)

One ordered runbook to activate the GA4 dimensional + website-performance expansion on
prod. Everything build-local is done (tsc 0 · eslint 0 · vitest 584; ZERO prod contact
to here). The base report (12-01..12-04) is ALREADY LIVE — this layers the new sections
onto the same infra (no new worker). Same build-local → operator-gate pattern as Phases
9, 10, 11 and 12-04.

**Closes Phase 12 + milestone v0.3.** The final `feature/12-psg-report` → main merge
(deferred from 12-04 Stage G) lands here.

---

## Stage 0 — Lead-time secrets (do FIRST)

These have provisioning lead time; start them before the migration so Stage C is not blocked.

| Secret | What | Notes |
|--------|------|-------|
| `PAGESPEED_API_KEY` | A Google Cloud API key with the **PageSpeed Insights API** enabled | HARD prereq for the ENTIRE perf section. Keyless PSI quota = 0 → perf-sync 503s and the perf block omits. Treat like the 10-03 dev-token. Create in the same Google Cloud project as the Phase-11 OAuth client; enable the PSI API; restrict the key to the PSI API. |
| `GTMETRIX_API_KEY` | The operator's GTMetrix account API key | HTTP Basic `key:` (blank password). GTMetrix is async (POST→poll→`/reports/{id}`) with a per-day credit cap (Micro 10 / Growth 100 / Team 300 / Enterprise 500). |
| `GTMETRIX_SHOP_IDS` | Comma-separated shop id(s) GTMetrix runs for — the **Wallace pilot shop id** | Pilot scope. In-loop GTMetrix poll is ~80s/shop; unscoped fleet would blow the 300s Fluid ceiling + credit cap. Unset → the route falls back to a safe limit of 1. |

`CRON_SECRET`, the Google OAuth creds (`GOOGLE_OAUTH_CLIENT_ID/SECRET`,
`GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI`), and `NEXT_PUBLIC_APP_URL` already exist on prod
(Phases 9/11). The GA4 dimensional ingest needs NO new secret — it reuses the in-place
Phase-11 OAuth.

---

## Stage A — Apply both migrations (under PROTOCOL-migration-safety.md)

Apply to `gylkkzmcmbdftxieyabw`, advisor baseline + diff:

1. `supabase/migrations/20260611000000_ga4_dimensions_source.sql` (12-05a)
2. `supabase/migrations/20260612000000_performance_source.sql` (12-05b)

0612 recreates BOTH source CHECKs with the FULL 6-value set
(`semrush, google_ads, ga4, gsc, ga4_dimensions, performance`), so the end state admits
all six regardless of apply order; apply in migration order.

**VERIFY the auto-named constraint (both files flag this):** before trusting the widen,
confirm `analytics_sync_runs` has a CHECK named `analytics_sync_runs_source_check`
(`\d+ public.analytics_sync_runs` or query `pg_constraint`). 20260605 declared it as an
INLINE column CHECK so Postgres auto-named it — if the live name differs, the IF-EXISTS
drop silently no-ops and the OLD four-value constraint keeps rejecting the new sources.

**PROOF the widens took (do this, then clean the proof rows):**
- Insert one `source='ga4_dimensions'` AND one `source='performance'` row into BOTH
  `public.analytics_snapshots` (period='monthly', date=`YYYY-MM-01`) and
  `public.analytics_sync_runs` (status='success'). All four inserts must succeed.
- Delete the four proof rows.

_Verify (Claude can assist):_ advisor diff clean (only the two CHECK swaps, no new
ERROR/WARN); the constraint name confirmed; four proof inserts accepted.

---

## Stage B — Set secrets + deploy

1. Set `PAGESPEED_API_KEY`, `GTMETRIX_API_KEY`, `GTMETRIX_SHOP_IDS` on the `psg-hub`
   Vercel project (Production). Mirror into local `.env` for any manual trigger.
2. `vercel --prod` from the repo root (the established deploy path; git-on-main OFF).

_Verify:_ `vercel env ls` shows the three; `vercel.json` shows **7 crons** with
`ga4-dims-sync` (`0 2 1 * *`) and `perf-sync` (`0 3 1 * *`) BEFORE `monthly-report`
(now `0 5 1 * *`); the deploy lists `ƒ /api/cron/ga4-dims-sync` + `ƒ /api/cron/perf-sync`.

---

## Stage C — Live smoke (confirm the build-blind parsers, then a real PDF)

The fetch parsers were written from RESEARCH and never run against a live response
(12-05a/b carry-forward). Trigger each cron manually for the pilot (Wallace); the crons
inject the prior month, so pick a smoke month with data or pass it directly if testing
the current month.

1. **GA4 dimensional** —
   ```
   curl -X POST https://hub.psgweb.me/api/cron/ga4-dims-sync \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   Confirm a `period='monthly'`, `source='ga4_dimensions'` row for Wallace at
   `{month}-01`, with `topChannels` / `topLandingPages` / `devices` / `newVsReturning`
   populated and a non-zero TOTAL-reconciled `(other)` (the `metricAggregations`
   `totals[0]` parse — never run live) + `averageSessionDuration`.

2. **Performance** —
   ```
   curl -X POST https://hub.psgweb.me/api/cron/perf-sync \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   Confirm a `period='monthly'`, `source='performance'` row for Wallace: PSI lab present
   (score, LCP/CLS), CrUX field present-or-null (collision-shop origins are often
   field-absent — null is a successful empty), GTMetrix present (Wallace in
   `GTMETRIX_SHOP_IDS`) — confirms `loadingExperience` + `/reports/{id}` parsers.

3. **Report end-to-end** — trigger the monthly report (idempotent) for the smoke month:
   ```
   curl -X POST https://hub.psgweb.me/api/cron/monthly-report \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   Confirm the REAL PDF now renders the four GA4 dimensional sections (Top Traffic
   Drivers / Top Landing Pages / Device Breakdown / New vs Returning, + bounce rate +
   avg session duration) AND the "Website performance" block — and that the old GA4
   "Performance Status / server response 14:49" artifact is GONE. The membership-gated
   download still returns 200 for the owner, 401/403 for a non-member.

If a row is `held` / `failed` or a parser shape mismatches, capture the JSON and
diagnose before declaring activation (the 12-04 precedent — two prod bugs surfaced at
the live smoke).

---

## Stage D — Milestone close

1. Merge `feature/12-psg-report` → main (the deferred 12-04 Stage G).
2. Rotate the chat-pasted secrets (12-04 carry: Hetzner `RENDER_TOKEN` / `AI_GATEWAY_API_KEY`
   / SendGrid + now `PAGESPEED_API_KEY` / `GTMETRIX_API_KEY` if pasted in chat).
3. This closes Phase 12 + milestone v0.3 → `/paul:complete-milestone`.

---

## Activation-pending fallback (honest close)

If a Stage-0 blocker hits (Google Cloud key provisioning, GTMetrix access), close 12-05c
**code-complete with activation-pending recorded honestly** (the Phase-9 precedent). The
base report is already live (12-04) and the expansion degrades gracefully:
- No `PAGESPEED_API_KEY` → perf-sync 503s, the "Website performance" block omits.
- No ga4-dims-sync run → no dimensional row, the four GA4 sections omit.

The report still ships with the live base, and the milestone still closes; the expansion
sections light up when the blocker clears (no code change — just the cron + secret).
