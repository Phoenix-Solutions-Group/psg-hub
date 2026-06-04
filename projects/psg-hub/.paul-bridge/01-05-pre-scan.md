# 01-05 Pre-Scan — BSM dashboard → psg-hub merge

**Scanned:** 2026-05-31
**Source:** `/Users/schoolcraft_mbpro/apps/projects/bsm/dashboard/`
**Dest:** `/Users/schoolcraft_mbpro/apps/psg/apps/psg-hub/`

## Source (BSM dashboard) — 886 MB

Next.js app (App Router under `src/`), shadcn (`components.json`), vitest.

| Item | Note |
|------|------|
| node_modules (794M) | pre-clean (regenerable) |
| .next (89M) | pre-clean (regenerable) |
| .git | DROP per D6 (bundled to archive/_repo-bundles/ first for safety) |
| package.json (name="dashboard") | rename → psg-hub |
| package-lock.json (430K) | ⚠️ npm lockfile — EXCLUDE from merge (pnpm monorepo; root pnpm-lock supersedes) |
| src/ public/ next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs components.json next-env.d.ts vitest.config.ts vitest.setup.ts | merge in |
| AGENTS.md CLAUDE.md (11B) | merge in (trivial) |
| .env.example (2.5K) | merge in (safe template) |
| .gitignore (480B) | BSM app-level — merge in (coexists w/ root) |
| README.md (1450B) | CONFLICT → goes to references/bsm/ORIGINAL-README.md (psg-hub v7 README preserved) |
| .DS_Store (10 files) | clean |

**Real source after pre-clean: ~3 MB.**

## Dest (psg-hub graduation skeleton)

Near-empty: `.paul/` (authoritative — preserve), `README.md` (v7, 11820B — preserve), `.DS_Store`.
**No `.git`** — psg-hub was collapsed into the root monorepo (git-strategy decision 2026-05-31). The plan's "psg-hub .git UNCHANGED" checks are **N/A** (now tracked by root `apps/psg/.git`).

## Conflicts (names in both src + dest)

| Name | Resolution |
|------|-----------|
| README.md | psg-hub v7 README preserved; BSM's → `.paul/references/bsm/ORIGINAL-README.md` (rsync excludes README.md) |
| .DS_Store | deleted both sides |

No `.paul` conflict (BSM dashboard has none inside `dashboard/`). No `.git` conflict (dest has none).

## BSM PAUL to absorb → references/bsm/

From `~/apps/projects/bsm/.paul/`: PROJECT.md, ROADMAP.md, STATE.md, paul.json, config.md, SPECIAL-FLOWS.md, HANDOFF-2026-04-24.md, handoffs/, phases/ (Phase 1–5). Plus ORIGINAL-PLANNING.md, ORIGINAL-README.md, DASHBOARD-README.md.

## Security

✅ No real `.env` / secrets in source — only `.env.example`. Nothing sensitive merges into the (remote-connected) monorepo. `.env*` (non-example) still excluded by Task 3/4 as defense-in-depth.

## Conflict resolution policy (active)

- `.paul/`, `README.md` → psg-hub preserves (rsync exclude)
- `.git` → psg-hub has none; BSM source `.git` bundled then dropped
- `package-lock.json` → EXCLUDE (npm→pnpm; deviation from plan rsync list)
- `.env*` (non-example) → never copied
- everything else → BSM populates (psg-hub skeleton has none)

## Deviations flagged

1. `package-lock.json` not in plan's rsync exclude list — adding it (npm lockfile wrong in pnpm monorepo).
2. BSM uses `src/` layout, not top-level `app/`/`components/`/`lib/` as plan's files_modified assumed. rsync copies all regardless.
3. psg-hub `.git` already absent (collapse) — "unchanged .git" ACs N/A.
4. BSM `.git` bundled to `archive/_repo-bundles/` before drop (extra safety vs D6 plain-drop; result still = dropped from merge).
