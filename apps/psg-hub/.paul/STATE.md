# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-05-29)

**Core value:** Consolidates fragmented PSG tooling into one branded `hub.psgweb.me` surface that customers, internal staff, and superadmins all use — replacing logins and tooling sprawl with role-gated unified access.
**Current focus:** Phase 3 (SendGrid + Twilio + Sanity new project + Vercel re-link) — Not started; ready to plan. Phase 2 (Design system) **✅ COMPLETE + UNIFIED 2026-06-01** — psg-hub embodies the PSG design system (submodule + Gotham/Didact fonts + brand tokens + PSG logo + branded login/signup + navy app shell + DS-spec primitives), fully de-BSM'd; all 4 plans loop-closed + operator-approved + reconciled (typecheck + 136 tests green at HEAD).

## Current Position

Milestone: v0.1 Foundation (v0.1.0) — In progress
Phase: 3 of 5 (SendGrid + Twilio + Sanity + Vercel re-link) — Not started
Plan: Not started
Status: Ready to plan Phase 3. Phase 2 unified + loop-closed 2026-06-01.
Last activity: 2026-06-01 — Phase 2 UNIFY complete: reconciled plan vs actual (typecheck + 136 tests green at HEAD; tokens/fonts/logo/shell/route-fix/de-BSM/docs all verified), PROJECT.md evolved, transitioned to Phase 3.

Progress:
- Milestone v0.1: [████░░░░░░] 40% (2 of 5 phases complete)
- Phase 1: [██████████] 100% ✅
- Phase 2: [██████████] 100% ✅ (4 of 4 plans, unified)

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [Phase 2 loop CLOSED 2026-06-01 — ready for Phase 3 PLAN]
```
Phase 2 ✅ CLOSED — 02-01 (tokens/fonts) · 02-02 (login) · 02-03 (shell+routing) · 02-04 (docs). Unified: claims re-verified at HEAD (typecheck + 136 tests green).
Next: Phase 3 — SendGrid + Twilio + Sanity (new project) + Vercel rename `psg-advantage-portal`→`psg-hub`. Carry-overs into Phase 3: design-system submodule is PRIVATE → Vercel deploy key; full `.env` (service role + feature keys) — only the gitignored dev `.env.local` (URL+anon) exists now.
**Git:** Phase 1 on `main` (pushed, `a96e271`). **Phase 2 on branch `chore/phase-2-design-system` — 8 ahead of `main`, NOT merged/pushed (operator-gated).**

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
- Last commit: `6338e64` — docs(paul): unify Phase 2 — close loop + transition to Phase 3
- Branch: `chore/phase-2-design-system` (9 ahead of `main`, 0 behind; NOT pushed, no upstream)
- Phase 1: MERGED + PUSHED to `main` (`a96e271`) last session on `github.com/Phoenix-Solutions-Group/data` — no action pending.
- **Phase 2 — operator action pending (blast radius beyond local):** merge/push `chore/phase-2-design-system` → `main` when ready (Claude can run on go). Push uploads the 51M ad-assets (operator chose KEEP permanently).
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
Stopped at: **Phase 2 COMPLETE + UNIFIED + loop-closed.** All 4 plans done, operator-approved, committed on branch `chore/phase-2-design-system`. Unify reconciled plan vs actual at HEAD (typecheck + 136 tests green; tokens/fonts/logo/shell/route-fix/de-BSM/docs all verified). PROJECT.md evolved; ROADMAP + paul.json mark Phase 2 ✅; transitioned to Phase 3. Both root handoffs archived to `.paul/handoffs/archive/`.
Next action: `/paul:plan 3` — Phase 3 (SendGrid + Twilio + Sanity new project + Vercel rename `psg-advantage-portal`→`psg-hub`). **Operator action (blast radius):** merge/push `chore/phase-2-design-system` → `main` when ready (8 ahead of `main`, not pushed; Claude can run on go).
Resume file: `.paul/ROADMAP.md` (Phase 3 scope + research topics).
Resume context:
- Phase 2 closed: submodule `packages/ui/psg-brand/` @`1689896`; PSG tokens (midnight/ember/paper, 6px) + Gotham/Didact fonts; `<Logo>` + DS-spec button/label/card/badge/table; branded `/login` + `/signup` + navy app shell; `/dashboard` 404 fixed (route group `(dashboard)`→ segment `dashboard`); de-BSM app-wide; legacy DS docs superseded.
- Phase 3 carry-overs: submodule is PRIVATE → Vercel deploy key needed for recursive checkout; only gitignored dev `.env.local` (Supabase URL+anon via MCP) exists — full env (service role + SendGrid/Twilio/feature keys) lands Phase 3; Gotham = Adobe Typekit-licensed → self-hosting `.otf` flagged; old bare root URLs (`/content`, `/ads`) now 404 post route-rename (matters when Phase 3 wires email links).
- Deferred (non-blocking): Phase 2.x compose route-page interiors to DS layout vocabulary; active-nav highlight (needs a small client nav component); 01-02 out-of-repo archival (CFO/governance/obsidian-vault relocate-or-leave; records corrected).
- Git: Phase 1 on `main` (`a96e271`, pushed, home repo `github.com/Phoenix-Solutions-Group/data`). Phase 2 on `chore/phase-2-design-system`, 8 ahead of `main`, NOT pushed — operator merges when ready.

---
*STATE.md — Updated after every significant action*
