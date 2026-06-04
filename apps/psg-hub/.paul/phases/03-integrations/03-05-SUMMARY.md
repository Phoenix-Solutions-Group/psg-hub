---
phase: 03-integrations
plan: 05
subsystem: infra
tags: [vercel, webhooks, sendgrid, twilio, supabase, env, git-connect, submodule, decommission, idempotency]

requires:
  - phase: 03-01-sendgrid
    provides: /api/webhooks/sendgrid (ECDSA-verified, idempotent) + email_events table + send-test-email.mjs
  - phase: 03-02-twilio
    provides: /api/webhooks/twilio (HMAC dual-path) + sms_events table
  - phase: 03-04-vercel
    provides: psg-hub LIVE at hub.psgweb.me + 13 prod env keys (SUPABASE_SERVICE_ROLE_KEY was deferred)
provides:
  - SUPABASE_SERVICE_ROLE_KEY wired to psg-hub Production (the seam that lets both webhooks persist)
  - Live-verified SendGrid Event Webhook (email_events row) — closes 03-01 deferred half
  - Live-verified Twilio inbound webhook (sms_events row) — closes 03-02 deferred half
  - Verified decommission state (D54): data project 404, no BSM/ads-dashboard project exists
  - Confirmed active stack: psg-hub Vercel <-> Phoenix-Solutions-Group/data GitHub (git-connected to main)
affects: [phase-3-transition, main-merge, v0.2-customer-mvp]

tech-stack:
  added: []
  patterns:
    - "Live webhook verification: provider dashboard URL set -> trigger -> poll Supabase for signed-verified row (a persisted row proves sig + service-role write together)"
    - "Secret wiring: grep|cut|vercel env add … production via stdin (value never echoed)"

key-files:
  created: [.paul/phases/03-integrations/03-05-SUMMARY.md]
  modified: [.paul/STATE.md, .paul/ROADMAP.md, .paul/PROJECT.md]

key-decisions:
  - "Decommission (D54) satisfied by current state — data project already 404, no BSM/ads-dashboard project exists; no destructive action taken"
  - "KEEP psg-hub<->data git connection (operator) — supersedes 03-04's 'not git-connected' record"
  - "SUPABASE_DB_URL left deferred — service.ts uses supabase-js, not the pg pool"

patterns-established:
  - "A persisted webhook row is the joint proof of signature-verify + service-role persistence + URL reconstruction"

duration: ~25min
started: 2026-06-01T20:55:00Z
completed: 2026-06-01T21:20:00Z
---

# Phase 3 Plan 05: Close deferred webhook loops + decommission — Summary

**Both deferred webhook live-verifies are CLOSED with real signature-verified rows (a SendGrid `email_events` row whose message_id matches the test send, and a Twilio inbound `sms_events` row), after wiring the missing `SUPABASE_SERVICE_ROLE_KEY` to Vercel Production; the D54 decommission was satisfied by verified current state (the old `data` project is already deleted — HTTP 404 — and no distinct BSM/ads-dashboard Vercel project exists), and the operator confirmed psg-hub ↔ `Phoenix-Solutions-Group/data` as the active git-connected stack — surfacing one proven merge-blocker: git builds fail on the private `psg-brand` submodule until the Vercel GitHub-app is granted access to `design-system`.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~25 min (3 operator checkpoints) |
| Started | 2026-06-01T20:55:00Z |
| Completed | 2026-06-01T21:20:00Z |
| Tasks | 4 (1 auto + 2 checkpoint→auto-verify + 1 checkpoint:decision) |
| Repo files modified | 0 source; .paul docs only |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Prod webhook persistence enabled | **PASS** | `SUPABASE_SERVICE_ROLE_KEY` added to psg-hub Production via CLI stdin (never echoed); `vercel --prod` redeploy READY (dpl_F7TkrPSxW1LsUp3vxCSbygwTSTnF); `vercel env ls` confirms key (Production); routes live POST→400 / GET→405. Persistence proven jointly by AC-2/AC-3. |
| AC-2: SendGrid Event Webhook live-verified | **PASS** (closes 03-01 deferred) | Operator set signed Event Webhook → hub.psgweb.me/api/webhooks/sendgrid. Test send (202, msg-id `2GBMbxLcRQ6KpgCJkM6NAg`) → new `email_events` row `sg_event_id=QyqVCvCXS12H7Y8MoqrxxQ`, `event=open`, `message_id=2GBMbxLcRQ6KpgCJkM6NAg.recvd-…`, created 21:11:17Z. Persisted ⇒ ECDSA sig verified + service-role write OK. |
| AC-3: Twilio webhook live-verified | **PASS** (closes 03-02 deferred) | Operator set number +19735325352 inbound webhook → hub.psgweb.me/api/webhooks/twilio (exact) + texted inbound. New `sms_events` row `message_sid=SM0176a4c430f9521e25b45f4baad93ee2`, `status=received`, `direction=inbound`, +18479092140→+19735325352, created 21:13:59Z. Persisted ⇒ `twilio.validateRequest` passed (not 403) + URL recon matched + inbound dual-path branch fired. |
| AC-4: Stale Vercel decommissioned, survivors intact (D54) | **PASS** (by verified current state — no action taken) | `data` (`prj_dOxaaZubzVRDy9NlpA2qeoI0WEfx`) = HTTP 404 (already deleted). No `bsm`/`ads-dashboard` project anywhere (team `psg-digital` + personal account both enumerated; personal=0 projects). 8 survivors untouched. `data` no longer auto-deploys anything. |

## Verification Results

```
Env:     vercel env ls production → SUPABASE_SERVICE_ROLE_KEY present (Production)
Deploy:  vercel --prod → READY (dpl_F7TkrPSxW1LsUp3vxCSbygwTSTnF), aliased hub.psgweb.me
Routes:  POST /api/webhooks/{sendgrid,twilio} → 400 ; GET → 405 (live; /usr/bin/curl — curl not on shell PATH)
SendGrid: email_events += {event=open, message_id 2GBMbxLcRQ6KpgCJkM6NAg.*} @ 21:11:17Z (baseline 11 rows @ 21:09:42Z)
Twilio:   sms_events += {received, inbound, +18479092140→+19735325352} @ 21:13:59Z (first-ever row)
Decom:    GET /v9/projects/prj_dOxaaZubzVRDy9NlpA2qeoI0WEfx → HTTP 404 ; personal projects = 0
Git link: psg-hub.link = github Phoenix-Solutions-Group/data @ main (createdAt today)
```

## Accomplishments

- Closed the two webhook loops 03-01/03-02 left open — both now verified end-to-end on the real provider→hub.psgweb.me→Supabase path, with idempotent signature-verified persistence proven by matched rows.
- Wired the one missing seam (`SUPABASE_SERVICE_ROLE_KEY`) that made webhook persistence possible — without it both routes 500 on persist.
- Established the verified production deploy + content stack and confirmed D54 cleanup is complete with zero collateral (8 survivor projects untouched).
- Surfaced and PROVED a concrete merge-blocker (private-submodule git build failure) before it could silently break the phase-transition deploy.

## Task Commits

Plan-level commit on branch `chore/phase-3-integrations` (no source changes; .paul docs only). Vercel-side change (1 prod env key) is not a repo artifact.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `.paul/phases/03-integrations/03-05-PLAN.md` | Created (prior turn) | The executed plan |
| `.paul/phases/03-integrations/03-05-SUMMARY.md` | Created | This file |
| `.paul/STATE.md` | Modified | Execution log, decisions, deferred issues, loop close, transition |
| `.paul/ROADMAP.md` | Modified | Phase 3 → complete |
| `.paul/PROJECT.md` | Modified | Phase 3 shipped → Validated; decisions logged |

**Vercel-side (not in repo):** `SUPABASE_SERVICE_ROLE_KEY` added to psg-hub Production + redeploy.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Decommission (D54) = no action; satisfied by current state | `data` already 404; no BSM/ads-dashboard project exists anywhere (enumerated team + personal) | D54 closed; the 03-04 "data clobbers main-merge" worry is moot (deleted) |
| KEEP psg-hub ↔ `Phoenix-Solutions-Group/data` git connection | Operator: "we are using psg-hub Vercel + data GitHub" — intended active stack | psg-hub auto-deploys `main` via git; **supersedes 03-04's "not git-connected" record** (operator connected it post-03-04; link createdAt = today) |
| `SUPABASE_DB_URL` left deferred | `src/lib/supabase/service.ts` uses supabase-js, not the pg pool — webhooks don't need it | Wire only when a pg-pool consumer appears |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| AC met by verified state (vs planned action) | 1 | AC-4: no destructive decommission needed — targets already retired out-of-band |
| Material finding (state drift) | 1 | psg-hub IS git-connected to data@main (03-04 recorded otherwise) |
| Deferred | 1 | Submodule GitHub-app grant (gates main-merge) |

**Total impact:** No scope creep; no source/schema/test changes. One reconciliation (git-connect drift) and one proven merge-blocker carried forward.

### Reconciliation of prior record (important for future readers)

03-04-SUMMARY states "psg-hub … NOT git-connected → clobber-window avoided." That was accurate at 03-04 close. The operator connected psg-hub to `Phoenix-Solutions-Group/data` afterward (git link `createdAt` = today, after 03-04's CLI deploy). **Current truth: psg-hub auto-deploys `main` via git.** Do not trust the stale "not connected" line when reasoning about the main-merge.

### Deferred Items (→ phase transition / post-merge)

- **MERGE-BLOCKER (PROVEN):** grant Vercel GitHub-app access to `Phoenix-Solutions-Group/design-system` (private `psg-brand` submodule) BEFORE merging Phase 3 → `main`. Evidence: git deploy `dpl_2Mbq7SnQ26gMHdHS8B1bFPyh56RQ` (branch push 20:47) ERRORED — `Font file not found: …packages/ui/psg-brand/fonts/{DidactGothic-Regular.ttf,Gotham-Book.otf}`. CLI `vercel --prod` works (uploads local submodule); git/main builds fail until the grant. A failed main deploy won't promote — hub.psgweb.me safely keeps serving the last good CLI deploy.
- `SUPABASE_DB_URL` + git Preview env on psg-hub — when needed.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `curl` not on the non-interactive shell PATH (exit 127) | Used `/usr/bin/curl` |
| `UID=…` assignment failed ("operation not permitted") | `UID` is a readonly shell var → renamed to `DEP` |
| `data` project absent from team list (03-04 named it as the decommission target) | API confirmed it is HTTP 404 (deleted); decommission already done out-of-band |
| Git-connected psg-hub produced an ERRORED preview deploy | Root-caused to private submodule fonts → documented as merge-blocker carry-forward |

## Next Phase Readiness

**Ready:**
- SendGrid + Twilio webhooks live-verified end-to-end; both deferred 03-01/03-02 halves closed.
- psg-hub production env complete for current features (14 keys incl. service-role).
- D54 decommission complete; production + content stack confirmed.

**Concerns:**
- **MERGE-BLOCKER:** Vercel GitHub-app needs `design-system` access before the Phase-3→main merge, or the auto git deploy of `main` errors (non-promoting; production stays on last good CLI deploy).
- Stripe webhook live but 500s (Stripe env not wired — later phase, out of scope).

**Blockers:** None for closing Phase 3. One gated action (submodule grant) before the main-merge deploy succeeds.

---
*Phase: 03-integrations, Plan: 05*
*Completed: 2026-06-01 — Phase 3 COMPLETE (5/5 plans loop-closed)*
