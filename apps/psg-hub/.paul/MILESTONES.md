# Milestones

Completed milestone log for psg-hub.

| Milestone | Completed | Duration | Stats |
|-----------|-----------|----------|-------|
| v0.1 Foundation | 2026-06-02 | ~4 days | 5 phases, 18 plans |

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
