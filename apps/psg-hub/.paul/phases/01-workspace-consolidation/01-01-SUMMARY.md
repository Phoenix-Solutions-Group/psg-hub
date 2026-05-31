---
phase: 01-workspace-consolidation
plan: 01
subsystem: infra
tags: [monorepo, pnpm, turborepo, workspace, scaffold]

requires: []
provides:
  - pnpm workspace configuration at apps/psg/
  - Turborepo task pipeline configuration
  - Placeholder directories (apps/, packages/, archive/) ready for Wave 2 to populate
  - Workspace-level README documenting structure
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07, 02-design-system, 03-sendgrid-twilio-sanity-vercel]

tech-stack:
  added: [pnpm@9.15.0, turbo@^2.3.0]
  patterns:
    - workspace globs apps/* + packages/*
    - hoisted node-linker (Vercel + Next compatibility)
    - turbo 2.x tasks schema with persistent dev + cached build/test/typecheck/lint
    - .env.example allowlist in .gitignore

key-files:
  created:
    - apps/psg/package.json
    - apps/psg/pnpm-workspace.yaml
    - apps/psg/turbo.json
    - apps/psg/.npmrc
    - apps/psg/README.md
    - apps/psg/packages/.gitkeep
    - apps/psg/archive/.gitkeep
  modified:
    - apps/psg/.gitignore (augmented in-place; preserved existing PSG credential ignores)

key-decisions:
  - "Augment existing .gitignore rather than overwrite — preserves credential/PEM/key ignores already configured"
  - "Skip apps/.gitkeep since psg-hub graduation directory already provides content"
  - "Pin pnpm 9.15.0 via packageManager field; pin Node >=24 via engines field"

patterns-established:
  - "All future workspace members go under apps/* or packages/* — globs handle discovery"
  - "Turbo task pipeline: build/lint/test/typecheck cached; dev persistent + uncached; clean uncached"
  - "Workspace root preserves existing user-side configs where conflicts arise (D71 mindset: be additive when ambiguous)"

duration: ~3min
started: 2026-05-29T12:13:00Z
completed: 2026-05-29T12:16:00Z
---

# Phase 1 Plan 01: Monorepo Scaffold Summary

**pnpm 9.15 + Turborepo 2.x scaffold landed at apps/psg/; workspace globs ready for Wave 2 plans to drop in real members.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~3 min |
| Started | 2026-05-29T12:13:00Z |
| Completed | 2026-05-29T12:16:00Z |
| Tasks | 3 of 3 completed |
| Files modified | 8 (7 created, 1 augmented) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: pnpm recognizes workspace | PASS | `pnpm -r list` exit 0, zero members (expected — psg-hub has no package.json yet) |
| AC-2: Turborepo recognizes root config | PASS | `npx --yes turbo --version` → 2.9.16 (matches `^2.3.0` constraint) |
| AC-3: Workspace globs match structure | PASS | `apps/*` + `packages/*` declared; will pick up 01-05 (psg-hub package.json) and 01-06 (5 @psg/* packages) automatically |
| AC-4: README documents structure | PASS | 62 lines; references Phoenix-Solutions-Group/data (2x), psg-hub (7x), workspace structure + commands + out-of-scope adjacent dirs |
| AC-5: .gitignore prevents Node noise | PASS | node_modules, .next, .turbo, .vercel, *.log, .DS_Store, .env*, .env.example allowlist all present (existing protections preserved) |

## Accomplishments

- pnpm 9.15.0 confirmed as workspace package manager (matches `packageManager` pin in workspace `package.json`)
- Turborepo 2.x toolchain validated (2.9.16 via npx) — turbo 2.x `tasks:` schema (not legacy `pipeline:`)
- Workspace skeleton ready: `apps/` (psg-hub already inside), `packages/` (new, .gitkeep), `archive/` (new, .gitkeep)
- Workspace-level README documents the layout, runtime expectations, decision-history pointer, and D71 out-of-scope adjacencies

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `apps/psg/package.json` | Created | Workspace marker; pnpm@9.15.0 pinned via `packageManager`; Node ≥24 via `engines`; turbo devDep; scripts delegate to turbo |
| `apps/psg/pnpm-workspace.yaml` | Created | Workspace globs `apps/*` + `packages/*` |
| `apps/psg/turbo.json` | Created | Turbo 2.x task pipeline: build/lint/test/typecheck cached, dev persistent, clean uncached |
| `apps/psg/.npmrc` | Created | pnpm config: `auto-install-peers`, `node-linker=hoisted`, `strict-peer-dependencies=false` |
| `apps/psg/.gitignore` | Augmented | Added `.turbo/`, `next-env.d.ts`, `.pnpm-store/`, `!.env.example` allowlist. Preserved existing PSG credential ignores. |
| `apps/psg/README.md` | Created | 62-line workspace brief: what's here, active development, commands, decision history, out-of-scope adjacencies |
| `apps/psg/packages/.gitkeep` | Created | Placeholder for future @psg/* packages (01-06 fills) |
| `apps/psg/archive/.gitkeep` | Created | Placeholder for retired-but-preserved code (01-03 + 01-04 fill) |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Augment existing `.gitignore` in-place rather than overwrite | Pre-existing PSG patterns (`*credential*.json`, `*.pem`, `*.key`, `bigQuery-*.json`, `supabase/.temp/`) are project-specific protections that a fresh template would lose | Merged 4 new entries (`.turbo/`, `next-env.d.ts`, `.pnpm-store/`, `!.env.example` allowlist) instead. Existing protections kept. |
| Skip `apps/.gitkeep` | psg-hub graduation skeleton already provides content under `apps/`; .gitkeep would be redundant | None — plan action explicitly conditioned on this case |
| Defer `pnpm install` to 01-05 | No real workspace member exists yet (psg-hub graduation skeleton has no package.json) | Lockfile generation happens when first dep tree lands; cleaner snapshot |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed | 1 | Essential — preserve existing user-side protections |
| Scope additions | 0 | None |
| Deferred | 0 | None — all plan scope landed |

**Total impact:** No scope creep. One in-flight adaptation (gitignore merge) honored both the plan's intent and the pre-existing PSG context.

### Auto-fixed Issues

**1. .gitignore already existed at workspace root**
- **Found during:** Task 1 (write workspace-root configs)
- **Issue:** `Write` tool errored on `.gitignore` because file existed (`File has not been read yet. Read it first before writing to it.`)
- **Fix:** Read existing file (37 lines covering PSG credentials, build outputs, editor state), then applied targeted Edit operations to add the 4 missing patterns (`.turbo/`, `next-env.d.ts`, `.pnpm-store/`, `!.env.example` allowlist).
- **Files:** `apps/psg/.gitignore`
- **Verification:** `grep -E '\.turbo/|next-env\.d\.ts|\.pnpm-store/|!\.env\.example'` confirms all 4 additions present; original PSG credential patterns intact.

### Deferred Items

None — plan executed as specified.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| npm prints "Unknown project config" warnings for pnpm-specific `.npmrc` keys when invoked via `npx` | Cosmetic only; pnpm reads `.npmrc` correctly. Acceptable for v0.1. Future cleanup option: move pnpm-specific keys to `.pnpmrc` (which npm ignores). Logged as a CONCERN in STATE.md, not a deferred issue. |

## Next Phase Readiness

**Ready:**
- Workspace scaffold container ready for Wave 2 plans (01-05 BSM, 01-06 siblings → packages, 01-07 apps/ads → psg-ads-mutations)
- pnpm 9.15.0 confirmed available globally; first `pnpm install` will run in 01-05 when first workspace member lands
- Turbo 2.9.16 confirmed via npx; no install needed until first workspace member uses it
- Wave 1 sibling plans (01-02 kill list, 01-03 ads-dashboard absorb, 01-04 local_reach archive) have no dependency on 01-01's output — can apply in any order

**Concerns:**
- npm-vs-pnpm `.npmrc` warning is noise; consider `.pnpmrc` split in a later cleanup plan
- `apps/psg/` workspace-root git strategy still deferred (logged in STATE.md deferred issues) — must decide before 01-05 collapses or co-locates the psg-hub `.git`

**Blockers:**
- None for Wave 1 siblings (01-02/01-03/01-04 unblocked)
- None for Wave 2: 01-01 is the only Wave 2 prerequisite and is now satisfied

---
*Phase: 01-workspace-consolidation, Plan: 01*
*Completed: 2026-05-29*
