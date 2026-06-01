# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-05-29)

**Core value:** Consolidates fragmented PSG tooling into one branded `hub.psgweb.me` surface that customers, internal staff, and superadmins all use — replacing logins and tooling sprawl with role-gated unified access.
**Core value:** Consolidates fragmented PSG tooling into one branded `hub.psgweb.me` surface.
**Current focus:** Phase 2 (Design system) — **expanded intent 2026-06-01**: psg-hub must EMBODY the PSG design system (logo + brand components + layout), not just recolor. 02-01 (token/font foundation) DONE + committed. 02-02 (branded /login slice) created, applying. Source = `Phoenix-Solutions-Group/design-system` (= local `psg-design-system-repo`, same commit `1689896`).

## Current Position

Milestone: v0.1 Foundation (v0.1.0) — In progress
Phase: 2 of 5 (Design system — embody, expanded) — In progress
Plan: 02-01 DONE (foundation); 02-02 created (branded login slice), in APPLY
Status: 02-02 executing toward human-verify checkpoint
Last activity: 2026-06-01 — 02-01 committed (`4792b1e`); re-scoped Phase 2 after human-verify revealed token-only ≠ "looks like PSG"; authored 02-02.

Progress:
- Milestone v0.1: [██░░░░░░░░] 20% (1 of 5 phases complete)
- Phase 1: [██████████] 100% ✅
- Phase 2: [███░░░░░░░] ~30% (02-01 done; 02-02 applying; 02-03/04 queued)

## Loop Position

```
02-01 PLAN ─▶ APPLY ─▶ (foundation done, committed 4792b1e)
02-02 PLAN ✓ ─▶ APPLY ◀── here ──▶ human-verify ──▶ UNIFY
```
Next: apply 02-02 (logo + brand primitives + branded login/signup + de-BSM), self-screenshot, operator human-verify. Then author 02-03 (shell) + 02-04 (docs). Phase 1 = merged to main + pushed (`65bc17f`).

## Phase 2 Plan Split (expanded 4-plan, 2 waves) — re-scoped 2026-06-01

| Plan | Scope | Deps | Status |
|------|-------|------|--------|
| 02-01 | Submodule + Gotham/Didact fonts + BSM teal → PSG tokens + delete orphan tokens.css | none | ✅ DONE (committed `4792b1e`) |
| 02-02 | Branded `/login` slice: `<Logo>` (DS reconstruction) + restyle shared button/input/label to DS spec + rebuild login/signup PSG vocabulary + de-BSM (incl. tab title) | 02-01 | PLAN ✓ — applying |
| 02-03 | App shell (`(dashboard)/layout.tsx` navy sidebar + reverse logo + header) + onboarding + card/badge/table to DS spec + rest of de-BSM (ads modals + callback in-copy) | 02-02 | TBD (after 02-02 loop) |
| 02-04 | Doc retirement: portal `DESIGN-SYSTEM.md` superseded pointer; ads-dashboard reconcile; README brand-source line | 02-01 | TBD |

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
- Last commit (pre-audit): `091cce6` — feat(phase-1): workspace consolidation complete (7/7 plans), 250 files
- This session: planning + audit-cleanup committed on top (Phase 2 plan 02-01 + STATE/ROADMAP/paul.json + worktree prune + BASE state sync)
- Branch: `chore/phase-1-workspace-consolidation` (NOT main, NOT pushed, no upstream; 4+ ahead of main, 0 behind)
- **Operator action pending (blast radius beyond local):** set upstream → push → merge to `main` on `github.com/Phoenix-Solutions-Group/data`. Note: push uploads the 51M ad-assets — resolve the de-track decision first if desired.
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
Stopped at: **Phase 1 MERGED + PUSHED to main; Phase 2 ready to APPLY.** Phase 1 (7/7) + planning + readiness audit + record corrections fast-forwarded to `main` and pushed to `github.com/Phoenix-Solutions-Group/data` (main = `a96e271`). Two pre-Phase-2 config items closed on branch `chore/phase-2-prep` (then merged): psg-hub `typecheck` script added (tsc --noEmit, exit 0); `turbopack.root` set → monorepo root (build green, workspace-root warning gone). 02-01-PLAN created + awaiting approval.
Next action: review + approve `02-01-PLAN.md`, then `/paul:apply apps/psg-hub/.paul/phases/02-design-system/02-01-PLAN.md`. **Phase 1 fully landed — no remote step pending.** Follow-ups still open (none block Phase 2): (a) 4 deferred BSM stubs content/scaffold plan, (b) BSM-root residue retirement (docs/, supabase/, .paperclip/), (c) ~~psg-hub typecheck script~~ ✅ DONE 2026-06-01 (studio still needs a tsconfig before its own typecheck), (d) ads doc-path refresh (apps/ads → apps/psg-ads-mutations in CLAUDE.md/README body), (e) ~~ad-assets keep/ignore~~ ✅ operator chose KEEP, (f) 01-02 out-of-repo archival gap (CFO/governance/obsidian-vault relocate-or-leave; records corrected).
Resume file: `.paul/phases/02-design-system/02-01-PLAN.md`. Prior handoff `HANDOFF-2026-05-31-wave2-next-01-06.md` superseded — STATE is authoritative.
Resume context:
- Wave 1 complete: 01-01 (scaffold), 01-02 (kill list), 01-03 (ads-dashboard absorb), 01-04 (local_reach + sidecar archive) all LOOP CLOSED. Committed 2026-05-31 as monorepo on branch `chore/phase-1-workspace-consolidation` (not pushed).
- Wave 2: 01-05 LOOP CLOSED (BSM anchor app, build green, IDOR fixed; committed 956c256). NEXT: 01-06 (BSM siblings → packages/*, gated ✓), then 01-07 (apps/ads → psg-ads-mutations, gated 01-01 ✓).
- Git monorepo: `apps/psg/.git` is THE repo; psg-hub absorbed; `/archive/`, `/psg-import/`, `/api-psghub/`, `/psg-data-lake/` gitignored (root-anchored). psg-hub history bundled at `archive/_repo-bundles/`. Not pushed — operator merges to main when ready.
Git strategy: RESOLVED 2026-05-31 — single monorepo (collapse). `apps/psg/.git` = THE monorepo. **Home repo = `github.com/Phoenix-Solutions-Group/data` CONFIRMED by operator 2026-05-31** (repo already held psg-advantage-portal + prior history; operator confirmed it as the monorepo home). Wave 1 committed on branch `chore/phase-1-workspace-consolidation`; NOT pushed — operator reviews/merges to main. psg-hub `.git` absorbed (bundle at `archive/_repo-bundles/psg-hub-pre-collapse-20260531.bundle`). Trap neutralized: `/archive/` root-anchored in `.gitignore`.

---
*STATE.md — Updated after every significant action*
