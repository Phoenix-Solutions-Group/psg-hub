# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-05-29)

**Core value:** Consolidates fragmented PSG tooling into one branded `hub.psgweb.me` surface that customers, internal staff, and superadmins all use — replacing logins and tooling sprawl with role-gated unified access.
**Current focus:** **Phase 3 ✅ COMPLETE (5/5) 2026-06-01 → now at Phase 4 (PAUL inheritance + tracking), not started.** Phase 3 (SendGrid + Twilio + Sanity + Vercel) shipped: transactional email + SMS with live-verified signature-checked idempotent webhooks (real `email_events` + `sms_events` rows), Sanity content backend (`vcw0bsnu`, private prod dataset), and psg-hub LIVE at https://hub.psgweb.me (branded, cert, 14 prod env keys). 03-05 closed the deferred 03-01/03-02 webhook halves + confirmed D54 decommission (data project 404; no BSM/ads-dashboard project). **One gated prod action before the Phase-3→main merge: grant Vercel GitHub-app access to the private `design-system` submodule repo (proven merge-blocker).** Phase 2 (Design system) ✅ COMPLETE + UNIFIED — psg-hub embodies the PSG design system; Phase 1 ✅ workspace consolidation.

## Current Position

Milestone: v0.1 Foundation (v0.1.0) — In progress
Phase: 4 of 5 (PAUL inheritance + tracking) — Not started (Phase 3 ✅ COMPLETE 2026-06-01)
Plan: none — ready to plan Phase 4
Status: **Phase 3 COMPLETE (5/5 loop-closed), transitioned to Phase 4.** Phase 3 shipped SendGrid + Twilio (live-verified webhooks), Sanity project `vcw0bsnu`, and psg-hub LIVE at https://hub.psgweb.me. 03-05 closed the two deferred webhook loops (real email_events + sms_events rows) and confirmed D54 decommission (data project 404; no BSM/ads-dashboard project). **GATED prod action before main-merge (operator): grant Vercel GitHub-app access to `Phoenix-Solutions-Group/design-system` (private submodule) — git/main builds ERROR on submodule fonts until granted (PROVEN: dpl_2Mbq7…); CLI `vercel --prod` works meanwhile, hub.psgweb.me stays live on last good deploy.** psg-hub is git-connected to `Phoenix-Solutions-Group/data`@main (supersedes 03-04's "not connected").
Last activity: 2026-06-01 — Phase 3 complete; 03-05 loop-closed (webhooks live-verified, decommission confirmed); transitioned to Phase 4.

Progress:
- Milestone v0.1: [██████░░░░] 60% (3 of 5 phases complete)
- Phase 1: [██████████] 100% ✅
- Phase 2: [██████████] 100% ✅ (4 of 4 plans, unified)
- Phase 3: [██████████] 100% ✅ (5 of 5 plans, unified)
- Phase 4: [░░░░░░░░░░] 0% (not started)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY          (03-05)
  ✓        ✓        ✓     [03-05 LOOP CLOSED 2026-06-01 — Phase 3 COMPLETE (5/5); transitioned to Phase 4]
```
Phase 2 ✅ CLOSED. **Phase 3 ✅ COMPLETE (5/5 plans loop-closed) 2026-06-01:** **03-01 SendGrid** · **03-02 Twilio** · **03-03 Sanity** · **03-04 Vercel deploy** · **03-05 webhook live-verify + decommission** — all LOOP CLOSED. SendGrid + Twilio webhooks live-verified end-to-end (real email_events + sms_events rows); Sanity project `vcw0bsnu`; psg-hub LIVE at https://hub.psgweb.me; D54 decommission confirmed (data 404, no BSM/ads-dashboard project). **GATED before main-merge: grant Vercel GitHub-app access to `Phoenix-Solutions-Group/design-system` (private submodule) — proven merge-blocker.**
Next: Phase 4 (PAUL inheritance + tracking) — `/paul:plan` when ready. BEFORE the Phase-3→main merge (a prod-promotion, operator-gated): (1) grant the submodule GitHub-app access, (2) merge `chore/phase-3-integrations`→main → psg-hub auto-deploys main via git.

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

### APPLY 03-03 execution log (for UNIFY)
- **Task 1 (auto) — DONE/PASS:** `packages/studio/sanity.config.js` + `sanity.cli.js` → `projectId: process.env.SANITY_STUDIO_PROJECT_ID`, `dataset: process.env.SANITY_STUDIO_DATASET || 'production'` (BSM `436nqu7v` removed from studio config). `packages/studio/.env.example` created (names only). Verified: no `436nqu7v` in `packages/studio`; both configs parse (CJS + ESM); `.env.example` trackable (`git add -n` confirms). AC-1 met (code half).
- **Task 2 (auto) — DONE/PASS:** `apps/psg-hub/.env.example` += Sanity block (`NEXT_PUBLIC_SANITY_PROJECT_ID/DATASET/API_VERSION` + `SANITY_API_READ_TOKEN`, names only). Scope guards: no `@sanity/*` dep added, no `src/`/lockfile changes. Gates: `pnpm typecheck` clean · `pnpm test` 182/182 (19 files, zero regressions). AC-2 met.
- **Task 3 (checkpoint:human-action) — RESOLVED:** operator confirmed psg-hub / Free / Private / Claude-via-MCP. Provisioned via Sanity MCP: new project **`vcw0bsnu`** ("psg-hub") under org `oqyhOHQtc`; auto `production` dataset → ACL flipped **public→private** (`update_dataset`, D55); CORS `http://localhost:3000` added. Studio binding proven (`sanity debug` → Project ID **vcw0bsnu**; CLI doc-query empty = new project, not BSM's 7 → isolated, no migration, D57). Auto-minted **read token** → gitignored `apps/psg-hub/.env.local`; **write token discarded** (not persisted; revoke recommended). Operator ran `sanity dev` verify + `npx sanity schema deploy` → MCP `get_schema` confirms **4 types** on Content Lake (shop 8f · contentItem 16f · auditReport "SEO Audit Report" 7f · researchBrief "Market Research Brief" 6f). AC-3 met.
- **Deviations/notes:** (1) AC-1 "`git grep 436nqu7v` → zero in tracked files" is OVER-BROAD — id legitimately persists in `.paul/` planning docs (describe the decoupling) + `references/bsm/**` history; studio binding fully removed (intent met). (2) Plan verify-command wording bugs (cosmetic, not code): `git check-ignore -v … && FAIL` mis-reads negation exit code (real trackability proven via `git add -n`); `pnpm test --run` invalid (script is `vitest run` → use `pnpm test`); `node --check` on ESM `.js` (passed anyway; ESM-aware check added). (3) Studio `title: 'BSM'` left unchanged per plan boundary → **de-BSM follow-up candidate** (out of 03-03 scope). (4) `create_project` auto-created production-public + 2 tokens; flipped to private + stored read-only. (5) Secrets safety: neither token in any tracked file; `.env.local` (hub + studio) gitignored — confirmed.
- **Files (tracked):** packages/studio/sanity.config.js · packages/studio/sanity.cli.js · packages/studio/.env.example (new) · apps/psg-hub/.env.example. **Gitignored (not committed):** apps/psg-hub/.env.local (appended) · packages/studio/.env.local (new). **Sanity cloud:** project `vcw0bsnu` + private `production` dataset + deployed schema (4 types).
- **Not committed yet** — branch `chore/phase-3-integrations` (operator commits at/after UNIFY).

### APPLY 03-04 execution log (for UNIFY) — NEW-project pivot

- **Decision (checkpoint:decision) — operator chose NEW Vercel project over re-link `data`.** Backed by live read-only verify + a 4-agent adversarial workflow: `data` = 33d non-customer portal, **last 9h all `Error` deploys**, NO custom domain, env = 4 portable Supabase keys, no integrations/cron/storage, speedInsights hasData:false → D54's "preserve analytics history" premise hollow. NEW project also avoids the clobber-window (git-armed `main` on a routeless `main`) — REAL_LOCKIN/high finding favored NEW. AC-2 re-spec'd in PLAN; STATE decision logged. `data` left untouched → retired in 03-05.
- **Task 1 (auto) — DONE/PASS (AC-1):** local clean prod build green from monorepo — submodule Gotham/Didact (`packages/ui/psg-brand`) + PSG tokens resolve, `.next` produced, "Compiled successfully", Phase 3 webhook routes in route table. Recipe captured.
- **Task 2 (re-spec'd, CLI-automated):** NEW project **`psg-hub`** created (`prj_CBrI1FRqqgPzCbAwin6LbSknY48U`, team psg-digital), NOT git-connected. Root linked at repo root. **Production env = 13 keys wired via CLI** from gitignored `.env.local` (values never echoed): Supabase URL+ANON, SendGrid×3, Twilio×3 (PHONE_NUMBER path), `TWILIO_WEBHOOK_BASE_URL=https://hub.psgweb.me`, Sanity×4. Operator set Root Directory=`apps/psg-hub` + "Include source files outside Root Directory" in dashboard (API token = user/team scope only, no project-write). **Recipe gap found:** bare project defaulted Framework=**Other** → fixed via `apps/psg-hub/vercel.json` `{"framework":"nextjs"}` (a re-link would've inherited Next.js; this is the Task-1 vercel.json the plan reserved). `.vercelignore` (root, tracked) extended to exclude `archive/`+`psg-data-lake/`+`api-psghub/`+`apps/psg-ads-mutations/` (first deploy hit Vercel's 2 GiB upload cap — 3.12 GB; those dirs are archived local copies, canonical data in Supabase per operator). `turbo.json` build task `env[]` declared 8 Phase-3 server vars (+2 Supabase server + Messaging-Service alt) — silenced "vars WILL NOT be available" turbo warning + fixes build-env hashing.
- **Task 3 (checkpoint:human-verify) — deploy DONE, live-domain PENDING DNS:** `vercel --prod` from branch (uploads local checkout + initialized submodule) → **build green 42s**, framework=nextjs (Proxy middleware + static/dynamic routes), no turbo warning. Prod URL `psg-d2yjammel-psg-digital.vercel.app`, alias `psg-hub.vercel.app` + `hub.psgweb.me` (assigned). **Render verified at alias:** `/login` HTTP 200 fully branded (Gotham/Didact, PSG/Phoenix, ember/midnight tokens), `/dashboard` 307→/login (auth, no 404/no 500 — "500" in HTML = `fontWeight:500`), `/` 307→/login. **AC-3 render half MET.** Custom-domain half PENDING: `hub.psgweb.me` has a stale A record → `5.161.189.118` (Hetzner); operator must update Cloudflare A → `76.76.21.21` (DNS-only) for Vercel to verify + issue cert.
- **Deferred (carried):** Preview env (psg-hub not git-connected — wire post-03-05 git connect); `SUPABASE_DB_URL`+`SUPABASE_SERVICE_ROLE_KEY` (server-only, not needed for render ACs → 03-05 webhook persistence); private-submodule GitHub-app grant (CLI deploy uploads local checkout → grant only needed when git auto-deploy connects, post-03-05). Deferred 03-01 (email_events row) + 03-02 (Twilio sig-verify) webhook live-verifies remain OPEN → 03-05.
- **Tracked files changed (not committed):** `apps/psg-hub/vercel.json` (new), root `.vercelignore` (+excludes), `turbo.json` (+build env), `.paul/` docs. **No app source / 03-01/02/03 code / submodule / next.config.ts touched** (boundaries held).

### APPLY 03-05 execution log (for UNIFY)

- **Task 1 (auto) — DONE/PASS (AC-1):** Wired `SUPABASE_SERVICE_ROLE_KEY` to Vercel `psg-hub` Production via CLI stdin from gitignored `apps/psg-hub/.env.local` (`grep | cut | vercel env add … production` — value never echoed; CLI auto-stripped trailing newline). Redeploy `vercel --prod` from branch `chore/phase-3-integrations` → READY (dpl_F7TkrPSxW1LsUp3vxCSbygwTSTnF), aliased hub.psgweb.me. Verify: `vercel env ls production` shows `SUPABASE_SERVICE_ROLE_KEY` (Production); routes live `POST /api/webhooks/{sendgrid,twilio}`→400, `GET`→405. (Note: `curl` not on shell PATH → used `/usr/bin/curl`.) `SUPABASE_DB_URL` intentionally NOT wired (service.ts uses supabase-js).
- **Task 2 SendGrid (checkpoint:human-action → auto-verify) — DONE/PASS (AC-2, closes 03-01):** Operator set signed Event Webhook URL → `https://hub.psgweb.me/api/webhooks/sendgrid` ("sendgrid set", no key change). Baseline `email_events` = 11 rows @ max 21:09:42Z. Triggered `node --env-file=.env.local scripts/send-test-email.mjs` → 202, msg-id `2GBMbxLcRQ6KpgCJkM6NAg`. Poll (Supabase MCP execute_sql on `gylkkzmcmbdftxieyabw`): new row `sg_event_id=QyqVCvCXS12H7Y8MoqrxxQ`, `event=open`, `message_id=2GBMbxLcRQ6KpgCJkM6NAg.recvd-…`, `created_at=21:11:17Z`. Persisted row ⇒ ECDSA sig verified (signed webhook + correct key) AND service-role write OK. **email_events cols:** id, sg_event_id, event, email, message_id, payload, occurred_at, created_at.
- **Task 3 Twilio (checkpoint:human-action → auto-verify) — DONE/PASS (AC-3, closes 03-02):** Operator set number +19735325352 "A MESSAGE COMES IN" → `https://hub.psgweb.me/api/webhooks/twilio` (exact, no trailing slash) + texted inbound ("twilio set + texted"). Poll `sms_events`: new row `message_sid=SM0176a4c430f9521e25b45f4baad93ee2`, `status=received`, `direction=inbound`, `from=+18479092140`, `to=+19735325352`, `created_at=21:13:59Z`. First-ever sms_events row (03-02 live send was outbound script, no callback). Persisted ⇒ `twilio.validateRequest` passed (HMAC over env-reconstructed URL + parsed params; else 403) + URL recon matched + inbound dual-path branch fired.
- **Task 4 Decommission (checkpoint:decision) — DONE_WITH_CONCERNS/PASS (AC-4):** Read-only enumeration (Vercel CLI + REST API, token from auth.json, never echoed; `UID` is a readonly shell var → used `DEP`). Only team = `psg-digital` (1 team); personal account = 0 projects. **`data` project (`prj_dOxaaZubzVRDy9NlpA2qeoI0WEfx`) = HTTP 404 (deleted).** No `bsm`/`ads-dashboard` project exists anywhere → D54 targets already retired. 9 live projects: `psg-hub`→data repo (ours), `psg`→portal.psgweb.me (repo `nmschoolcraft/psg`, NOT monorepo), + 7 unrelated client/site projects (ccs, mscra, plc, providence, square-one, import, psg-supreme-strategy-brief) — all survivors, untouched. **NO destructive action taken (none needed).** Operator decision: **KEEP** `psg-hub`↔`Phoenix-Solutions-Group/data` git connection (intended active stack). **PROVEN concern:** git deploy `dpl_2Mbq7SnQ26gMHdHS8B1bFPyh56RQ` (branch push 20:47) ERRORED — `Font file not found: …packages/ui/psg-brand/fonts/{DidactGothic-Regular.ttf,Gotham-Book.otf}` — private submodule not init'd on git builds (GitHub-app lacks `design-system` access). Carry-forward gates main-merge.
- **Gates:** No code/schema/test changes (config + verification only). Boundaries held (app source, submodule, schema, the 13 prior env keys all untouched; only ADDED service-role key). No secret echoed.
- **Files changed:** Vercel-side only (1 prod env key added) + `.paul/STATE.md` (this log). No repo source files.

## Phase 3 Plan Split (5-plan subsystem, 2 waves) — re-split 4→5 2026-06-01

| Plan | Scope | Wave | Deps | Status |
|------|-------|------|------|--------|
| 03-01 | SendGrid: shared resilience util + mail adapter + idempotent event webhook + `email_events` table; operator domain-auth (SPF/DKIM/DMARC) + live-send checkpoint | 1 | none | ✅ LOOP CLOSED (163 tests green; live send 202 verified; webhook-row deferred → 03-05; SUMMARY written) |
| 03-02 | Twilio: SMS adapter (reuses `src/lib/resilience.ts`) + idempotent dual-path webhook + `sms_events` table; operator number + secrets checkpoint | 1 | none | ✅ LOOP CLOSED (182 tests green; live send queued + phone receipt; webhook live sig-verify deferred → 03-05; SUMMARY written) |
| 03-03 | Sanity: provision new project + single prod dataset (D55) under PSG org; decouple `@psg/studio` from BSM `436nqu7v` (env-driven config); publish env contract (studio + hub). Tight scope — read client deferred v0.3; no migration (start fresh, D57) | 1 | none | ✅ LOOP CLOSED (project `vcw0bsnu`, private prod dataset, schema deployed 4 types, studio bound; 182 tests green; AC-1/2/3 met; SUMMARY written) |
| 03-04 | Vercel deploy: **PIVOTED re-link→NEW project** (operator checkpoint:decision — `data` broken/non-customer, re-link would arm routeless-main clobber). Created `psg-hub` (`prj_CBrI1FRqqgPzCbAwin6LbSknY48U`), root `apps/psg-hub`, framework Next.js (vercel.json), 13 prod env keys via CLI, `hub.psgweb.me` + Cloudflare DNS → FIRST prod deploy. `data` untouched (retire in 03-05). | 2 | 03-01,03-02,03-03 | ✅ LOOP CLOSED (all 3 ACs; psg-hub LIVE at https://hub.psgweb.me, branded, cert; webhook routes live; SUMMARY written) |
| 03-05 | Close deferred webhook loops + decommission: wire `SUPABASE_SERVICE_ROLE_KEY` to prod + redeploy → SendGrid Event Webhook + Twilio messaging webhook live-verified against `hub.psgweb.me` → real `email_events` row (closes 03-01) + `sms_events` row (closes 03-02) + D54 decommission confirmed (data 404; no BSM/ads-dashboard project). Closes Phase 3. | 2 | 03-04 | ✅ LOOP CLOSED (all 4 ACs; both webhooks live-verified with real rows; decommission by-verified-state; KEEP psg-hub↔data git connect; merge-blocker = submodule grant; SUMMARY written) |
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
| 2026-06-01: Sanity integration (03-03, D55) — new project **`vcw0bsnu`** ("psg-hub") under org PSG `oqyhOHQtc`, single `production` dataset set **private**; `@psg/studio` config decoupled from BSM `436nqu7v` → env-driven (`SANITY_STUDIO_*`); schema deployed (4 types); NO migration from BSM (sample-only, D57); NO psg-hub read client (deferred v0.3) | Phase 3 / 03-03 | content backend live + isolated from BSM; env contracts published (studio + hub `.env.example`); read token in gitignored `.env.local`, write token discarded (revoke recommended); Vercel env + CORS host → 03-04 |
| 2026-06-01: **03-04 checkpoint:decision — operator chose NEW Vercel project `psg-hub` instead of re-linking `data`** (supersedes D54's rename *mechanism*; D54 intent preserved) | Phase 3 / 03-04 | Live read-only verify falsified the re-link premise: `data` = 33d-old NON-customer portal (PROJECT.md), git-connected + auto-deploying, but **last 9h of deploys ALL `Error`** (last good 4d ago) → "preserve analytics history" preserves a hollow, currently-broken history. NEW project: (a) avoids the clobber-window (no `main` auto-deploy armed against routeless `main`), (b) needs NO GitHub-app submodule grant now (`vercel --prod` from branch uploads the initialized local checkout), (c) fits team norm (11 subdomain-per-project apps). `data` left untouched → retired alongside BSM in 03-05. AC-2 re-spec'd: re-link+rename → create+configure new project; AC-1/AC-3 unchanged. |
| 2026-06-01: **03-05 decommission (D54) satisfied by current state — no action needed.** `data` project (`prj_dOxaaZubzVRDy9NlpA2qeoI0WEfx`) = HTTP 404 (already deleted); NO distinct BSM or ads-dashboard Vercel project exists (team `psg-digital` + personal both enumerated). | Phase 3 / 03-05 | D54 cleanup complete; 8 survivors untouched. The 03-04 worry that `data` would clobber-deploy on main-merge is moot (deleted). |
| 2026-06-01: **03-05 checkpoint:decision — KEEP `psg-hub`↔`Phoenix-Solutions-Group/data` git connection** (operator: "we are using psg-hub Vercel + data GitHub"). Supersedes 03-04's "psg-hub NOT git-connected" record (operator connected it during pre-migration). | Phase 3 / 03-05 → transition | psg-hub auto-deploys `main` via git. **Gating carry-forward (PROVEN):** git build fails on private `psg-brand` submodule fonts (deploy dpl_2Mbq7… ERRORED) until Vercel GitHub-app is granted access to `Phoenix-Solutions-Group/design-system`. Must grant BEFORE Phase-3→main merge or the main deploy errors + won't promote (last good CLI deploy keeps serving). CLI `vercel --prod` remains the working deploy path meanwhile. |

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
| **Vercel git build fails on private `psg-brand` submodule (fonts not found) — PROVEN (dpl_2Mbq7…)** | 03-05 enum | S | **BLOCKS phase-transition: grant Vercel GitHub-app access to `Phoenix-Solutions-Group/design-system` BEFORE merging Phase 3 → main.** psg-hub is git-connected to data@main; CLI deploys work (upload local submodule) but git/main deploys error until grant. |
| Wire `SUPABASE_DB_URL` + (later) preview env on psg-hub | 03-04/03-05 | XS | When a pg-pool consumer or git preview deploys are needed (not webhooks — those use supabase-js) |

### Blockers/Concerns
None blocking Phase 2 (confirmed by readiness audit below). Open follow-ups tracked in Session Continuity + the audit's operator-decision list.

### Phase 1 Readiness Audit — 2026-05-31 (9-agent adversarial verify)
Verdict: **GO for Phase 2.** All 7 Phase-1 plans verified loop-closed in-repo; secrets clean (only `.example` tracked); zero Phase-2 blockers.
- 01-01/03/04/05/06/07 → verified vs filesystem. 01-04 trivial off-by-one (60 vs 61 entries).
- **01-02 → residue-found (OUTSIDE repo) — RECORDS CORRECTED 2026-05-31:** 3 of 9 intended relocations never ran — `~/apps/CFO` (101M), `~/apps/governance` (48K), `~/apps/obsidian-vault` (77M) still at original `~/apps/` paths, NOT in `~/apps/_psg-archive/`. Operator chose "correct the records" → MANIFEST.md moved them to a "NOT relocated" section + 01-02-SUMMARY AC-3 downgraded PASS→PARTIAL with a correction banner. The 3 dirs left in place (active workspaces); relocate-vs-leave still open at operator's convenience. No Phase-2 impact.
- **Cleaned this session (claude-now):** pruned 2 dead `local-reach-content/.claude/worktrees/` registrations; deleted 2 abandoned orphan branches (`claude/goofy-kepler-f3c13d`, `claude/thirsty-dubinsky-788ccb`, both contained in origin/main).
- **Tracking findings:** (1) `apps/psg-ads-mutations/ops/*/ad-assets/` = 51M binary creative in `091cce6` → operator decided **KEEP permanently** (item closed). (2) `psg-data-lake/` = 63 source files tracked despite dead `/psg-data-lake/` gitignore rule (no own .git → leave tracked; rule is just misleading — left as-is).

### Git State
- Last commit: `103e532` — "pre-migration: workspace state, paul docs, sanity config" (operator snapshot, authored by Nick 2026-06-01 14:05, PUSHED to origin). Contains the **03-03 code** (studio configs env-driven, both `.env.example`, 03-03-PLAN, ROADMAP) PLUS `.base/data/*` + `.base/workspace.json`. NOTE: this operator commit (a) used a generic message rather than the `feat(psg-hub): … 03-03` convention, and (b) tracked `.base/*` — reversing the prior "`.base/*` excluded" convention from 98c3125/01daead. Left as-is (operator-authored + already on origin; not rewritten). 03-03 closing docs (SUMMARY + loop-closed STATE) committed on top.
- Phase 3 branch `chore/phase-3-integrations`: PUSHED to origin (tracks `origin/chore/phase-3-integrations`). Contains `98c3125` (03-01) + `01daead` (03-02) + `103e532` (operator pre-migration snapshot incl. 03-03 code + .base) + 03-03 docs commit. Merges to `main` at Phase 3 transition (after 03-04).
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
Stopped at: **Phase 3 ✅ COMPLETE (5/5 plans loop-closed) — transitioned to Phase 4.** 03-05 loop-closed: SUPABASE_SERVICE_ROLE_KEY wired + redeploy; SendGrid live-verified (email_events row, event=open, msg-id match → closes 03-01); Twilio live-verified (sms_events inbound row, +18479092140→+19735325352 → closes 03-02); D54 decommission confirmed by verified state (data=404, no BSM/ads-dashboard project); operator decision=KEEP psg-hub↔data git connection. SUMMARY written. PROJECT.md + ROADMAP.md evolved.
Next action: `/paul:plan` for **Phase 4 (PAUL inheritance + tracking)** when ready. **GATED prod sequence (operator) before/at Phase-3→main merge:** (1) grant Vercel GitHub-app access to `Phoenix-Solutions-Group/design-system` (private submodule — PROVEN merge-blocker dpl_2Mbq7…), THEN (2) merge `chore/phase-3-integrations`→main → psg-hub auto-deploys main via git. Post-merge: git Preview env + `SUPABASE_DB_URL` (only when a pg-pool consumer needs it). Branch `chore/phase-3-integrations` holds Phase 3; CLI `vercel --prod` is the working deploy path until the grant.
Resume file: `.paul/ROADMAP.md` (Phase 4 entry) + `.paul/phases/03-integrations/03-05-SUMMARY.md`.
Resume context:
- Phase 2 closed: submodule `packages/ui/psg-brand/` @`1689896`; PSG tokens (midnight/ember/paper, 6px) + Gotham/Didact fonts; `<Logo>` + DS-spec button/label/card/badge/table; branded `/login` + `/signup` + navy app shell; `/dashboard` 404 fixed (route group `(dashboard)`→ segment `dashboard`); de-BSM app-wide; legacy DS docs superseded.
- 03-04 wiring checklist (env to add in Vercel Prod+Preview; do NOT clobber existing Supabase): SendGrid (SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, SENDGRID_WEBHOOK_VERIFICATION_KEY) · Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID|TWILIO_PHONE_NUMBER, TWILIO_WEBHOOK_BASE_URL=https://hub.psgweb.me) · Sanity (NEXT_PUBLIC_SANITY_PROJECT_ID=vcw0bsnu, NEXT_PUBLIC_SANITY_DATASET=production, NEXT_PUBLIC_SANITY_API_VERSION=2026-06-01, SANITY_API_READ_TOKEN). Existing on `data`: SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL/ANON_KEY (Prod; anon+url also Dev) — add Preview where missing.
- Phase 3 carry-overs (still live): Gotham = Adobe Typekit-licensed → self-hosting `.otf` flagged (submodule ships them; build proves resolution in 03-04 Task 1); old bare root URLs (`/content`, `/ads`) now 404 post route-rename (matters when 03-05/later wires email links).
- Deferred (non-blocking): Phase 2.x compose route-page interiors to DS layout vocabulary; active-nav highlight (needs a small client nav component); 01-02 out-of-repo archival (CFO/governance/obsidian-vault relocate-or-leave; records corrected).
- Git: Phase 1 + Phase 2 both on `main` (pushed; home repo `github.com/Phoenix-Solutions-Group/data`, tip `54e53f0`). Branch `chore/phase-2-design-system` fully merged (0 ahead / 0 behind).

---
*STATE.md — Updated after every significant action*
