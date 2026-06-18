# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-05-29)

**Core value:** Consolidates fragmented PSG tooling into one branded `hub.psgweb.me` surface that customers, internal staff, and superadmins all use — replacing logins and tooling sprawl with role-gated unified access.

**Current focus:** **v0.4 Invoicing + Payments** (the v1.0 customer-launch milestone; Phases 15-18). Let a collision-repair shop see and pay everything it owes PSG — one-off invoices + the recurring platform subscription — then clear the launch gates (M3 reproducible deploy, S6 Gotham/Typekit license, S2 pilot onboarding). **Money-before-M3 invariant:** billing BUILDS in Phases 15-17; live charge acceptance activates ONLY at the Phase-18 launch gate (after M3). Prior milestones v0.1 / v0.2 / v0.3 / v0.3.5 all ✅ COMPLETE + CLOSED (see ROADMAP Completed Milestones + MILESTONES.md).

## Current Position

Milestone: **v0.4 Invoicing + Payments — 🚧 IN PROGRESS** (created 2026-06-18; Phases 15-18; 0 of 4 phases complete).
Phase: **15 — Billing foundation + Stripe spine — 🚧 IN PROGRESS (1 of 3 plans loop-closed).** Build-local → operator-gate pattern (mirrors Phases 9-14); EXTEND-not-build. BSM already wired Stripe checkout/portal/webhook/`subscriptions` on this repo, but it was UNVERIFIED on prod + carried 3 known defects (S3 `.insert()`, Basil `current_period_end`, vestigial `shops.subscription_tier`). Research gate ✅ (`research/phase-15-billing-foundation-stripe-spine.md`, 2026-06-18). **Decisions (operator):** invoicing = Stripe-native (Invoiced.com dropped); invoices/payments = financial-record-only (PII stays in Stripe, fetched on demand; PII-at-rest ships as infrastructure, no populated columns); all 3 plans build-local, prod apply/deploy = a SEPARATE gate plan authored after the build-local plans close.
Plan: **15-01 ✅ LOOP CLOSED 2026-06-18** (webhook spine; committed + pushed `3a9c113`). 15-02 (invoices/payments) + 15-03 (PII-at-rest infra) PLANs created, not started.
Status: **🚧 v0.4 Phase 15 in progress; 15-01 shipped build-local to main. No active loop (between plans).**

## Loop Position

**▶ v0.4 Phase 15 — 15-01 ✅ LOOP CLOSED; 15-03 + 15-02 not started. No active loop.**

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [15-01 webhook spine — LOOP CLOSED 2026-06-18; committed+pushed 3a9c113]
```

Phase-15 plan map: **15-01** webhook spine ✅ (Wave 1) · **15-03** PII-at-rest infra ○ (Wave 1, parallel-eligible) · **15-02** invoices/payments + handlers ○ (Wave 2, depends 15-01). After all 3 loop-close → the Phase-15 transition fires (PROJECT/ROADMAP evolve + phase commit) and the separate prod gate plan is authored.

## Accumulated Context

### Decisions

Full set of 70 decisions in `../../projects/psg-hub/PLANNING.md` (v7). Active / recent decisions:

| Decision | Phase | Impact |
|----------|-------|--------|
| 2026-06-18: **Phase 15 = 3 build-local plans + a later separate prod gate plan; invoices/payments are financial-record-only.** Operator-confirmed via AskUserQuestion: billing name/email/address stay in Stripe (fetched on demand); PII-at-rest ships as infrastructure (private `sensitive` schema + `log_pii_access` + on-demand 7yr redact sweep + generic `encryptField` over `crypto.ts`) with NO populated PII columns; invoicing is Stripe-native (Invoiced.com dropped). 15-01 refinements: idempotency skip gates on `processed_at` (retry-safe) not empty-RETURNING alone; subscription upsert `onConflict=shop_id` (shop_id UNIQUE + 1 shop:1 sub MoR), refining research §1.2. | Phase 15 / 15-01 | The billing foundation is correct-by-construction before 16/17 build on it. Migrations authored-not-applied; prod apply = the Phase-15 gate batch (verify live Stripe state — endpoint registration / live-vs-test keys / real subscriptions — at that gate). |
| 2026-06-17: **GBP OAuth client = a SEPARATE app (operator infra), NOT the shared psg-google-ads client.** Surfaced at the 14-04 live Wallace link as `redirect_uri_mismatch`. FIX: `gbpOAuthClientEnv()` (reads GOOGLE_GBP_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI, falls back to shared) threaded through the GBP libs + cron guards (12 files); GA4/GSC/Ads UNTOUCHED; 3 new prod env vars. | Phase 14 / 14-04 | GBP authenticates on the n8n-workspace-apis client; Wallace linked LIVE. Supersedes 13-04's wrong "NO new secret". |
| 2026-06-17: **review_items requires an internal `public.locations` row per shop (NOT NULL FK), but onboarding never creates one.** Backfilled Wallace's primary location. | Phase 14 / 14-04 | Unblocked Wallace ingest → 385 reviews live. SYSTEMIC: every other shop skips review ingest until a `locations` backfill (fleet step before rollout). |
| 2026-06-17: **Phase-14 reviews vertical closed LIVE on real Wallace data** — 385 reviews via v4 per-review ingest; sentiment classifier proven live (D2 gateway-Haiku smoke). | Phase 14 / 14-04 | Reviews LIVE. Remaining: sentiment backfill auto-runs on the gbp-reviews-sync cron; D3 7-day token pass-gate; ROTATE the chat-exposed GBP client secret; 14-02b reply-publish (legal) + 14-03b sentiment surface deferred. |
| 2026-06-16: **14-02 GBP reply-publish consent model = "operator click + recorded per-shop authorization"** (vs end-client-only). **REQUIRES EXPLICIT LEGAL SIGN-OFF** (Google policy bars automate-or-trigger replies without the end-client's prior express consent). RECORDED only; NO consent schema built in 14-02. | Phase 14 / 14-02 | Named follow-up **14-02b / gate batch** owns the per-shop authorization record + per-reply consent schema, approve-gate handling, UI publish button, and live activation. Zero live publish until that lands + legal signs off. |
| 2026-06-16: **13-04 (Phase-13 GBP) closed ACTIVATION-PENDING; migrations applied via MCP `apply_migration`, not `db push`.** Remote history proves the prod precedent (12-05a/b); the approved plan + precedent supersede the 06-01 PROTOCOL §2 read-only-MCP text. | Phase 13 / 13-04 | 3 source-CHECK migrations live on prod (advisor 124→124 ×3) + gbp crons deployed. Wallace live link + the empirical 7-day token pass-gate gated on Gate A/B (shared with Phase 14). |
| 2026-06-13: **12-05c closed ACTIVATION-PENDING** rather than rotate CRON_SECRET for a live smoke. GA4-dims + perf readers wired into the PRINT path ONLY (narrative binding untouched — eval-safe). | Phase 12 / 12-05c | Closed Phase 12 + milestone v0.3 on the live base report. The 12-05 expansion is deployed + DB-ready, auto-activates July 1; build-blind-parser section-correctness verification owed before/right-after July 1 (Deferred Issues). 12-05c parser validation since DONE 2026-06-18 (GA4-dims + PSI-lab validated live; PSI diagnosability fix `c104227`). |
| 2026-06-04: **08-03 AEGIS triage — remediate in-scope hygiene now; DEFER Stripe/billing cluster (S3 `.insert`, F-03-1, F-02-1/2) → v0.4 Invoicing+Payments; PII-at-rest retention/redaction → v0.4 privacy pass; audit-log → v1.5.** REFUTED: cross-tenant content write + webhook crash. | Phase 8 / 08-03 | First AEGIS pass: no launch-blocking finding on the v0.2 customer surface. The deferred billing/PII cluster is now Phase-15 scope (15-01 S3 + Basil; 15-03 PII-at-rest). |
| 2026-06-02: **Phase 6 RLS forks RESOLVED** — no-hook in-DB security-definer subquery (D2=b) + shared-mutate on `gylkkzmcmbdftxieyabw`, public schema (D1=A1); 26 anon policies deferred → Phase 8 (done in 08-02); per-shop MSO grain; `profiles.role` vestigial (`app_user_roles` 3-role authoritative); superadmin bootstrap = Nick only. | Phase 6 / 06-01 | The current RBAC/RLS architecture. `app_user_roles` (customer/psg_internal/psg_superadmin), greenfield `security_profiles(functions_jsonb)`, `superadmin_emails`, `current_user_role()`/`current_user_has_fn()` security-definer subqueries in `private`. |
| 2026-06-08/09/10 (Phases 10-11): **refresh tokens encrypted at rest with the inherited AES-256-GCM app-key (`ADS_ENCRYPTION_KEY` map), NOT pgsodium.** Recorded deviation from the PROJECT pgsodium constraint; Phase 11 inherited it; Phase 15 PII-at-rest reuses the same `crypto.ts`. | Phases 10-11 (→15) | Established encryption pattern across Google Ads / GA4 / GSC / GBP OAuth tokens and now billing PII infrastructure. |
| Standing: **D52** Python worker = Vercel Sandbox (v1.2/v1.6) · **D53** mail dual adapter Lob + in-house (v1.3) · **D60** no fixed launch date (quality-first) · **D61** pilot cohort = Wallace + Tedesco + Tracy's · **D62** strictly sequential post-v1.0 (single team) · **D70** ads-dashboard absorbed as plans/concepts only (not code). | future milestones | Forward-roadmap constraints. |
| Earlier v0.1-v0.2 + Phase-3 infra execution decisions (local_reach archive, monorepo collapse, Sanity `vcw0bsnu` provisioning, the Vercel new-project/submodule saga, SendGrid/Twilio resilience util, 04-01 PAUL inheritance, 08-02/08-04 RLS+coverage+WCAG gates) | v0.1-v0.2 | Closed phases — full detail in the per-phase SUMMARYs + PLANNING.md v7. Vercel/submodule decisions superseded by the current Repo / Deploy Reality below (brand assets vendored, no submodule). |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| **⭐ July 1 build-blind-parser section verification (12-05c activation-pending)** | 12-05c Stage C skipped | S | **Before/right-after the July 1 monthly crons (`0 2`/`0 3`/`0 5` on the 1st).** GA4-dims + perf ingests first run live UNMONITORED that day; the scheduled agent `trig_01G7MfA382AUXYTYXnc5Knvk` checks SEND, not new-section correctness. Pull the Wallace July PDF + confirm the 4 GA4 sections + Website-performance block render. |
| Report-pipeline deploy gap (operator commit `1249a21`, 2026-06-13) | post-v0.3 close | S | Adds migration `20260613000000_monthly_reports_claim.sql` + atomic send-claim + renderer SSRF guard. Confirm before July 1: (1) claim migration applied to prod? (2) deploy main so the hardening goes live (migrate first — route code expects the claim table). |
| Secret rotation — chat-pasted secrets | 12-04 + 12-05c | XS | Rotate: Hetzner token, AI Gateway key (vck_), SendGrid key (SG.), `PAGESPEED_API_KEY` (AIza…), `GTMETRIX_API_KEY`. CRON_SECRET is Vercel-Sensitive (un-pullable). Also rotate the chat-exposed GBP client secret (14-04). |
| Fleet-scale (842-shop) performance batching | 12-05b/c | M | Post-v0.3. PSI + GTMetrix in-loop poll (~80s/shop) × fleet blows the 300s Fluid ceiling + GTMetrix daily credit cap. Pilot scoped via `GTMETRIX_SHOP_IDS`; fleet needs queueing + credit budgeting. |
| Peec AI (AI share-of-voice) + Local Falcon (local maps/SoLV) ingestion | 12 RESEARCH | M | Post-v0.3 follow-on milestone — the remaining canon-report sources. |
| End-consumer PII retention policy | SEED v7 | S | Folded into Phase 15 / 15-03 (PII-at-rest infra + the 7yr redact-don't-delete retention spec). |
| FileMaker historical migration scope (Q15) · First-login UX · Domain coexistence (`hub` + `psgweb.me` marketing) | SEED v7 | M/S | v1.3.5 add-on / v2.0 hardening / v2.0 launch readiness. |

📋 Live backlog also tracked in `.paul/DEFERRED.md` (Security · v0.3.5 activation tail · quality/scale ceilings · time-bound watch).

### Blockers/Concerns
- **⭐ Phase 13/14 GBP activation tail (shared, from 13-RESEARCH.md):** **Gate A** Business Profile API access (project quota 0 → 300 QPM, ~14-day Google review, per-GCP-project) · **Gate B** OAuth sensitive-scope verification for `business.manage` (app already In Production; while unverified, refresh tokens can be revoked 7 days post-consent — the Phase-10 failure mode). Phase 14 reviews shipped LIVE (385 Wallace reviews) so Gate A/B had cleared by 14-04; the empirical 7-day token pass-gate + the systemic `locations` fleet backfill remain before broad rollout.
- **v1.0 launch gates (carried to v0.4 Phase 18):** M3 reproducible deploy (currently CLI `vercel --prod`; auto-deploy off) · S6 Gotham/Typekit license (fonts vendored — license question) · S2 pilot onboarding.

## Git State

- **Current: `main == origin/main == 3a9c113`, in sync (0 ahead / 0 behind); working tree clean.** Repo `github.com/Phoenix-Solutions-Group/psg-hub.git`. Everything committed + pushed.
- **2026-06-18 — Phase 15 / 15-01 webhook spine** `3a9c113` `feat(15-billing-foundation): 15-01 webhook spine — idempotency + S3 upsert + Basil fix + tier reconcile` (range `b1a1672..3a9c113`, 12 files +1217/−51; gitleaks staged scan clean). Build-local — main auto-deploy is OFF, so this did NOT touch prod (migrations authored-not-applied, no live keys; consistent with money-before-M3). Prior `main` HEAD `b1a1672` (Phase-15 research + v0.4 milestone docs).
- **2026-06-18 (earlier)** — the v0.4 milestone + Phase-15 research/decision docs landed (`0f27f20` and prior); the operator's push caught origin up past the previously-local Phase-13/14 transition commits (`6e827cb`, `e70dbb4`) — all now on origin.
- Recent shipped phases on `main`: v0.3.5 (Phase 13 GBP presence + Phase 14 reviews/sentiment, LIVE on prod — 385 Wallace reviews) · v0.3 (analytics + monthly report) · v0.2 (customer MVP) · v0.1 (foundation). Per-phase commit detail lives in the phase SUMMARYs + ROADMAP.
- **Deploy:** prod served by CLI `vercel --prod` from the repo root; **prod-on-`main` auto-deploy is OFF** (CLI deploy serves hub.psgweb.me).
- Tags: `v0.1.0`, `psg-hub-v0.2.0`, `v0.3.0`, `v0.3.5`.
- Ignored: `.next/`, `node_modules`, real secrets (`.env`, `google-ads.yaml`), `archive/` (3GB+ db + history bundles).

## Boundaries (Active)

Phase 15 (billing foundation):
- **Prod DB — migrations AUTHORED-NOT-APPLIED.** No MCP `apply_migration` / `db push` / prod write (prod apply = the Phase-15 gate batch under `phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md` with advisor baseline+diff).
- **Stripe live keys / webhook endpoint registration** — untouched until the Phase-18 launch gate (money-before-M3).
- **Billing UI tiers/prices** (`src/app/dashboard/billing/page.tsx`) + `src/lib/tier/gate.ts` behavior — untouched.
- No Stripe Connect (single-account MoR). Financial-record-only — no billing-PII columns on public tables.
- Shared prod Supabase `gylkkzmcmbdftxieyabw` (~314k PII rows / 142 shops) — migration-safety protocol binding.

## Session Continuity

Last session: 2026-06-18 — **Phase 15 planned, 15-01 applied + closed + pushed, then STATE.md cleaned up.** `/paul:plan Phase 15` (research gate satisfied; 3 build-local plans created — operator-confirmed financial-record-only + 3-plan split via AskUserQuestion) → `/paul:apply 15-01` → `/paul:unify 15-01` (✅ LOOP CLOSED; 15-01-SUMMARY.md) → committed + pushed `3a9c113` to origin/main → cleaned up STATE.md (cut ~575 lines of closed-loop APPLY execution-log scaffolding + run-on prose chains; corrected stale repo/git facts; preserved Decisions / Deferred / Blockers).
Stopped at: **15-01 ✅ LOOP CLOSED + on origin/main `3a9c113`; Phase 15 = 1 of 3 plans.** main in sync, working tree clean (after the cleanup commit).
Next action: **`/paul:apply 15-03`** (PII-at-rest infra — Wave 1, independent) + **`/paul:apply 15-02`** (invoices/payments — Wave 2, 15-01 dep satisfied). After all 3 close → Phase-15 transition + author the separate prod gate plan (at that gate, VERIFY live Stripe state — endpoint registration / live-vs-test keys / real subscriptions; research flags "unverified on prod").
Resume files: `.paul/phases/15-billing-foundation/` (15-01-SUMMARY + 15-02/15-03 PLANs) · `.paul/ROADMAP.md` (v0.4 phases 15-18) · `.paul/research/phase-15-billing-foundation-stripe-spine.md` · `.paul/DEFERRED.md` (live backlog).

## Repo / Deploy Reality (current — supersedes the 2026-06-02 psg-internal-era reconcile)

- **Remote:** `origin = github.com/Phoenix-Solutions-Group/psg-hub.git`. psg-hub is its OWN repo (split out of the former `psg-internal` monorepo). Git root = `/Users/schoolcraft_mbpro/dev/psg/internal/psg-hub`; the app lives at `apps/psg-hub/`. Branch `main`.
- **Brand assets:** `packages/ui/psg-brand` is a plain vendored dir (Gotham/Didact fonts tracked as real blobs) — NO `.gitmodules`, no submodule. The old "Vercel can't fetch private submodule" build blocker cannot recur.
- **Vercel:** project `psg-hub` (team `psg-digital`), rootDirectory `apps/psg-hub`. Prod served by CLI `vercel --prod` from the repo root (a `.vercel` exists at both the repo root and `apps/psg-hub` — run from the root). prod-on-`main` auto-deploy is OFF.
- **Supabase:** shared prod project `gylkkzmcmbdftxieyabw` (~314k PII rows / 142 shops). Migrations applied via MCP `apply_migration` under PROTOCOL-migration-safety.md with advisor baseline+diff.
- **Local secret files (chmod 600):** `~/.psg-{hetzner-token,render-token,ai-gateway-key,sendgrid-key,report-template-id}`, `~/.psg-cron-secret`; SSH `~/.ssh/psg-report-renderer`.

---
*STATE.md — updated after every significant action. Cleaned up 2026-06-18 (cut closed-loop APPLY execution logs + run-on history; per-phase detail lives in the phase SUMMARYs, ROADMAP Completed Milestones, MILESTONES.md, and DEFERRED.md).*
