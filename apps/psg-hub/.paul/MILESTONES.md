# Milestones

Completed milestone log for psg-hub.

| Milestone | Completed | Duration | Stats |
|-----------|-----------|----------|-------|
| v0.3 Customer Analytics | 2026-06-13 | ~9 days | 4 phases, 18 plans |
| v0.2 Customer MVP | 2026-06-04 | ~2 days | 3 phases, 14 plans |
| v0.1 Foundation | 2026-06-02 | ~4 days | 5 phases, 18 plans |

---

## ✅ v0.3 Customer Analytics (v0.3.0)

**Completed:** 2026-06-13 (all 4 phases loop-closed)
**Duration:** ~9 days (2026-06-04 milestone start → 2026-06-13 close)

### Stats

| Metric | Value |
|--------|-------|
| Phases | 4 (9 Analytics foundation + SEMrush · 10 Google Ads · 11 GA4 + GSC · 12 PSG report) |
| Plans | 18 (9:3 · 10:4 · 11:4 · 12:7) |
| Files changed | Large — analytics surface + 4 ingest verticals + the report pipeline + an in-repo Hetzner Chromium worker |

### Key Accomplishments

- Built the reusable analytics surface ONCE and proved it with the lowest-friction source: source-agnostic `analytics_snapshots` data model + Recharts brand chart primitives + `/dashboard/analytics` (per-shop + MSO summable-only aggregate, switcher typeahead, LCP gate), surfaced with a contract-correct SEMrush daily ingest (Phase 9, LIVE on prod for the 4 url-shops).
- Provisioned the missing `google_ads_*` tables, wired the already-built OAuth + GAQL metrics sync, and added MCC account-selection (callback enumerates the manager's client accounts) — Wallace pilot real paid metrics LIVE (Phase 10).
- Shared per-shop Google OAuth (one combined `analytics.readonly` + `webmasters.readonly` consent → one AES-256-GCM-encrypted refresh token linking a GA4 property + a GSC site) + GA4 and GSC daily ingests + panels — Wallace real GA4 (sessions/users/engagement) + GSC (clicks/impressions/position) LIVE (Phase 11).
- Shipped the CORE v0.3 output — the automated PSG monthly client report: a multi-LLM narrative (AI SDK v6 via Vercel AI Gateway) behind a 4-stage eval gate (schema → numeric-groundedness → brand-lint → judge) that grounds every numeral by token-substitution and never auto-emails an unverified report; a branded PDF rendered on a controlled Hetzner Chromium worker (Vercel Fluid can't launch headless Chromium); private Supabase bucket + membership-gated download + SendGrid link-email. LIVE since 12-04, activation-verified end-to-end on the Demo shop; first real send fires the July 1 cron (Phase 12).
- Added the GA4-dimensional (Top Traffic Drivers / Landing Pages / Device / New-vs-Returning + bounce rate + avg session duration) and real website-performance (PSI lab + CrUX-field + GTMetrix) expansion that replaces the old report's bogus GA4 "server response 14:49"; deployed + DB-ready, closed activation-pending (auto-activates July 1; build-blind-parser section-correctness verification owed).
- Four live ingest sources on prod with real Wallace pilot numbers; two activation-blocking prod bugs caught + fixed at the 12-04 live smoke (eval-gate google_ads mis-ground that held every report; SendGrid click-tracking cert that broke the email link).

### Key Decisions

- Narrative grounding by token-substitution (writer emits `{{placeholder}}` tokens, a deterministic verifier substitutes real numbers; the eval gate blocks/regenerates/holds, never a false pass) — makes "no hallucinated numerals" provable.
- Render the report PDF on a Hetzner Chromium worker over HTTP, not on Vercel (RESEARCH refuted Vercel Fluid headless Chromium — libnss3 launch break); the app stays dependency-free (puppeteer only in the in-repo worker).
- Google refresh-token encryption = app-key AES-256-GCM (`bytea` + `key_version`), NOT pgsodium (Phase 10 decision, inherited by Phase 11) — accepted deviation from the PII/pgsodium constraint.
- GA4-dims + performance stay DB-only `SnapshotSource` values (CHECK migration), NOT added to the `AnalyticsSource` union; readers wired into the PDF print path ONLY, leaving the narrative/eval binding untouched (eval-safe).
- 12-05 expansion closed ACTIVATION-PENDING rather than rotate the un-pullable CRON_SECRET for a live smoke — base report live; expansion auto-activates July 1 (section-correctness verification owed; recorded in STATE Deferred Issues).

### Follow-ups carried past v0.3

- ⭐ July 1 build-blind-parser section-correctness verification (the GA4-dims + perf crons' first live run is unmonitored — the scheduled agent checks send, not section correctness).
- Rotate the chat-pasted secrets (Hetzner / AI Gateway / SendGrid + PAGESPEED + GTMETRIX).
- Fleet-scale (842-shop) performance batching; Peec AI + Local Falcon ingestion (the remaining canon-report sources) → post-v0.3.

Archive: `.paul/milestones/v0.3.0-ROADMAP.md`. Phase landed on main via merge `37359c8` (pushed); base report LIVE on hub.psgweb.me since 12-04 (CLI deploy `dpl_FEDz4AE6mWxrydVcJHQ9Gsb2h7kn`).

---

## ✅ v0.2 Customer MVP (v0.2.0)

**Completed:** 2026-06-04 (all 3 phases loop-closed)
**Duration:** ~2 days (2026-06-02 milestone start → 2026-06-04 close)

### Stats

| Metric | Value |
|--------|-------|
| Phases | 3 (6 RBAC+RLS spine · 7 tier gating + shop switcher · 8 launch hardening) |
| Plans | 14 (5 / 3 / 6) |
| Tests | 255 unit (Vitest) + 3 Playwright E2E specs |
| Coverage (v0.2 new code) | 88.85% lines, perFile≥70 |
| Phase commit | `b1f875d` (08-04 + 08-04b + transition; not merged/pushed) |

### Milestone gates (all PASS)

| Gate | Result |
|------|--------|
| Vitest coverage (new code ≥70%) | ✅ 88.85% lines, perFile≥70 (08-04) |
| Playwright E2E happy paths | ✅ auth + customer + the 07-03 shop-switch flow (08-04b; ops → v1.1) |
| WCAG AA on customer routes | ✅ 0 serious/critical, axe in-run (08-04b; fixed one real `--muted-foreground` contrast fail) |
| AEGIS audit (first customer-facing pass) | ✅ NO launch-blocker (08-03; 2 top claims refuted by adversarial verification) |
| gitleaks secret scan | ✅ clean — committed-history `gitleaks git` exit 0 (08-02b; 13 vetted FP allowlisted) |
| Brand conformance | ✅ static (08-04) + visual (08-04b) PASS |
| PII + RLS review before live data | ✅ blanket-allow RLS breach closed on prod (08-02; cross-tenant `authenticated` policies dropped) |

### Key Accomplishments

- **RBAC + RLS spine DEFINED + enforced (Phase 6):** the 3-role psg model (`customer` / `psg_internal` / `psg_superadmin`) with default-deny RLS on shared prod; `app_user_roles` / `security_profiles` / `superadmin_emails` + `private.*` no-hook resolvers; server-side customer-id gate in the dashboard layout; reviews surface reconciled to live `review_items` / `review_responses`; membership unified on `shop_users(user_id)` across all 13 authz sites; `llm_call_log` table. Superadmins Nick / Tina / Brian. 188 tests.
- **Self-serve onboarding + tier gating + MSO shop switcher (Phase 7):** service-role `POST /api/onboarding` bootstrap (closes the first-owner RLS chicken-and-egg); a shared ranked tier-gate helper (`src/lib/tier/gate.ts`); the `psg_active_shop` cookie switcher that SELECTS among authorized shops but never authorizes (membership re-validated every read; RLS + `.eq(shop_id)` backstop). 221 tests.
- **Launch hardening (Phase 8):** Phase-7 carry-in surface fixes (ads context, mobile nav, home phantom) + git↔Vercel wiring; blanket-allow RLS remediation LIVE (cross-tenant breach closed); v0.2 gitleaks scan clean + idempotency checklist; first AEGIS pass (no launch-blocker); Vitest 88.85% coverage gate + static brand audit; Playwright E2E (auth + customer + switch) + WCAG AA + visual brand against a zero-PII local Supabase target.
- **psg-hub is a secure, role-gated, multi-tenant customer surface** a real shop can safely log into — LIVE on hub.psgweb.me.

### Key Decisions

- **RLS spine DEFINED not extended (Phase 6):** grounding found no BSM Phase-4 RLS base + no role enum deployed; path-A shared-mutate with no-hook security-definer resolvers in `private.*`.
- **migrations-as-code is the only DDL path on shared prod** (314k+ PII rows / 142 shops); advisor baseline+diff gate per migration.
- **Shop switcher = cookie SELECTS, never authorizes (07-03):** the security crux is that a stale/forged cookie must not leak; the resolver re-validates against membership on every read.
- **Blanket-allow RLS = cross-tenant breach (08-02):** the `authenticated` half of the 26 inherited Allow-all policies let any logged-in user read every shop's rows; one idempotent migration dropped 24 across 12 tables (rls_policy_always_true 26→2).
- **E2E target = LOCAL Supabase (08-04b):** sensitive prod env makes hosted previews env-less; `db reset` + programmatic service-role seed + storageState per role gives a zero-PII rendered-surface target. `--muted-foreground` darkened #949494→#707070 for the WCAG AA floor.
- **git↔Vercel reality correction (08-01):** the working repo is `Phoenix-Solutions-Group/psg-internal` (no submodule) → the old design-system submodule merge-blocker is MOOT; prod-on-main auto-deploy kept OFF, CLI `vercel --prod` is the deploy path.

### Deferred from v0.2

- MSO portfolio / aggregate view + switcher search/typeahead → **v0.3 Customer Analytics** (feature, not hardening).
- LCP <2s perf gate → **v0.3** (no perf gate in v0.2 scope).
- Stripe INSERT→UPSERT (S3) + PII-at-rest retention/redaction → **v0.4 Invoicing + Payments**.
- Audit log → **v1.5 Superadmin Matrix + Audit**.
- Full 14-domain AEGIS sweep → **v2.0** (final).

### Notes

- **Tag:** `v0.2.0` is taken by the peer sitemap-maker project in this shared monorepo. psg-hub's milestone tag is namespaced (see STATE / operator decision).
- **Prod promotion gated:** merge `phase-8/08-01-carry-in`→main + `vercel --prod` stay operator-gated.

---

## ✅ v0.1 Foundation (v0.1.0)

**Completed:** 2026-06-02 (all 5 phases loop-closed)
**Duration:** ~4 days (2026-05-29 roadmap → 2026-06-02 close; core build 2026-05-31 → 2026-06-02)

### Stats

| Metric | Value |
|--------|-------|
| Phases | 5 |
| Plans | 18 (7 / 4 / 5 / 1 / 1) |
| Commits ahead of main | 8 (Phases 1-2 already on main; Phases 3-5 on `chore/phase-3-integrations`) |

### Milestone gates

| Gate | Result |
|------|--------|
| gitleaks secret scan (every-milestone compliance gate) | ✅ PASS — 75 commits / 6.19 MB scanned, no real secrets; 1 vetted false positive (generic-api-key misfire on prose listing key names in inherited `references/bsm/STATE.md`, allowlisted in `.gitleaksignore`) |
| AEGIS audit | Deferred — ROADMAP scopes "AEGIS final" to v2.0; recommend a per-milestone AEGIS pass starting v0.2 (first customer-facing milestone). No live customers in v0.1 (D57). |
| v0.1 → main merge | Operator-gated — blocked on the private `design-system` submodule (Vercel cannot build private git submodules); deploy is CLI `vercel --prod` (operator option C). Local tag `v0.1.0` created, not pushed. |

### Key Accomplishments

- **Workspace consolidated** into a single pnpm + Turborepo monorepo at `apps/psg/`. BSM dashboard relocated as the `apps/psg-hub/` anchor (build green, IDOR secured); BSM `studio` → `@psg/studio`; `apps/ads/` → `apps/psg-ads-mutations/` Python worker; ads-dashboard + local_reach archived; kill list retired; git collapsed to one repo.
- **PSG design system embodied:** vendored `packages/ui/psg-brand/` submodule; Gotham + Didact Gothic via `next/font/local`; BSM oklch teal → PSG tokens (midnight/ember/paper, 6px) across every shadcn var; `<Logo>` + DS-spec primitives; branded `/login` + `/signup` + navy app shell; fixed `/dashboard` 404 (route group → segment); de-BSM app-wide.
- **Transactional email + SMS** wired: SendGrid + Twilio, each via a shared `src/lib/resilience.ts` (retry + circuit breaker) adapter and an idempotent, signature-verified webhook, **live-verified end-to-end** (real signed `email_events` open + `sms_events` inbound rows).
- **Sanity content backend** provisioned (`vcw0bsnu`, private prod dataset, schema 4 types; `@psg/studio` env-decoupled from BSM).
- **psg-hub deployed LIVE at https://hub.psgweb.me** (new Vercel project `psg-hub`, 14 prod env keys incl. service-role, Let's Encrypt cert, branded).
- **PAUL inheritance made navigable:** `references/INDEX.md` maps inherited BSM (Phases 1-5) + ads-dashboard PAUL to the consuming psg-hub milestones (v0.2..v2.0), with the brand-reconcile caveat. `ACTIVE.md` superseded by `STATE.md`.
- **local_reach client outputs preserved** on-disk (`archive/local_reach-outputs/`, gitignored) faithful to MANIFEST; codebase retired.
- **Milestone secret scan clean** (gitleaks, allowlisted single false positive).

### Key Decisions

- **D54 superseded (03-04):** NEW Vercel `psg-hub` project instead of re-linking the broken `data` portal (re-link would have armed a routeless-main clobber); D54 intent (retire BSM Vercel) preserved.
- **D55 (03-03):** provisioned a new Sanity project `vcw0bsnu`, single private production dataset; no migration from BSM (sample-only, D57).
- **Vercel cannot build private git submodules** (proven) → deploy via CLI `vercel --prod` (operator option C); push-to-deploy from main is not viable as-is.
- **Phase 4/5 reframes:** their literal scope was front-loaded into Phase 1; Phase 4 added a navigable inheritance INDEX (verify-by-building + 3-lens adversarial verify), Phase 5 was a lean verify-and-close (on-disk-only preservation). `ACTIVE.md` is a phantom, superseded by `STATE.md`.

### Carry-forward to v0.2+

- v0.2 Customer MVP draws on BSM Phase 4 (Supabase auth + multi-tenant RLS + role enum + tier field).
- v0.3 Customer Analytics is built from the absorbed ads-dashboard plans (design canon) + BSM Phase 5 Google Ads data; take brand from the `psg-brand` submodule.
- Open: v0.1 → main merge (submodule gate); recommend an AEGIS pass at v0.2; `SUPABASE_DB_URL` + preview env when a pg-pool consumer / git previews are needed.

---
