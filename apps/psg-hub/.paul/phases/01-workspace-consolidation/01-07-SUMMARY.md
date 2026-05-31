---
phase: 01-workspace-consolidation
plan: 07
subsystem: infra
tags: [python, google-ads, gtm, monorepo, vercel-sandbox, worker]

requires:
  - phase: 01-01
    provides: workspace-root scaffold (apps/* glob, monorepo .git, root .gitignore)
provides:
  - "apps/psg-ads-mutations/ — Python ads+GTM mutation worker (relocated from ~/apps/ads/)"
  - "Python half of the monorepo (Node + Python now coherent)"
  - "pyproject.toml as psg-ads-mutations (>=3.11,<3.14), ready for v1.2 Vercel Sandbox wiring"
affects: [v1.2-ads-mutation-studio, phase-1-transition]

tech-stack:
  added: []   # no new deps; worker carries its own google-ads stack
  patterns: ["Python worker as apps/* member (no package.json → pnpm/turbo skip, intended)", "Sandbox-invoked worker, not part of JS build"]

key-files:
  created: [apps/psg-ads-mutations/, projects/psg-hub/.paul-bridge/01-07-pre-scan.md]
  modified: [apps/psg-ads-mutations/pyproject.toml (name), apps/psg-ads-mutations/README.md (cross-link header)]

key-decisions:
  - "PRESERVE .env (move, not delete) — gitignored → not in bundle → deletion irreversible"
  - "Include-as-is: psg-ads/ Obsidian vault + process-model HTMLs moved with the tree (operator Option 1)"
  - "Nested .git bundled (--all) + dropped — monorepo collapse precedent (01-05)"
  - "Strip node_modules (884M, has lockfile) + .claude/.claude-flow beyond plan's Python-only pre-clean"

duration: ~30min
started: 2026-05-31T18:05:00Z
completed: 2026-05-31T18:35:00Z

status: complete-with-deviations
result: DONE_WITH_CONCERNS
---

# 01-07 SUMMARY — apps/ads → psg-ads-mutations (Python worker)

## Outcome

Relocated `~/apps/ads/` (Google Ads + GTM mutation tooling) → `apps/psg/apps/psg-ads-mutations/` as the monorepo's Python worker (D36 + D52). Source pre-cleaned 2329MB → 394MB (**1935MB freed**). Existing safety patterns (CLI `--customer-id` required, dry-run default, JSON audit logs, per-client folders) preserved untouched. Phase 1 Wave 2 complete — **this is the last plan in Phase 1**.

Two blocking/irreversible risks were caught at the checkpoint and handled: (1) the plan would have deleted live `.env` credentials — preserved instead; (2) the secret-ignore had to be verified as a pre-commit gate before the phase-transition commit — verified passing.

## Per-task results

| Task | Status | Result |
|------|--------|--------|
| 1. Pre-scan | PASS | `.paul-bridge/01-07-pre-scan.md`. Found 2.3G source, nested own `.git`, 884M node_modules, secret yaml, non-Python content. |
| Checkpoint (human-action) | RESOLVED | Defaults approved; operator chose **Include-as-is** for non-Python content. |
| 2. Pre-clean | PASS w/ deviations | Stripped .venv(705M)+node_modules(884M)+.claude/.claude-flow+caches → **1935MB freed**. `.git` bundled+dropped. **`.env` PRESERVED** (override). |
| 3. Relocate | PASS | `mv` → `apps/psg-ads-mutations/`. Source ENOENT. Full tree intact (googleads_psg, gtm_psg, ops, audits, reports, logs[48], psg-ads/, HTMLs). |
| 4. pyproject | PASS | `psg-google-ads` → `psg-ads-mutations` (name only). Valid TOML (`tomllib`), 4 deps, requires-python >=3.11,<3.14 preserved. |
| 5. README + .gitignore | PASS | README cross-link header (D36+D52, Sandbox, v1.2, D65) prepended; original verbatim below. `.gitignore` already covered logs/+secrets → preserved intact (append-not-replace). |

## Acceptance Criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC-1: pre-scan captures structure + toolchain | ✓ | pre-scan written; metadata = existing pyproject (sole) |
| AC-2: pre-clean removes regenerables | ✓ | 1935MB freed; no __pycache__/.venv/node_modules remain |
| AC-3: relocation preserves structure + mtime | ✓* | source ENOENT; files keep mtime. *Dirs that had children stripped (ops/, googleads_psg/) show today's mtime — inherent to pre-clean-before-move ordering. logs/ untouched mtime. |
| AC-4: pyproject at dest | ✓ | name `psg-ads-mutations`, TOML valid |
| AC-5: README cross-links v1.2 | ✓ | header present (D36/D52); logs/ gitignored (pre-existing) |
| AC-6: per-client folders preserved | ✓ | ops/{flower-hill,koffman-auto-works,tedesco,wallace}; audits/{flower-hill,tedesco,wallace}; reports/{tedesco}. Partial coverage expected per AC wording; D64 slug match holds. |

## Secret gate (pre-commit security — verified)

`git -C apps/psg check-ignore -v` resolved all to ignore rules:
- `apps/psg-ads-mutations/ops/flower-hill/google-ads/config/google-ads.yaml` → `.gitignore:10` ✓
- `apps/psg-ads-mutations/.env` → `.gitignore:5` ✓
- `apps/psg-ads-mutations/logs` → `.gitignore:26` ✓
- Zero secrets in git's trackable set; `.env.example` trackable (correct).

`.git` history backup: `archive/_repo-bundles/ads-pre-drop-20260531.bundle` (50M, verified "complete history", HEAD `7a09228`, branch `main`, 2 commits). archive/ is gitignored.

Relocation integrity: `find psg-ads-mutations -name .git` → **NONE** (no embedded repo → no mode-160000 gitlink risk when the transition stages the tree). Only the one known flower-hill `google-ads.yaml` exists (already ignored); no second creds file.

## ⚠ Pre-commit gates for the Phase 1 transition (carry into UNIFY)

The transition's `git add` is the point of no return — these run BEFORE it finalizes:

1. **Inspect the FULL staged set, not just known paths.** `git -C apps/psg add -A -n` (dry-run) then `git diff --cached --stat`. The `google-ads.yaml` ignore is a *specific path*, not a glob — eyeball the real list for any other creds. (Done-equivalent here: nested-.git + creds scan already clean, but the staged list is ground truth.)
2. **One commit will sweep ALL uncommitted work**, not just 01-07: 01-06's `packages/studio` + `pnpm-lock` (never committed) + all `.paul` churn + 01-07's 394M. Confirm that's intended for a single `feat(phase-1)` commit, or split.
3. **394M decision before commit (history is forever).** Source `.gitignore` ignored `node_modules` + `reports/*/recap.pdf` but NOT `ops/*/ad-assets/` images → original repo treated them as trackable, so committing may be *intended*. Make it a conscious keep-vs-ignore call: stage → `git diff --cached --stat` → confirm with operator before finalizing.

## Deviations (for UNIFY)

1. **`.env` preserved, not deleted** (plan Task 2 deletes `.env*`). It's gitignored → absent from git history/bundle → deletion would be irreversible credential loss. Operator-approved default.
2. **Stripped node_modules (884M) + .claude/.claude-flow** beyond plan's Python-only pre-clean list. Regenerable (node_modules has package-lock.json); gitignored. Operator-approved.
3. **Nested `.git` bundled + dropped** (plan silent on it). Own repo would become an embedded gitlink in the monorepo. 01-05 collapse precedent. Operator-approved.
4. **Include-as-is** for non-Python content (`psg-ads/` Obsidian vault + 2 `process-model-*.html`) — plan's preserve-list didn't enumerate them. Operator chose Option 1 (move with tree; flag for later reorg).

## Concerns (DONE_WITH_CONCERNS)

1. **Stale `~/apps/ads/` paths in docs.** `CLAUDE.md` (setup/run examples) + README body still say `cd apps/ads`. Not edited (boundary: no Python-source edits; only README header in scope). Fix during v1.2 wiring.
2. **394M of per-client artifacts become trackable** at the phase-transition commit (ad-assets images, audits/*.md, reports/, the 2 HTMLs, psg-ads/ vault). logs/ + secrets + node_modules/.venv are ignored, but the remaining artifacts are sizeable. Operator may want to review what the phase commit stages (consider gitignoring `ops/*/ad-assets/` build/image output if not wanted in history).
3. **No dependency install** (per plan scope — deferred to v1.2). Worker is relocated + installable but not yet `pip install`ed; Sandbox wiring is v1.2 Phase 1.

## Deferred for v1.2 wiring

- Vercel Sandbox invocation contract (psg-hub Next.js route → Python worker)
- psg-hub web-UI surfacing + RBAC + `is_high_risk` superadmin gate (D65)
- Doc-path refresh (apps/ads → apps/psg-ads-mutations) in CLAUDE.md/README body
- Decision on tracking vs ignoring large per-client ad-assets in monorepo history
