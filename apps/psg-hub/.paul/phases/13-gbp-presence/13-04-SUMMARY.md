---
phase: 13-gbp-presence
plan: 04
subsystem: infra
tags: [gbp, supabase-migration, vercel-deploy, cron, activation-pending, protocol-migration-safety, gate-batch]

# Dependency graph
requires:
  - phase: 13-01..13-03b
    provides: the full GBP vertical (OAuth link + daily insights + monthly presence/rating ingest + report + dashboard), built-local + committed to main (916ace1)
  - phase: 11-04
    provides: the shared Google OAuth creds (GOOGLE_OAUTH_CLIENT_ID/SECRET, GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI) + CRON_SECRET, reused as-is (no new secret)
  - phase: 06-01
    provides: PROTOCOL-migration-safety (advisor baseline -> apply ONE -> diff -> ABORT)
provides:
  - the 3 Phase-13 source-CHECK migrations applied to prod gylkkzmcmbdftxieyabw (advisor 124->124 zero-delta)
  - gbp-sync + gbp-presence-sync crons deployed live (9 crons, 401-gated)
  - an honest ACTIVATION-PENDING close (Wallace live-activation gated on the two external Google gates)
affects: [phase-14-reviews-sentiment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prod gate-batch: partial-now (gate-independent migrations + deploy) / pending-close (operator + external-gate tail)"
    - "MCP apply_migration is the established prod DDL path (name=filename, server-assigned version) — supersedes the 06-01 PROTOCOL read-only-MCP text"

key-files:
  created:
    - .paul/phases/13-gbp-presence/13-04-GATE-BATCH.md (Task 1, the operator runbook)
    - .paul/phases/13-gbp-presence/13-04-SUMMARY.md
  modified:
    - "(prod) gylkkzmcmbdftxieyabw — 3 Phase-13 migrations applied"
    - "(prod) psg-hub Vercel — vercel --prod dpl_4MbEWGjcACDN3pi7NaGh4SkJGFVm"

key-decisions:
  - "Mechanism: applied via MCP apply_migration (prod precedent 12-05a/b proven in remote history), not supabase db push — the approved plan + precedent override the older PROTOCOL §2 read-only-MCP text"
  - "Did NOT rotate CRON_SECRET to run the authenticated synced:0 smoke (Vercel-Sensitive/un-pullable; 12-05c precedent) — 401-alive recorded, authenticated smoke deferred"
  - "Closed ACTIVATION-PENDING (the expected 13-RESEARCH outcome): Gate B blocks even the Wallace pilot until business.manage verification clears"

patterns-established:
  - "Proof-insert isolation: valid in every column except source (real FK shop_id), sentinel-tagged, delete + standalone re-read to confirm 0 — never trust a same-statement count after a data-modifying CTE (snapshot artifact)"

# Metrics
duration: ~15min (APPLY prod execution); Stage 0 + D tail is external-gated
started: 2026-06-15T21:50:00Z
completed: 2026-06-16T00:00:00Z
---

# Phase 13 Plan 04: GBP prod activation gate batch — Summary

**The full Phase-13 GBP vertical is activated on prod to the extent the external Google gates allow: the 3 source-CHECK migrations are live (advisor 124->124 clean) and the gbp-sync + gbp-presence-sync crons are deployed (401-gated, synced:0-ready); the Wallace live link + smokes + 7-day token pass-gate are the honest ACTIVATION-PENDING tail behind Gate A (300 QPM) + Gate B (business.manage verification).**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~15 min (APPLY prod execution) |
| Started | 2026-06-15T21:50:00Z |
| Completed | 2026-06-16 |
| Tasks | 2 (T1 auto runbook; T2 checkpoint:human-action — Stage A-C executed, Stage 0+D activation-pending) |
| Prod changes | 3 migrations + 1 deploy |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: runbook authored, ordered, executable | ✅ Pass | `13-04-GATE-BATCH.md` — verified-env table, Stages 0-E, observed-state checkbox gates, activation-pending fallback |
| AC-2: 3 migrations apply under PROTOCOL, clean advisor diff | ✅ Pass | Applied in order via MCP (name=filename); advisor **124->124 (Δ0)** after each; `analytics_sync_runs_source_check` standard name confirmed; 4 proof inserts accepted (gbp + gbp_presence × snapshots + sync_runs) + bogus rejected (`23514`) + cleaned to 0 |
| AC-3: crons deploy LIVE via vercel --prod, no new secret | ✅ Pass (1 deferral) | 4 creds present (no new); `dpl_4MbEWGjcACDN3pi7NaGh4SkJGFVm` READY on hub.psgweb.me; 9 crons (`gbp-presence-sync 0 4 1` between `perf-sync 0 3 1` and `monthly-report 0 5 1`); both gbp crons **401 unauth**. Deferral: authenticated `Bearer $CRON_SECRET -> 200/synced:0` smoke not run (CRON_SECRET un-pullable; not rotated) |
| AC-4: live OR honest activation-pending close | ✅ activation-pending | Gate A/B not cleared -> the expected honest partial; surfaces degrade with no row; lights up with no code change when the gates clear |

## Accomplishments

- 3 Phase-13 source-CHECK migrations applied to shared prod `gylkkzmcmbdftxieyabw` under PROTOCOL with a zero-delta advisor diff at every step (`google_oauth_accounts` += `gbp` + nullable `external_parent_id`; `analytics_snapshots` + `analytics_sync_runs` += `gbp`, `gbp_presence`); registered in remote history as `version 20260615215413/439/459`.
- The committed gbp crons deployed live (`vercel --prod` from the repo toplevel, guarded against the above-repo `../.vercel` hazard) — 9 crons, both `gbp-sync` + `gbp-presence-sync` 401-gated and route-live.
- Functional proof of the widens on prod: 4 valid `gbp`/`gbp_presence` inserts accepted, a bogus source rejected by `analytics_snapshots_source_check`, proof rows cleaned to 0 (standalone re-read verified).
- Honest ACTIVATION-PENDING close recorded — no blind activation claim; the live smokes + 7-day token pass-gate wait for the two external Google gates.

## Task Commits

No application-code commit — this plan ACTIVATES already-shipped code (`916ace1` / `14e27cc`, on main). The prod changes (3 migrations, 1 deploy) are not version-controlled artifacts. The Phase-13 transition commit carries the `.paul` docs (PLAN, GATE-BATCH, SUMMARY, STATE, PROJECT, ROADMAP, paul.json).

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Task 1: author runbook | (in transition commit) | docs | `13-04-GATE-BATCH.md` |
| Task 2: Stage A-C on prod | n/a (prod state) | infra | 3 migrations + `vercel --prod` |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `.paul/phases/13-gbp-presence/13-04-GATE-BATCH.md` | Created (Task 1) | the ordered operator runbook (Stages 0-E) |
| `.paul/phases/13-gbp-presence/13-04-SUMMARY.md` | Created | this summary |
| prod `gylkkzmcmbdftxieyabw` | Modified | 3 source-CHECK migrations applied (advisor clean) |
| prod `psg-hub` Vercel | Modified | `vercel --prod` -> `dpl_4MbEWGjcACDN3pi7NaGh4SkJGFVm` (hub.psgweb.me) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Apply via MCP `apply_migration`, not `supabase db push` | Remote history proves the prod precedent (12-05a/b: `version 20260612155343/52` ← `name 20260611000000_ga4_dimensions_source`/`20260612000000_performance_source` — server-assigned version, name=filename); 13-04 AC-2 mandates MCP; the approved plan + precedent supersede the older 06-01 PROTOCOL §2 read-only-MCP text | Future Phase-13/14 prod DDL uses the same path; remote `db diff`/`db pull` stays consistent (name=filename) |
| Do NOT rotate `CRON_SECRET` to run the authenticated smoke | `CRON_SECRET` is Vercel-Sensitive/un-pullable + absent from local `.env`/`~/.psg-*`; rotation + redeploy has real blast radius (operator declined exactly this at 12-05c) | 401-alive recorded; the authenticated `synced:0` smoke runs at first real cron / once a shop links under `business.manage` |
| Close ACTIVATION-PENDING | Gate B (`business.manage` verification) blocks even the Wallace pilot — the app is In-Production (no Testing escape) | Phase 13 ships build-complete + prod-migrated + crons-live; live activation is the external-gated tail (shared with Phase 14) |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 0 | — |
| Deferred | 2 | Activation-pending tail + the authenticated smoke |

**Total impact:** No scope creep. The plan anticipated the activation-pending close; both deferrals are the expected external-gate tail, not defects.

### Deferred Items

- **Authenticated `200/synced:0` cron smoke** — `CRON_SECRET` un-pullable; not rotated (12-05c precedent). Runs at the first real cron or once a shop links under `business.manage`.
- **Stage 0 (operator-only) + Stage D (activation-pending)** — Gate A (GBP API 0->300 QPM + per-API trap incl. legacy GMB v4), Gate B (`business.manage` sensitive-vs-restricted verification), chat-key revoke (`26cd29f`), then Wallace re-consent + `external_parent_id` confirm/backfill + the live smokes (13-03 deferrals a-d) + the empirical 7-day token pass-gate. Lights up with no further code change once Gate A + Gate B clear.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `get_advisors(security)` overflows the tool result (80k chars) | Parsed the saved overflow file via python into a level/name fingerprint; re-parsed the FRESH file after each migration (never the stale baseline) |
| Post-cleanup count showed 2/2 "remaining" gbp rows | Postgres snapshot artifact — a data-modifying CTE and the same-statement SELECT both read the pre-statement snapshot; a standalone re-read confirmed 0/0 |

## Next Phase Readiness

**Ready:**
- Phase 14 (reviews + sentiment) inherits Gate A + the `business.manage` re-consent paid (queued) here — no second OAuth-verification cost.
- The prod data model already admits `gbp` + `gbp_presence`; the crons are deployed and gated.

**Concerns:**
- Wallace live numbers are unverified until Gate A + Gate B clear; the build-blind GBP parsers (`fetchMultiDailyMetricsTimeSeries`, `locations.get`, v4 reviews aggregate) get their first live run at Stage D — diagnose any `failed` row before declaring LIVE (the 12-04 precedent).
- `external_parent_id` silent-null risk on the Wallace row (v4 aggregate returns `{null,null}` if null) — confirm/backfill at re-consent.

**Blockers:**
- None for the next phase plan. Stage D is externally gated, not a code blocker.

---
*Phase: 13-gbp-presence, Plan: 04*
*Completed: 2026-06-16*
