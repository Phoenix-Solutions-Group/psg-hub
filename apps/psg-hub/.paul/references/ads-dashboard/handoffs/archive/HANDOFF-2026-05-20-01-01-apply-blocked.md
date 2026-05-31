# PAUL Session Handoff

**Session:** 2026-05-20 (full day — SEED → graduate → PAUL init → plan → audit → apply)
**Phase:** 01-foundation
**Context:** Plan 01-01 APPLY in progress; Task 1 PASS, Task 2 blocked on Vercel Deployment Protection (spec gap). Awaiting A/B/C decision before continuing.

---

## Session Accomplishments

### SEED phase
- Ideated `ads-dashboard` as Application type via `/seed`
- Wrote `projects/ads-dashboard/PLANNING.md` (10 sections, 8 anti-slop pillars, 5-phase breakdown)
- Branding sources locked: PSG brand guidelines URL + design system zip
- Stack locked: Next.js 15 + Tailwind + shadcn/ui + Tremor + Supabase + Vercel + Python sync via GitHub Actions
- Auth locked: Supabase magic-link in project `gylkkzmcmbdftxieyabw`

### Graduation
- Graduated to `apps/ads-dashboard/` with git init on `main`
- Synthesized `apps/ads-dashboard/README.md` (project brief, 226 lines)
- Initial commit: `e00b855`

### PAUL init
- `.paul/` initialized: PROJECT.md, ROADMAP.md, STATE.md, paul.json
- Integrations enabled: SonarQube + Enterprise Plan Audit
- Specialized flows wired: `.paul/SPECIAL-FLOWS.md` with 10 skills (impeccable, brandkit, ui-ux-pro-max, supabase, vercel:nextjs, vercel:shadcn, AEGIS, code-review)

### Planning
- Phase 1 decomposed into 4 vertical-slice plans (01-01 scaffold, 01-02 brand tokens, 01-03 auth, 01-04 demo)
- All 4 PLAN.md files written
- Plan 01-01 Task 1 hardened (temp-dir scaffold primary, not in-place create-next-app)

### Enterprise audit on 01-01
- Audited as senior principal engineer + compliance reviewer
- Verdict: enterprise-ready post-upgrades
- Applied **6 must-have**: pnpm version pin, security headers, CI concurrency, CI timeout, URL capture+curl, robots.txt noindex
- Applied **5 strongly-recommended**: pnpm audit in CI, CODEOWNERS, SECURITY.md, Dependabot, rollback procedure in SUMMARY
- Deferred 6 items with rationale
- Wrote `.paul/phases/01-foundation/01-01-AUDIT.md`

### APPLY 01-01 (in progress)
- **Task 1 PASS** — Next.js 15 scaffold via temp-dir + rsync, security headers in `next.config.ts`, `app/robots.ts` noindex, packageManager pinned to `pnpm@10.32.1`, `.env.example` placeholder, `.nvmrc 20`, scripts (dev/build/start/lint/typecheck), template SVGs removed from `public/`, `SECURITY.md`, `.github/CODEOWNERS`, `.github/dependabot.yml`, `.github/workflows/ci.yml` (concurrency + timeout + pnpm audit), `.vercelignore`, `vercel.json`
- Local verify: `pnpm typecheck && pnpm lint && pnpm build` — all clean
- Header smoke test via dev server: all 5 security headers + CSP-RO present; robots.txt returns `Disallow: /`
- `pnpm audit --prod --audit-level=high` clean (1 moderate, doesn't fail gate)
- **Task 2 partial** — Vercel link succeeded (psg-digital/ads-dashboard), production deploy READY at `https://ads-dashboard-r5vhs5srw-psg-digital.vercel.app`, but URL returns HTTP 401 due to default Vercel Deployment Protection on PSG team

---

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Application type, web app | UI + multi-tenant data + deploy lifecycle | Drives all architecture |
| Stack: Next.js 15 + Tailwind + shadcn + Tremor + Supabase + Vercel | Fast path + polish ceiling | Locked for all phases |
| Sync: Python `googleads_psg/` → Supabase cache → Next.js consumer | Reuses authenticated wrapper, avoids API rate limits | Locks Phase 2 arch |
| Auth: Supabase magic-link in project `gylkkzmcmbdftxieyabw` | No password reset burden | RLS depends on JWT claims pattern |
| Sync runtime: GitHub Actions cron every 6h | Free, in-repo secrets | Phase 2 deploy locked |
| Brand tokens via `/brandkit` BEFORE any UI code | Anti-slop pillar #2 binding | Phase 1 ordering |
| `/impeccable critique` gate before every frontend phase merge | Anti-AI-slop binding | Quality gate, all frontend phases |
| Read-only dashboard; mutations stay in `apps/ads/` | Scope discipline | Out-of-scope guard |
| Option C for auto-mode: keep audit + critique as stops | Honor binding gates; "auto" only between gates | Drives plan-by-plan cadence |
| Enterprise audit on 01-01 applied 11 upgrades | Foundation-layer controls harder to retrofit | 01-01 strengthened pre-APPLY |
| Skill loading override for /vercel:nextjs etc. | Reference skills; user authorized auto mode | Logged deviation; proceeded |
| Scaffold via temp-dir + rsync, not in-place | Existing `.paul/` + README + PLANNING + .git in dir | Task 1 mechanism |

---

## Gap Analysis with Decisions

### G1 — Vercel Deployment Protection blocks AC-2 / AC-7 verification
**Status:** OPEN — awaiting user decision (A/B/C)
**Notes:** PSG team default enables Vercel SSO on all deployments. Production URL returns 401. Plan ACs assume raw curl 200. Classified as **spec issue** (plan didn't account for team-level protection default).
**Options surfaced:**
- **A.** Disable Deployment Protection on production only (keep on previews). Supabase magic-link in 01-03 becomes the real gate. — **recommended**
- **B.** Generate Vercel Protection Bypass token, use for CI + verification curl
- **C.** Leave protection on, update plan ACs to verify behind Vercel SSO (use `vercel curl`)

**Effort:** A = 1 min (dashboard toggle), B = 10 min (token + env wire), C = 5 min (AC rewrites)
**Reference:** `@.paul/phases/01-foundation/01-01-PLAN.md` AC-2, AC-7

### G2 — Supabase service_role key not yet provided
**Status:** DEFERRED — needed before 01-03 APPLY (not 01-02)
**Notes:** User to paste from Supabase dashboard → Settings → API → service_role
**Effort:** S
**Reference:** `@.paul/phases/01-foundation/01-03-PLAN.md` Task 1

### G3 — PDF generation runtime unresolved
**Status:** DEFER to Phase 5 planning
**Notes:** Puppeteer-on-Vercel vs `@react-pdf/renderer`
**Reference:** `@.paul/STATE.md` Deferred Issues

### G4 — Vanity slug strategy
**Status:** DEFER to Phase 1 deploy domain config (post-G1 resolution)
**Notes:** `dashboard.psg.com/wallace` vs `app.psg.com/c/wallace`
**Reference:** `@.paul/STATE.md` Deferred Issues

### G5 — Branch protection rules
**Status:** DEFERRED per audit (GitHub UI config, not code)
**Notes:** Apply via GitHub dashboard after first PR; document in 01-01-SUMMARY
**Reference:** `@.paul/phases/01-foundation/01-01-AUDIT.md` deferred items

### G6 — Per-client `goal` table schema
**Status:** DEFER to Phase 4 planning
**Reference:** `@.paul/STATE.md` Deferred Issues

### G7 — Client onboarding flow (PSG invite vs self-register code)
**Status:** DEFER to Phase 3 planning
**Reference:** `@.paul/STATE.md` Deferred Issues

---

## Open Questions

1. **G1 decision required** — A/B/C for Vercel Deployment Protection
2. Supabase service_role key — when will user paste? (Blocks 01-03 APPLY, not 01-02)
3. Email digest cadence (Resend) — weekly summary, monthly recap, or both? (Post-MVP)
4. CSP enforce vs report-only transition — currently report-only; lift to enforce in 01-03 after auth + font sources known

---

## Reference Files for Next Session

```
@.paul/STATE.md
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/SPECIAL-FLOWS.md
@.paul/config.md
@.paul/phases/01-foundation/01-01-PLAN.md
@.paul/phases/01-foundation/01-01-AUDIT.md
@.paul/phases/01-foundation/01-02-PLAN.md
@.paul/phases/01-foundation/01-03-PLAN.md
@.paul/phases/01-foundation/01-04-PLAN.md
@.paul/phases/01-foundation/.prod-url
@apps/ads-dashboard/next.config.ts
@apps/ads-dashboard/app/robots.ts
@apps/ads-dashboard/.github/workflows/ci.yml
@apps/ads-dashboard/package.json
@apps/ads-dashboard/SECURITY.md
@projects/ads-dashboard/PLANNING.md
```

---

## Prioritized Next Actions

| # | Action | Effort |
|---|--------|--------|
| 1 | **Resolve G1**: pick A/B/C for Vercel Deployment Protection | S — single decision |
| 2 | Apply chosen path to project (toggle dashboard / generate bypass / rewrite ACs) | S — 1-10 min depending |
| 3 | Re-verify Task 2: capture prod URL, curl 200 + security headers + robots.txt noindex | S |
| 4 | Push branch + open test PR to verify Task 3 CI workflow runs end-to-end (typecheck + lint + build + pnpm audit + concurrency cancel) | S |
| 5 | Write `.paul/phases/01-foundation/01-01-SUMMARY.md` per `<output>` block (URL, project ID, versions, headers, rollback procedure, pnpm audit baseline, deviations: skill override + protection decision) | M |
| 6 | Run `/paul:unify` to close 01-01 loop | S |
| 7 | Begin `/paul:plan` cycle on 01-02 (already planned; audit then apply) — or jump to `/paul:audit` since plan exists | M |
| 8 | Before 01-03 APPLY: user pastes Supabase service_role key into `.env.local` and Vercel env | S |

---

## State Summary

**Current:** Milestone v0.1 / Phase 1 (Foundation) / Plan 01-01 APPLY in progress / Loop: PLAN ✓, APPLY ◐, UNIFY ○
**Next:** Resolve G1 (Vercel Deployment Protection), finish Task 2 + Task 3 + Task 4, then UNIFY, then 01-02
**Resume:** `/paul:resume` → read this handoff → continue at G1 decision

---

*Handoff created: 2026-05-20*
