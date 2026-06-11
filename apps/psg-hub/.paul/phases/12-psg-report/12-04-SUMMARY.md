---
phase: 12-psg-report
plan: 04
subsystem: infra
tags: [cron, sendgrid, supabase-storage, puppeteer, vercel, ai-gateway, report]

requires:
  - phase: 12-01
    provides: assembleReportData (ReportData from daily snapshots)
  - phase: 12-02
    provides: generateNarrative + eval gate (verified narrative or hold)
  - phase: 12-03
    provides: render-client, storage, email builder, print + download routes, Hetzner worker
provides:
  - runMonthlyReports orchestrator (generate -> store -> render -> store -> record -> email, idempotent, fault-contained)
  - CRON_SECRET-gated /api/cron/monthly-report route + vercel.json monthly entry (5 crons)
  - LIVE prod activation of the full report pipeline, verified end-to-end on a demo shop
affects: [12-05]

tech-stack:
  added: []   # app runtime deps unchanged; puppeteer stays only in workers/report-renderer
  patterns: [per-shop-fault-contained monthly orchestration, build-local -> operator-gate activation]

key-files:
  created:
    - src/lib/report/monthly.ts
    - src/app/api/cron/monthly-report/route.ts
    - src/lib/report/__tests__/monthly.test.ts
    - src/lib/report/__tests__/monthly-route.test.ts
    - .paul/phases/12-psg-report/12-04-GATE-BATCH.md
    - src/lib/report/__tests__/evaluate-grounding-regression.test.ts
  modified:
    - vercel.json
    - src/lib/report/evaluate.ts
    - src/lib/mail/types.ts
    - src/lib/mail/sendgrid.ts
    - src/lib/report/email.ts

key-decisions:
  - "Prove activation end-to-end on the Demo shop (seeded synthetic May data) instead of recording activation-pending, since no real shop had a complete prior month; clean the synthetic data after."
  - "Align Vercel RENDER_TOKEN to the running worker's value (no worker restart) rather than re-tokening the worker."
  - "Disable SendGrid click tracking on the report email IN CODE (durable, no dashboard dependency) rather than toggling account-wide secure link branding."

patterns-established:
  - "Resolve a placeholder key's source by longest-first match against the canonical source list (never split('_')[0] — google_ads is two-token)."
  - "Transactional, membership-gated email links set clickTracking:false so they are not rewritten through the link-branding host."

duration: ~2 sessions (build-local + operator gate batch + live activation)
started: 2026-06-11T00:00:00Z
completed: 2026-06-11T19:15:00Z
---

# Phase 12 Plan 04: Monthly report orchestration + live prod activation Summary

**The automated PSG monthly report now runs end-to-end on prod: a CRON_SECRET-gated monthly cron drives a pure, idempotent, fault-contained orchestrator that generates the eval-passed narrative, renders the branded PDF on the Hetzner worker, stores it privately, records it, and emails the membership-gated download link — verified end-to-end on a demo shop (real PDF + row + delivered email + working gated link), with real-shop activation auto-firing July 1.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~2 sessions (build-local prior; gate batch + live activation 2026-06-11) |
| Completed | 2026-06-11 |
| Tasks | 3 (2 auto + 1 operator gate batch) |
| Files created/modified | 6 created, 5 modified |
| Gates | tsc 0 · eslint 0 · vitest 533 passed (69 files) · vercel.json 5 crons |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Pure idempotent monthly orchestrator runs the full verified pipeline per shop | Pass | `monthly.ts` — deps-injected; never emails a hold; narrative persisted before render; per-shop failure contained; idempotent via `alreadySent`/`emailed_at`. Unit-tested with mocks. |
| AC-2: CRON_SECRET-gated monthly cron route wires real bindings + scheduled | Pass | `route.ts` timingSafeEqual 401-before-work + 503 not-configured guard; `vercel.json` 5 crons (monthly appended, 4 daily untouched). Live: 401 unauth confirmed on prod. |
| AC-3: Operator gate batch authored + executed live to a real delivered report | Pass (with deviation) | Stages A-E done prior session; Stage F live smoke COMPLETED this session — but on the **Demo shop** (seeded synthetic May), not pilot Wallace, because no real shop had a complete prior (May) month. Loop closed on a REAL delivered report (PDF 253 KB + `monthly_reports` row w/ `emailed_at` + delivered email + gated download, operator-confirmed link opens). Stage G (merge→main) DEFERRED to 12-05 close per plan. |
| AC-4: Typed, green, scoped | Pass (with deviation) | tsc 0 · eslint 0 · vitest 533. App adds NO runtime dep. **Deviation:** locked 12-02/12-03 modules were edited to fix two activation-blocking prod bugs (see Deviations). |

## Verification Results

```
vitest run         -> Test Files 69 passed (69) | Tests 533 passed (533)
tsc --noEmit       -> 0
eslint report+mail -> 0
vercel.json crons  -> 5
prod live smoke    -> POST /api/cron/monthly-report (demo eligible) => {"sent":1,...}
artifacts          -> monthly-reports/{demo}/2026-05.pdf (258,890 B) + .json;
                      monthly_reports row storage_path + emailed_at set;
                      GET /api/reports/{demo}/2026-05/download (unauth) => 401
ingest health      -> POST /api/cron/ga4-sync => {"synced":3,"failed":0}
```

## Accomplishments

- Wired 12-01/12-02/12-03 into one pure, idempotent, fault-contained monthly orchestrator + a CRON_SECRET-gated cron (5th cron entry), build-local with zero prod contact.
- Activated the whole pipeline on prod (migration, private bucket, Hetzner Chromium worker, secrets) and proved it end-to-end on the Demo shop: real branded PDF, stored privately, recorded, emailed, and downloaded through the membership gate — operator-confirmed.
- Found and fixed two production-blocking bugs the live smoke surfaced (eval-gate mis-grounding that held EVERY report; SendGrid click-tracking cert that broke the email link), both with regression tests.
- Confirmed daily ingest is healthy, so the real-shop first run auto-fires July 1; scheduled a cloud verification agent for that date.

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| Task 1+2: orchestrator + cron route + vercel.json | `a53c843` | wip | monthly.ts + route + tests (build-local, prior session) |
| Deviation fix 1 | `abe1b95` | fix | eval gate google_ads F3 mis-ground (held all reports) |
| Deviation fix 2 | `59e89cb` | fix | disable SendGrid click tracking on report email |
| Loop close | `0a22fd1` | docs | STATE.md 12-04 loop-close |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/report/monthly.ts` | Created | Pure deps-injected `runMonthlyReports` orchestrator |
| `src/app/api/cron/monthly-report/route.ts` | Created | CRON_SECRET-gated monthly cron wiring real bindings + 503 guard |
| `src/lib/report/__tests__/monthly.test.ts` | Created | Orchestrator unit tests (ordering, idempotency, hold, containment) |
| `src/lib/report/__tests__/monthly-route.test.ts` | Created | Cron route auth (401/200) test |
| `.paul/phases/12-psg-report/12-04-GATE-BATCH.md` | Created | Operator prod-activation runbook (Stages A–G) |
| `src/lib/report/__tests__/evaluate-grounding-regression.test.ts` | Created | Regression: template passes eval for a google_ads report |
| `vercel.json` | Modified | Append monthly cron `0 0 1 * *` (5 total; daily untouched) |
| `src/lib/report/evaluate.ts` | Modified | Fix `buildAllowedNumbers` source resolution (deviation) |
| `src/lib/mail/types.ts` | Modified | Add optional `clickTracking` to MailMessage (deviation) |
| `src/lib/mail/sendgrid.ts` | Modified | Map `clickTracking:false` to trackingSettings (deviation) |
| `src/lib/report/email.ts` | Modified | Set `clickTracking:false` on report email (deviation) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Prove activation on the Demo shop with seeded May data, then clean it | No real shop had a complete prior month (snapshots began ~Jun 2); recording bare activation-pending would not have exercised the full pipeline or surfaced the two bugs | Pipeline proven end-to-end before any client sees it; real-shop run is July 1 |
| Align Vercel `RENDER_TOKEN` to the worker's existing value | Avoids restarting the running Hetzner worker; both hops match | Zero render downtime |
| Disable click tracking in code, not via SendGrid dashboard | Durable, scoped to the report email, no account-wide dependency | Report link stays the raw hub.psgweb.me URL with a valid cert |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed (prod bugs, locked modules) | 2 | Essential — both BLOCKED activation; fixed + regression-tested |
| Config corrections | 1 | RENDER_TOKEN mismatch aligned |
| Scope / sequencing | 2 | Smoke on demo (not Wallace); Stage G merge deferred to 12-05 |

**Total impact:** Activation-critical fixes only; no scope creep. The locked-module edits were forced by genuine bugs the live smoke exposed and are surfaced here per the plan's "surface as a deviation" boundary clause.

### Auto-fixed Issues

**1. [eval gate] `evaluate.ts` mis-grounded Google Ads numbers → held EVERY report**
- **Found during:** Task 3 Stage F (first live smoke returned `held:1`).
- **Issue:** `buildAllowedNumbers` derived a metric's source via `key.split("_")[0]`, yielding `"google"` for the two-token `google_ads` source. Google Ads numerals were filed under `"google"` while the per-source check looked up `"google_ads"` (empty set) → every Google Ads numeral flagged F3 cross-source → eval block → hold. Since all shops carry Google Ads, no real report could ever pass.
- **Fix:** Resolve the source by longest-first match against the canonical source names (`google_ads` before single-token names).
- **Files:** `src/lib/report/evaluate.ts` + `evaluate-grounding-regression.test.ts`.
- **Verification:** Reproduced offline (template blocked with 12× F3), fixed, regression test green; re-run cron → `sent:1`.
- **Commit:** `abe1b95`.

**2. [email] SendGrid click-tracking cert broke the report link**
- **Found during:** Task 3 Stage F (operator clicked the delivered email link).
- **Issue:** SendGrid rewrote the link through its link-branding host `url7193.psgweb.me` (CNAME → sendgrid.net), which serves a `*.sendgrid.net` cert that does not match the branded host → `NET::ERR_CERT_COMMON_NAME_INVALID`.
- **Fix:** Add a per-message `clickTracking` flag to the mail adapter and set it `false` on the report email, so the link stays the raw `hub.psgweb.me` download URL with a valid cert.
- **Files:** `src/lib/mail/types.ts`, `src/lib/mail/sendgrid.ts`, `src/lib/report/email.ts` + `email.test.ts`.
- **Verification:** Re-sent the demo report; operator confirmed the link now resolves.
- **Commit:** `59e89cb`.

### Config corrections

- **RENDER_TOKEN mismatch:** Vercel held a different `RENDER_TOKEN` than the running Hetzner worker (would 401 every render). Aligned Vercel to the worker's value + redeployed. No worker restart.

### Deferred Items

- **Stage G (merge `feature/12-psg-report` → main):** deferred to 12-05 close per the plan (12-05 layers GA4-dims + performance on the same infra).
- **Real-shop activation:** auto-fires the `0 0 1 * *` cron on July 1; a scheduled cloud agent (`trig_01G7MfA382AUXYTYXnc5Knvk`) verifies the June reports send and drafts the result to nick@.
- **Secret rotation:** the chat-pasted Hetzner / AI Gateway / SendGrid secrets to rotate post-close (recorded in STATE).

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| First live smoke held the report | Root-caused to the eval-gate source-parse bug; fixed (`abe1b95`) |
| Delivered email link errored COMMON_NAME_INVALID | Root-caused to SendGrid click tracking; disabled in code (`59e89cb`) |
| Render token mismatch (Vercel ≠ worker) | Aligned Vercel to the worker value + redeploy |
| No real shop had a complete prior month | Verified on the Demo shop with seeded May data, then cleaned |

## Next Phase Readiness

**Ready:**
- Report pipeline is live + proven end-to-end; daily ingest healthy; all four sources flowing.
- 12-05 (GA4 dimensions + real performance via CrUX/PageSpeed/GTMetrix + new report sections) layers on the SAME infra — no new worker; incremental ingest + secrets + redeploy.

**Concerns:**
- First real-shop run is July 1 (unwatched until the scheduled check); partial-month/cold-start framing should be sane but is unverified on real data until then.
- Locked-module edits (evaluate/email/mail) mean 12-02/12-03 are no longer byte-identical to their SUMMARYs; both changes are committed + tested.

**Blockers:** None. (Stage G merge intentionally deferred to 12-05 close.)

---
*Phase: 12-psg-report, Plan: 04*
*Completed: 2026-06-11*
