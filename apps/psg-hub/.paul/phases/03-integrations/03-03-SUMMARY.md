---
phase: 03-integrations
plan: 03
subsystem: infra
tags: [sanity, cms, content, env, monorepo, studio]

requires:
  - phase: 01-workspace
    provides: "@psg/studio package relocated to packages/studio (was BSM studio)"
provides:
  - "New PSG Sanity project vcw0bsnu (private production dataset, D55)"
  - "@psg/studio decoupled from BSM 436nqu7v — env-driven config (SANITY_STUDIO_*)"
  - "psg-hub Sanity env contract (NEXT_PUBLIC_SANITY_* + SANITY_API_READ_TOKEN, names only)"
affects: [03-04-vercel, v0.3-customer-analytics]

tech-stack:
  added: ["Sanity project vcw0bsnu (cloud); no new npm deps in hub"]
  patterns: ["env-driven Sanity config (no hardcoded project id in source); secrets in gitignored .env.local; production env deferred to Vercel (03-04)"]

key-files:
  created: ["packages/studio/.env.example", "packages/studio/.env.local (gitignored)", "apps/psg-hub/.env.local (appended, gitignored)"]
  modified: ["packages/studio/sanity.config.js", "packages/studio/sanity.cli.js", "apps/psg-hub/.env.example"]

key-decisions:
  - "New Sanity project = vcw0bsnu (display 'psg-hub') under org PSG (oqyhOHQtc); Free tier"
  - "production dataset = PRIVATE (reads require SANITY_API_READ_TOKEN)"
  - "Start fresh — no migration from BSM 436nqu7v (sample data only; D57)"
  - "Studio stays standalone (sanity deploy), not embedded in Next"

patterns-established:
  - "Sanity project id read from env (SANITY_STUDIO_* for studio, NEXT_PUBLIC_SANITY_* for hub) — no id hardcoded in tracked source"
  - "App-level read token in gitignored .env.local (dev); Vercel env wired in 03-04 (mirrors SendGrid/Twilio)"

duration: ~35min (plan + apply + unify)
started: 2026-06-01
completed: 2026-06-01
---

# Phase 3 Plan 03: Sanity — new PSG project + studio decouple + env contract

**Provisioned a fresh PSG Sanity project (`vcw0bsnu`) with a private `production` dataset and a deployed 4-type schema, decoupled the relocated `@psg/studio` from the legacy BSM project (`436nqu7v`) to env-driven config, and published the psg-hub Sanity env contract — content backend live and isolated from BSM, ready for v0.3 consumers and 03-04 Vercel wiring.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~35 min (plan + apply + unify) |
| Completed | 2026-06-01 |
| Tasks | 3 completed (2 auto + 1 operator checkpoint) |
| Files modified (tracked) | 4 |
| Tests | 182/182 green (zero regressions) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Studio decoupled from BSM, bound to new project via env | Pass | `sanity.config.js`/`sanity.cli.js` read `SANITY_STUDIO_*`; `sanity debug` → Project ID `vcw0bsnu`; no `436nqu7v` in `packages/studio`. (See deviation re: AC wording.) |
| AC-2: psg-hub Sanity env contract published (no secrets, no client code) | Pass | 4 names in `.env.example`; both `.env.example` trackable; no `@sanity/*` dep, no `src/` code; typecheck + 182 tests green |
| AC-3: New project provisioned + live verify (operator-gated) | Pass | `vcw0bsnu` + private `production` dataset; empty (isolated from BSM's 7 docs); read token works; operator ran `sanity dev` + `sanity schema deploy` → MCP `get_schema` confirms 4 types |

## Accomplishments

- New Sanity project **`vcw0bsnu`** ("psg-hub") created under org PSG (`oqyhOHQtc`) via Sanity MCP; `production` dataset ACL flipped public→private (D55).
- `@psg/studio` config decoupled from BSM `436nqu7v` → env-driven (`SANITY_STUDIO_PROJECT_ID` / `SANITY_STUDIO_DATASET`); binding proven (`sanity debug`).
- Schema deployed to Content Lake — 4 types verified (shop 8f · contentItem 16f · auditReport "SEO Audit Report" 7f · researchBrief "Market Research Brief" 6f).
- Env contracts published (`packages/studio/.env.example` + `apps/psg-hub/.env.example`, names only); dev values in gitignored `.env.local`; read token stored, write token discarded.

## Task Commits

Committed as a single commit on branch `chore/phase-3-integrations` at UNIFY (mirrors 03-01 `98c3125` / 03-02 `01daead`). Commit hash recorded in STATE.md Git State.

| Task | Type | Description |
|------|------|-------------|
| Task 1: Decouple `@psg/studio` | refactor | env-driven `sanity.config.js`/`sanity.cli.js`; studio `.env.example` |
| Task 2: psg-hub env contract | chore | Sanity block in `apps/psg-hub/.env.example` (names only) |
| Task 3: Provision + verify | (external) | Sanity project `vcw0bsnu` + private dataset + schema deploy (cloud; not a code commit) |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `packages/studio/sanity.config.js` | Modified | `projectId`/`dataset` → `process.env.SANITY_STUDIO_*` (BSM id removed) |
| `packages/studio/sanity.cli.js` | Modified | same env-driven swap for `api.projectId`/`api.dataset` |
| `packages/studio/.env.example` | Created | `SANITY_STUDIO_PROJECT_ID` / `SANITY_STUDIO_DATASET` (names only) |
| `apps/psg-hub/.env.example` | Modified | Sanity block: `NEXT_PUBLIC_SANITY_*` + `SANITY_API_READ_TOKEN` (names only) |
| `apps/psg-hub/.env.local` | Modified (gitignored) | projectId + private dataset + apiVersion + read token (dev) |
| `packages/studio/.env.local` | Created (gitignored) | projectId + dataset (dev) |
| Sanity cloud | Created | project `vcw0bsnu` + private `production` dataset + deployed schema (4 types) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| New project `vcw0bsnu` (psg-hub, Free tier) under org PSG | D55 — provision new, no project to inherit; single org so no ambiguity | Content backend identity for v0.1+ |
| `production` dataset PRIVATE | PSG PII-cautious posture; content may be pre-publication | Reads require `SANITY_API_READ_TOKEN` (server-side; 03-04 Vercel) |
| No migration from BSM `436nqu7v` | Sample data only (7 docs: 4 real + 3 AI-assist); zero live customers (D57) | Clean start; schema TYPES carried via code, data did not |
| Studio standalone (not embedded) | "import studio" = re-point existing standalone, not Next embed | `sanity deploy` path preserved |
| Read token via auto-mint; write token discarded | Hub is read-only; least privilege | Write token revoke recommended (operator follow-up) |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 0 | — |
| Scope additions | 1 | CORS `localhost:3000` added at project create (forward-looking, harmless) |
| Spec/verify-wording notes | 4 | Cosmetic; no code impact |
| Deferred | 1 | Studio `title: 'BSM'` de-BSM (out of scope) |

**Total impact:** Clean execution, no scope creep. All deviations are AC/verify wording quirks or noted follow-ups.

### Notes (spec/verify wording — no code defect)

1. **AC-1 "`git grep 436nqu7v` → zero hits in tracked files" is over-broad.** The id legitimately persists in `.paul/` planning docs (which *describe* the decoupling) and `references/bsm/**` (preserved BSM history). The studio *binding* is fully removed (`sanity debug` → `vcw0bsnu`). Read AC-1 as "removed from studio config/source." No fix — erasing it from history/planning would damage the record.
2. **`git check-ignore -v … && echo FAIL`** in the plan's verify mis-reads negation-rule exit codes. Real trackability proven via `git add -n` (`add 'packages/studio/.env.example'`).
3. **`pnpm test --run`** in the plan is invalid — the script is already `vitest run`; correct invocation is `pnpm test` (182/182).
4. **`node --check` on ESM `.js`** — passed anyway; an ESM-aware check (`node --input-type=module --check`) was also run and passed.

### Deferred Items

- Studio `title: 'BSM'` left unchanged per plan boundary → **de-BSM follow-up candidate** (cosmetic studio chrome; not 03-03 scope).

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| `create_project` auto-created `production` as **public** + minted read+write tokens | Flipped to **private** via `update_dataset`; stored read token only (gitignored), discarded write token |
| `deploy_schema` (MCP) refuses when a local studio exists | Operator deployed via `npx sanity schema deploy` from `packages/studio` (correct path) — verified via MCP `get_schema` (4 types) |

## Next Phase Readiness

**Ready:**
- Content backend live: project `vcw0bsnu`, private `production` dataset, 4-type schema deployed.
- Env contract published for both studio and hub; dev `.env.local` wired.
- Studio decoupled and env-driven — no BSM binding.

**Concerns:**
- Studio `title: 'BSM'` is a residual identity string (de-BSM follow-up).
- Unused write token exists on the new project (revoke for least privilege).

**For 03-04 (Vercel):**
- Wire `NEXT_PUBLIC_SANITY_PROJECT_ID=vcw0bsnu`, `NEXT_PUBLIC_SANITY_DATASET=production`, `NEXT_PUBLIC_SANITY_API_VERSION=2026-06-01`, `SANITY_API_READ_TOKEN` into Vercel env (alongside SendGrid/Twilio).
- Add the production host to Sanity CORS origins when the host is finalized.

**Blockers:** None.

---
*Phase: 03-integrations, Plan: 03*
*Completed: 2026-06-01*
