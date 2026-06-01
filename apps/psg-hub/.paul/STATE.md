# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-05-29)

**Core value:** Consolidates fragmented PSG tooling into one branded `hub.psgweb.me` surface that customers, internal staff, and superadmins all use — replacing logins and tooling sprawl with role-gated unified access.
**Current focus:** Phase 3 (SendGrid + Twilio + Sanity new project + Vercel re-link) — **03-03 (Sanity) PLAN created, awaiting approval.** 4-way subsystem split (operator); `03-01` SendGrid + `03-02` Twilio ✅ LOOP CLOSED (2 of 4); `03-03` (Sanity) PLAN ✓ — tight scope: provision new project + `production` dataset (D55) + decouple `@psg/studio` from BSM `436nqu7v` (env-driven) + env contract; read client deferred to v0.3 (operator). Phase 3 NOT complete — 2 plans remain (no transition). Phase 2 (Design system) **✅ COMPLETE + UNIFIED 2026-06-01** — psg-hub embodies the PSG design system (submodule + Gotham/Didact fonts + brand tokens + PSG logo + branded login/signup + navy app shell + DS-spec primitives), fully de-BSM'd; all 4 plans loop-closed + operator-approved + reconciled (typecheck + 136 tests green at HEAD).

## Current Position

Milestone: v0.1 Foundation (v0.1.0) — In progress
Phase: 3 of 5 (SendGrid + Twilio + Sanity + Vercel re-link) — Planning (2 of 4 loop-closed; 03-03 PLAN created)
Plan: 03-03 (Sanity) created, awaiting approval
Status: PLAN created, ready for APPLY. Tight + standard track, `autonomous: false` (1 operator checkpoint). Wave 1, deps []. 2 auto tasks (decouple `@psg/studio` from BSM → env-driven config + studio `.env.example`; psg-hub Sanity `.env.example` contract) + 1 checkpoint:human-action (provision new project under PSG org `oqyhOHQtc` + `production` dataset + read token + studio live-verify). De-risk: BSM `436nqu7v` = sample data only (7 docs, 4 real + 3 AI-assist) → start-fresh safe (D57); single org so no org-selection. Read client + content rendering deferred to v0.3; Vercel env wiring → 03-04. Phase 3 NOT complete — 2 plans remain.
Last activity: 2026-06-01 — Created `03-03-PLAN.md` (Sanity, tight scope). Verified studio state + legacy-project contents via Sanity MCP.

Progress:
- Milestone v0.1: [████░░░░░░] 40% (2 of 5 phases complete)
- Phase 1: [██████████] 100% ✅
- Phase 2: [██████████] 100% ✅ (4 of 4 plans, unified)
- Phase 3: [█████░░░░░] 50% (2 of 4 plans loop-closed; 03-03 planned)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY          (03-03)
  ✓        ○        ○     [03-03 PLAN created — awaiting approval]
```
Phase 2 ✅ CLOSED. Phase 3 — 4-way split: **03-01 SendGrid (✅ LOOP CLOSED)** · **03-02 Twilio (✅ LOOP CLOSED)** · **03-03 Sanity (PLAN ✓ — awaiting approval)** · 03-04 Vercel re-link.
Next: review + approve `03-03-PLAN.md`, then `/paul:apply .paul/phases/03-integrations/03-03-PLAN.md`. Carry-overs into Phase 3: design-system submodule is PRIVATE → Vercel deploy key (03-04); 03-01 SENDGRID_* + 03-02 TWILIO_* now in `.env.local` (dev) — Vercel env + public host wired in 03-04 where BOTH webhooks get live-verified against a public URL.

### APPLY 03-01 execution log (for UNIFY)
- **Task 1 (auto) — DONE/PASS:** `src/lib/resilience.ts` (withRetry + CircuitBreaker, injectable clock/sleep/jitter) + `src/lib/mail/{types,sendgrid}.ts` (`createMailSender` factory + `sendEmail`; retry on 429/5xx, breaker trips on transient only). 20 new unit tests. AC-1 met.
- **Task 2 (auto) — DONE/PASS:** `src/app/api/webhooks/sendgrid/route.ts` (ECDSA verify → 400 on invalid/missing; idempotent `upsert(onConflict sg_event_id, ignoreDuplicates)`; 500 on persist-fail for safe retry). Migration `create_email_events` applied to shared project `gylkkzmcmbdftxieyabw` (RLS on, no public policies, `sg_event_id` UNIQUE). 7 new tests. AC-2 met.
- **Task 3 (checkpoint:human-action) — RESOLVED:** operator did API key + domain auth (SPF/DKIM on psgweb.me) + Event Webhook + `.env.local`. Live send 202 from `setup@psgweb.me`, inbox receipt confirmed. AC-3 send-half met; **webhook event-row verify DEFERRED to 03-04** (needs public URL; operator chose option a).
- **Gates:** `pnpm typecheck` clean · `pnpm test` 163/163 (17 files; +27 new) · `pnpm lint` 0 errors (1 PRE-EXISTING warning in `src/lib/supabase/middleware.ts`, boundary file, not introduced here).
- **Deviations/notes:** (1) Next docs bundle absent in install → mirrored the in-repo Stripe webhook (proven Next 16 pattern). (2) Test-only fixes during qualify: `vi.hoisted` for SDK mocks + constructable `EventWebhook` mock. (3) Added `scripts/send-test-email.mjs` (dev verifier, no secrets). (4) deps added: `@sendgrid/mail`, `@sendgrid/eventwebhook`.
- **Files:** package.json · pnpm-lock.yaml · .env.example · vitest.setup.ts · src/lib/resilience.ts · src/lib/__tests__/resilience.test.ts · src/lib/mail/types.ts · src/lib/mail/sendgrid.ts · src/lib/mail/__tests__/sendgrid.test.ts · src/app/api/webhooks/sendgrid/route.ts · src/app/api/webhooks/sendgrid/__tests__/route.test.ts · scripts/send-test-email.mjs · (DB) email_events migration.
- **Not committed yet** — branch `chore/phase-3-integrations` (operator commits at/after UNIFY).

### APPLY 03-02 execution log (for UNIFY)
- **Task 1 (auto) — DONE/PASS:** `src/lib/sms/{types,twilio}.ts` — `createSmsSender` factory over lazy `getTwilioClient`, wraps `messages.create` in `CircuitBreaker.execute(withRetry(...))` reusing `src/lib/resilience.ts` verbatim. KEY divergence implemented: `statusOf` reads `error.status` (HTTP), NOT `.code` (Twilio vendor code) — inverse of SendGrid. `isRetryableTwilioError`: undefined→true, 429||≥500→true. `twilio@^6.0.2` added. 7 unit tests. AC-1 met.
- **Task 2 (auto) — DONE/PASS:** `src/app/api/webhooks/twilio/route.ts` — single dual-path route: `twilio.validateRequest(authToken, signature, env-reconstructed URL, PARSED form params)` → 403 invalid / 400 missing sig / 500 missing token|base-url; idempotent `upsert(onConflict "message_sid,status", ignoreDuplicates)`; branch on `MessageStatus` → status-callback 204 / inbound empty-TwiML `text/xml`; 500 on persist-fail. Migration `create_sms_events` applied to shared project `gylkkzmcmbdftxieyabw` (RLS on, 0 policies, UNIQUE(message_sid,status), both NOT NULL). 12 route tests. AC-2 met.
- **Task 3 (checkpoint:human-action) — RESOLVED:** operator set TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER in `.env.local` (no Messaging Service → bare-from path). Live send `scripts/send-test-sms.mjs <operator-mobile>` → `OK sid=SMe1f86eae4a7ff0b20c83f2e48e695552 status=queued sender=+19735325352`; operator confirmed phone receipt. AC-3 send-half met; **webhook live sig-verify DEFERRED → 03-04** (needs public URL — clean parallel to 03-01).
- **Gates:** `pnpm typecheck` clean · `pnpm test` 182/182 (19 files; +19 new) · `pnpm lint` 0 errors (1 PRE-EXISTING warning in `src/lib/supabase/middleware.ts`, not introduced here).
- **Adversarial review (workflow, real twilio@6):** 2 confirmed-real MEDIUM findings, both fail-CLOSED URL-reconstruction (no security hole): (1) trailing-slash in `TWILIO_WEBHOOK_BASE_URL` → double-slash → 100% sig rejection → FIXED (`base.replace(/\/+$/,"")`); (2) query-string preservation untested → FIXED (+2 hardening tests). Re-qualified green.
- **Deviations/notes:** (1) dropped unused `RestException` import — `statusOf` is structural (`"status" in error`), mirroring the mail adapter; no shipped-behavior change. (2) Scope addition: `scripts/send-test-sms.mjs` (dev verifier, no secrets). (3) 2 review fixes folded into qualify (above).
- **Files:** package.json · pnpm-lock.yaml · .env.example · vitest.setup.ts · src/lib/sms/types.ts · src/lib/sms/twilio.ts · src/lib/sms/__tests__/twilio.test.ts · src/app/api/webhooks/twilio/route.ts · src/app/api/webhooks/twilio/__tests__/route.test.ts · scripts/send-test-sms.mjs · (DB) sms_events migration.
- **Committed + pushed:** `01daead` on `chore/phase-3-integrations` → origin (github.com/Phoenix-Solutions-Group/data); 16 files, +1313/−18; NOT merged to main (phase merge after 03-04). `.gitignore` fix: `!.env.example` un-ignores the example file (was swallowed by `.env*`) — also retroactively lands the 03-01 SendGrid env block. `.base/*` excluded.

## Phase 3 Plan Split (4-way subsystem, 2 waves) — confirmed 2026-06-01

| Plan | Scope | Wave | Deps | Status |
|------|-------|------|------|--------|
| 03-01 | SendGrid: shared resilience util + mail adapter + idempotent event webhook + `email_events` table; operator domain-auth (SPF/DKIM/DMARC) + live-send checkpoint | 1 | none | ✅ LOOP CLOSED (163 tests green; live send 202 verified; webhook-row deferred → 03-04; SUMMARY written) |
| 03-02 | Twilio: SMS adapter (reuses `src/lib/resilience.ts`) + idempotent dual-path webhook + `sms_events` table; operator number + secrets checkpoint | 1 | none | ✅ LOOP CLOSED (182 tests green; live send queued + phone receipt; webhook live sig-verify deferred → 03-04; SUMMARY written) |
| 03-03 | Sanity: provision new project + single prod dataset (D55) under PSG org; decouple `@psg/studio` from BSM `436nqu7v` (env-driven config); publish env contract (studio + hub). Tight scope — read client deferred v0.3; no migration (start fresh, D57) | 1 | none | PLAN ✓ (awaiting approval — `autonomous:false`, 2 auto + 1 operator checkpoint) |
| 03-04 | Vercel: re-link `psg-advantage-portal`→`psg-hub` + rename (preserve env + analytics, D54) + private-submodule deploy key + wire all Phase 3 env; decommission BSM Vercel | 2 | 03-01,03-02,03-03 | TBD (research-flagged: rename mechanics) |
**Git:** Phase 1 + Phase 2 both on `main` (pushed). Phase 2 fast-forwarded `65bc17f..54e53f0` 2026-06-01; branch `chore/phase-2-design-system` fully merged (0 ahead / 0 behind `main`).

## Phase 2 Plan Split (expanded 4-plan, 2 waves) — re-scoped 2026-06-01

| Plan | Scope | Deps | Status |
|------|-------|------|--------|
| 02-01 | Submodule + Gotham/Didact fonts + BSM teal → PSG tokens + delete orphan tokens.css | none | ✅ DONE (committed `4792b1e`) |
| 02-02 | Branded `/login` slice: `<Logo>` + DS-spec button/label + login/signup PSG vocabulary + de-BSM + tab title | 02-01 | ✅ DONE (committed `82d90c6`, approved) |
| 02-03 | App shell (navy sidebar + reverse logo + header) + FIX `/dashboard` 404 (renamed route group→segment) + onboarding + ads in-copy de-BSM + card/badge/table DS spec | 02-02 | ✅ DONE (`8f041c6`, approved) |
| 02-04 | Doc retirement: portal `DESIGN-SYSTEM.md` superseded banner + ads-dashboard ABSORPTION-NOTES reconcile + README verified | 02-01 | ✅ DONE |

Phase 2 decisions locked (2026-05-31 → 2026-06-01):
- Source = design-system repo; `colors_and_type.css` CANONICAL over SKILL.md on contradictions (paper #FAFAFA, headings Bold 700) — operator 2026-06-01. (psg-advantage-portal DRIFTED — ignore its values.)
- Logos = DS reconstruction placeholder (`assets/psg-logo-*.svg`), use now + swap official later (operator-approved). Product name = "Phoenix Solutions Group".
- 02-01 reframe: human-verify showed token-swap ≠ design-system embodiment ("where's the logo"). Intent expanded; 02-01 kept as correct foundation, NOT a defect.
- Consumption = raw-asset; fonts via next/font/local (paths MUST be literals — not a variable). No psgTokens.ts (no chart consumers); no Gotham Rounded.
- Dev unblock: gitignored `.env.local` (Supabase URL + anon key via MCP) so /login renders; full env = Phase 3. Submodule PRIVATE → Vercel deploy key Phase 3. Gotham Typekit-licensed → flagged.

Carry-over to track in next plans:
- Resolved 2026-05-31: workspace-root git strategy = single monorepo (collapse). `apps/psg/.git` is THE monorepo; psg-hub `.git` absorbed (history bundled); `/archive/` + `/psg-import/` + `/api-psghub/` + `/psg-data-lake/` gitignored (root-anchored). Wave 1 committed on branch `chore/phase-1-workspace-consolidation` (NOT pushed).
- Deferred (01-02): `apps/psg/psg-agentic-os-dev-packet.docx` (32K loose) — operator decision needed before Phase 1 close
- Concern (01-01): `.npmrc` warnings from npm (cosmetic; pnpm reads correctly). Optional later cleanup: split to `.pnpmrc`.
- Resolved 2026-05-31: `apps/psg/local-reach-content/` archived via 01-04 (Task 5) — sidecar at archive/local-reach-content/, tracys/ extracted. LOOP CLOSED.

## Phase 1 Plan Split (7 plans, 2 waves) — all created

| Plan | Scope | Wave | Deps | Lines | Status |
|------|-------|------|------|-------|--------|
| 01-01 | Monorepo scaffold (workspace-root configs at `apps/psg/`) | 1 | none | 341 | PLAN ✓ |
| 01-02 | Kill list + non-code relocation to `~/apps/_psg-archive/` (Q23–25) | 1 | none | 377 | PLAN ✓ |
| 01-03 | ads-dashboard PAUL absorb + codebase archive + GitHub archive flag (D70) | 1 | none | 311 | LOOP CLOSED ✓ |
| 01-04 | local_reach archive + active client outputs extracted (D69) + `local-reach-content/` addendum (carryover from 01-02) | 1 | none | 351 | LOOP CLOSED ✓ |
| 01-05 | BSM dashboard relocated to `apps/psg/apps/psg-hub/`; pnpm-lock generated | 2 | 01-01 | 401 | LOOP CLOSED ✓ |
| 01-06 | BSM siblings → `apps/psg/packages/*` scoped `@psg/*` | 2 | 01-01, 01-05 | 390 | LOOP CLOSED ✓ (only studio was a real pkg; 4 stubs deferred) |
| 01-07 | `apps/ads/` → `apps/psg/apps/psg-ads-mutations/` Python worker | 2 | 01-01 | 350 | LOOP CLOSED ✓ (1935MB freed; .git bundled; .env preserved) |

## Accumulated Context

### Decisions

70 decisions logged in `../../projects/psg-hub/PLANNING.md` (v7). Recent decisions affecting v0.1:

| Decision | Phase | Impact |
|----------|-------|--------|
| D3 — BSM dashboard is the anchor | All | Relocates from `~/apps/projects/bsm/dashboard/` to this directory in Phase 1 |
| D50 — SendGrid + Twilio replace Resend | v0.1 Phase 3 | Email + SMS integration |
| D52 — Python worker = Vercel Sandbox | v1.2 + v1.6 | Consistent runtime |
| D53 — Mail dual adapter (Lob + in-house) | v1.3 | Production module architecture |
| D54 — Retire BSM Vercel, rename portal → psg-hub | v0.1 Phase 3 | Preserve analytics history |
| D55 — Provision new Sanity project | v0.1 Phase 3 | No existing project to inherit |
| D57 — Zero live BSM customers | v0.1 | Hard cutover OK |
| D60 — No fixed launch date | All | Quality-first cadence |
| D61 — Pilot: Wallace + Tedesco + Tracy's | v1.0 | Pilot cohort identity |
| D62 — Strictly sequential post-v1.0 | v1.1+ | Single team scheduling |
| D70 — ads-dashboard reframed to plans/concepts | v0.3 + v0.1 Phase 4 | Absorb intent + PAUL plans only; not code |
| 2026-05-31: local_reach `accidents.db` (2.9G) archived whole, not stripped | Phase 1 / 01-04 | Operator chose option A at checkpoint; archive recoverable, +2.9G workspace |
| 2026-05-31: 01-06 scope override (Option A) — only `studio` is a real package; 4 stubs (integrations/onboarding/preview/shops, no package.json) deferred | Phase 1 / 01-06 | studio → @psg/studio (workspace=2 members); 4 stubs stay at ~/apps/projects/bsm/ for a later content/scaffold plan; AC-5 (6 members) → 2, AC-6 (BSM nearly empty) revised |
| 2026-05-31: 01-07 — apps/ads → psg-ads-mutations Python worker; `.env` preserved (NOT deleted), nested `.git` bundled+dropped, node_modules/.claude stripped, non-Python content (psg-ads Obsidian vault + HTMLs) included-as-is | Phase 1 / 01-07 | worker landed 394M; secret-ignore gate verified (google-ads.yaml + .env ignored) pre-transition; bundle at `archive/_repo-bundles/ads-pre-drop-20260531.bundle`; 394M per-client artifacts will be staged at phase commit |
| 2026-05-31: Workspace git = single monorepo (collapse) | Phase 1 / git strategy | `apps/psg/.git` is THE monorepo; psg-hub absorbed (history → `archive/_repo-bundles/` bundle); psg-import + api-psghub kept independent (own .git, gitignored); Wave 1 committed on branch `chore/phase-1-workspace-consolidation`, not pushed |
| 2026-06-01: SendGrid integration (03-01) — shared `src/lib/resilience.ts` (retry + circuit breaker) introduced; `email_events` table on shared `gylkkzmcmbdftxieyabw` (RLS on, no public policies, `sg_event_id` UNIQUE); webhook mirrors Stripe route | Phase 3 / 03-01 | Resilience util is the reusable foundation for all external calls (03-02 Twilio reuses); domain auth on psgweb.me verified (202 + inbox); webhook event-row verify deferred → 03-04 (public-URL) |
| 2026-06-01: Twilio integration (03-02) — SMS adapter reuses `src/lib/resilience.ts`; `sms_events` on shared `gylkkzmcmbdftxieyabw` (RLS on, no public policies, composite UNIQUE(message_sid,status) both NOT NULL); webhook = HMAC-SHA1 via `twilio.validateRequest` over env-reconstructed URL + parsed params (auth token = secret, no separate key var); `statusOf` reads `error.status` (inverse of SendGrid `.code`) | Phase 3 / 03-02 | resilience util proven across 2 providers; live send verified (queued + phone receipt) via bare-from (no Messaging Service yet); webhook live sig-verify deferred → 03-04 (public URL) |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| Q15 — FileMaker historical migration scope | SEED v7 | M | Only if v1.3.5 add-on triggered |
| First-login UX (tour, empty state, sample data) | SEED v7 | M | v2.0 hardening |
| End-consumer PII retention policy | SEED v7 | S | v0.2 PII review |
| Domain coexistence (`hub.psgweb.me` + `psgweb.me` marketing) | SEED v7 | S | v2.0 launch readiness |
| Workspace-root git strategy — RESOLVED 2026-05-31 → collapse to single monorepo | 01-01 planning | S | Done (see Decisions); not pushed — operator merges to main |
| `apps/psg/psg-agentic-os-dev-packet.docx` (32K loose) — classify | 01-02 APPLY post-state | XS | Decide before Phase 1 close |
| psg-hub build Stripe `apiVersion` — RESOLVED 2026-05-31 | 01-05 build | XS | Set → `"2026-05-27.dahlia"` (match SDK stripe@^22); build green |
| Stray `~/package-lock.json` mis-roots Next builds — RESOLVED 2026-06-01 | 01-05 build | XS | Set `turbopack.root` → monorepo root in `apps/psg-hub/next.config.ts` (computed relative via import.meta). Build green, workspace-root warning gone. |
| BSM `middleware.ts` deprecated in Next 16 (→ proxy) | 01-05 build | S | Rename convention in later phase |

### Blockers/Concerns
None blocking Phase 2 (confirmed by readiness audit below). Open follow-ups tracked in Session Continuity + the audit's operator-decision list.

### Phase 1 Readiness Audit — 2026-05-31 (9-agent adversarial verify)
Verdict: **GO for Phase 2.** All 7 Phase-1 plans verified loop-closed in-repo; secrets clean (only `.example` tracked); zero Phase-2 blockers.
- 01-01/03/04/05/06/07 → verified vs filesystem. 01-04 trivial off-by-one (60 vs 61 entries).
- **01-02 → residue-found (OUTSIDE repo) — RECORDS CORRECTED 2026-05-31:** 3 of 9 intended relocations never ran — `~/apps/CFO` (101M), `~/apps/governance` (48K), `~/apps/obsidian-vault` (77M) still at original `~/apps/` paths, NOT in `~/apps/_psg-archive/`. Operator chose "correct the records" → MANIFEST.md moved them to a "NOT relocated" section + 01-02-SUMMARY AC-3 downgraded PASS→PARTIAL with a correction banner. The 3 dirs left in place (active workspaces); relocate-vs-leave still open at operator's convenience. No Phase-2 impact.
- **Cleaned this session (claude-now):** pruned 2 dead `local-reach-content/.claude/worktrees/` registrations; deleted 2 abandoned orphan branches (`claude/goofy-kepler-f3c13d`, `claude/thirsty-dubinsky-788ccb`, both contained in origin/main).
- **Tracking findings:** (1) `apps/psg-ads-mutations/ops/*/ad-assets/` = 51M binary creative in `091cce6` → operator decided **KEEP permanently** (item closed). (2) `psg-data-lake/` = 63 source files tracked despite dead `/psg-data-lake/` gitignore rule (no own .git → leave tracked; rule is just misleading — left as-is).

### Git State
- Last commit: `01daead` — feat(psg-hub): Twilio SMS 03-02 (on `chore/phase-3-integrations`, pushed to origin; NOT merged to main)
- Phase 3 branch `chore/phase-3-integrations`: PUSHED to origin 2026-06-01 (tracks `origin/chore/phase-3-integrations`). Contains `98c3125` (03-01 SendGrid) + `01daead` (03-02 Twilio). Merges to `main` at Phase 3 transition (after 03-04). `.base/*` intentionally excluded from these commits.
- Branch: `chore/phase-2-design-system` == `main` (0 ahead / 0 behind; fully merged + pushed, tracks `origin/main`)
- Phase 1: on `main` (`a96e271`). Phase 2: **MERGED + PUSHED to `main` 2026-06-01** (ff `65bc17f..54e53f0`) on `github.com/Phoenix-Solutions-Group/data`. No remote action pending.
- 51M ad-assets remain in history (operator chose KEEP permanently; already on `main` since Phase 1).
- Excluded/ignored: `.next/` build cache + node_modules + real secrets (`.env`, `google-ads.yaml`) all gitignored
- History bundles (gitignored `archive/_repo-bundles/`): psg-hub, bsm-dashboard, ads (`ads-pre-drop-20260531.bundle`)

## Boundaries (Active)

From 01-01-PLAN.md:
- `apps/psg/apps/psg-hub/**` — psg-hub directory + .paul/ untouched in 01-01
- `apps/psg/projects/**` — SEED PLANNING.md artifacts immutable post-graduation
- `apps/psg/.paul/codebase/**` — workspace codebase map read-only
- `apps/psg/psg-data-lake/**` — untouched (D14)
- `apps/psg/psg-advantage-portal/**` — untouched in v0.1
- `apps/psg/psg-import/**` — untouched in v0.1
- `apps/psg/api-psghub/**` — reference only
- Anything outside `/Users/schoolcraft_mbpro/apps/psg/`

## Session Continuity

Last session: 2026-06-01
Stopped at: **03-03 (Sanity) PLAN created — awaiting approval.** `03-03-PLAN.md` written (tight + standard, `autonomous:false`, wave 1, deps []). Scope: provision NEW Sanity project under PSG org (`oqyhOHQtc`) + single `production` dataset (D55); decouple `@psg/studio` from BSM `436nqu7v` (config → env-driven `SANITY_STUDIO_*`, BSM id removed); publish env contract in `packages/studio/.env.example` + `apps/psg-hub/.env.example` (`NEXT_PUBLIC_SANITY_*` + `SANITY_API_READ_TOKEN`, names only). 2 auto tasks + 1 checkpoint:human-action (provision + token + studio live-verify). De-risk via Sanity MCP: legacy `436nqu7v` = sample data only (7 docs) → start-fresh safe (D57); single org → no org-selection. Operator decisions confirmed pre-plan: TIGHT scope (read client + content rendering deferred to v0.3), STANDARD track. Vercel env wiring + `sanity deploy` → 03-04 (mirrors SendGrid/Twilio deferral). 03-01/03-02 still ✅ LOOP CLOSED; Phase 3 = 2/4, NOT complete.
Next action: review + approve `03-03-PLAN.md`, then `/paul:apply .paul/phases/03-integrations/03-03-PLAN.md`.
Resume file: `.paul/phases/03-integrations/03-03-PLAN.md`.
Resume context:
- Phase 2 closed: submodule `packages/ui/psg-brand/` @`1689896`; PSG tokens (midnight/ember/paper, 6px) + Gotham/Didact fonts; `<Logo>` + DS-spec button/label/card/badge/table; branded `/login` + `/signup` + navy app shell; `/dashboard` 404 fixed (route group `(dashboard)`→ segment `dashboard`); de-BSM app-wide; legacy DS docs superseded.
- Phase 3 carry-overs: submodule is PRIVATE → Vercel deploy key needed for recursive checkout; only gitignored dev `.env.local` (Supabase URL+anon via MCP) exists — full env (service role + SendGrid/Twilio/feature keys) lands Phase 3; Gotham = Adobe Typekit-licensed → self-hosting `.otf` flagged; old bare root URLs (`/content`, `/ads`) now 404 post route-rename (matters when Phase 3 wires email links).
- Deferred (non-blocking): Phase 2.x compose route-page interiors to DS layout vocabulary; active-nav highlight (needs a small client nav component); 01-02 out-of-repo archival (CFO/governance/obsidian-vault relocate-or-leave; records corrected).
- Git: Phase 1 + Phase 2 both on `main` (pushed; home repo `github.com/Phoenix-Solutions-Group/data`, tip `54e53f0`). Branch `chore/phase-2-design-system` fully merged (0 ahead / 0 behind).

---
*STATE.md — Updated after every significant action*
