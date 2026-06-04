# 01-07 Pre-Scan — apps/ads → psg-ads-mutations (Python worker)

**Date:** 2026-05-31
**Plan:** 01-07 (Wave 2, LAST in Phase 1) — relocate `~/apps/ads/` → `apps/psg/apps/psg-ads-mutations/`
**Status:** Pre-scan complete. BLOCKING at checkpoint — 2 irreversible-risk items + 1 content decision.

---

## Source: `~/apps/ads/` — 2.3G total

| Item | Size | Disposition |
|------|------|-------------|
| `ops/` | 1.5G | preserve (per-client artifacts) — but contains 884M regenerable node_modules (see below) |
| `.venv/` | 705M | **strip** (regenerable, in-plan) |
| `.git/` | 49M | **bundle + drop** (own repo — see §.git) |
| `reports/` | 2.5M | preserve (tedesco only) |
| `logs/` | 1.1M | preserve (D67 historical audit; gitignored at dest) |
| `googleads_psg/`, `gtm_psg/` | 188K/56K | preserve (core Python tooling) |
| `audits/` | 152K | preserve (flower-hill, tedesco, wallace + PSG-AGGREGATE-REPORT.md) |
| `process-model-*.html` ×2 | 180K | **operator decision** (non-Python content) |
| `psg-ads/` | 76K | **operator decision** (Obsidian vault + client notes — non-Python) |
| `SESSION_HANDOFF.md`, `README.md`, `CLAUDE.md`, `pyproject.toml` | — | preserve |

## Python toolchain (AC-4)

- **Existing `pyproject.toml`** (sole metadata; no requirements.txt/setup.py/poetry):
  - name `psg-google-ads` → rename to **`psg-ads-mutations`** (only field changed)
  - `requires-python = ">=3.11,<3.14"`, deps: google-ads, google-auth-oauthlib, google-api-python-client, python-dotenv; dev: pytest; hatchling build; wheel packages = googleads_psg/gtm_psg/ops
  - Strategy: **preserve existing, rename only** (no fabrication, no dep changes).
- Non-action note: `apps/psg-ads-mutations/` matches the `apps/*` pnpm glob but has **no package.json** → pnpm/turbo silently skip it. Correct — it's Vercel-Sandbox-invoked, not part of the JS build. No package.json needed.

## Per-client folders (AC-6, D64 — slugs match shop slugs)

| Dir | Clients present |
|-----|-----------------|
| `ops/` | flower-hill, koffman-auto-works, tedesco, wallace (all 4) ✓ |
| `audits/` | flower-hill, tedesco, wallace (no koffman) |
| `reports/` | tedesco only |

Partial coverage is expected per AC-6 ("modulo any that didn't exist in source").

---

## BLOCKING items (irreversible — must resolve before destructive ops)

### 1. DO NOT delete `.env` (plan Task 2 would — credential loss)

`.env` (1163B, live Google Ads OAuth + developer token) is **gitignored in source** → NOT in git history → NOT in the `.git` bundle. Plan Task 2 deletes `.env*` for "secret safety," but the file is **already untracked** — the traveling `.gitignore` keeps it out of commits without deletion. Deleting it is **irreversible** (values may exist nowhere else).
→ **Default: PRESERVE `.env` (move it).** The dest `.gitignore` (travels from source, lists `.env`) keeps it untracked. `.env.example` also preserved.

### 2. Secret-ignore is a pre-commit GATE (01-07 UNIFY → transition does `git add`/commit)

Source `.gitignore` already protects the secrets — it lists `ops/flower-hill/google-ads/config/google-ads.yaml` (349B Google Ads API creds), `.env`, `*.pem`, `*.key`, `node_modules/`, `.venv/`, `logs/`, `.claude/`. Git applies a nested `.gitignore` relative to its own location, so once it rides to `apps/psg/apps/psg-ads-mutations/.gitignore` it ignores those at the new path — **only if Task 5 APPENDS to it, never replaces it.**
→ After move + Task 5, BEFORE any commit, verify:
```
git -C /Users/schoolcraft_mbpro/apps/psg check-ignore -v \
  apps/psg-ads-mutations/ops/flower-hill/google-ads/config/google-ads.yaml \
  apps/psg-ads-mutations/.env
```
Both must resolve to an ignore rule, else the transition would stage a credential.

---

## Hygiene defaults (apply unless operator objects)

| Action | Detail | Safe because |
|--------|--------|--------------|
| `.git` → bundle + drop | `git bundle --all` → `archive/_repo-bundles/ads-pre-drop-20260531.bundle`, then `rm -rf .git` | 01-05 precedent; archive/ gitignored; 2 commits on `main` captured. Untracked files (audits/, koffman, psg-ads/, HTMLs) travel via `mv` regardless. |
| strip `.venv` (705M) | in-plan regenerable | recreated via pyproject |
| strip `node_modules` (884M) | `ops/flower-hill/ad-assets/landing-page/node_modules` | has package-lock.json + package.json → regenerable; gitignored |
| strip `.claude/`, `.claude-flow/` | tooling state | gitignored, regenerable |
| preserve `logs/`, ad-assets images, per-client artifacts | — | D67 + AC-6 |

Total expected free: ~1.6G (.venv 705M + node_modules 884M + caches).

---

## GENUINE operator decision: non-Python content placement

The plan's preserve-list enumerates `googleads_psg, gtm_psg, ops, audits, reports, logs` — it does NOT mention two non-Python items that the wholesale `mv` would carry into the Python worker dir:
- `psg-ads/` — an **Obsidian vault** (`.obsidian/`) + "Wallace Collision — Status Report.md" + tedesco/wallace note folders
- `process-model-psg-{delivery,sales}-lifecycle.html` — process-model docs

Same shape as 01-06's stub decision. Note: the Wallace/tedesco notes relate to the `@psg/shops` content **deferred in 01-06** — same future content-home question.

- **Include-as-is (recommended):** move with the tree into `psg-ads-mutations/`, flag for a later content reorg. Matches plan's preserve-the-tree intent; nothing fragments now.
- **Split to `content/`/`docs/`:** move `psg-ads/` + HTMLs to a non-code home; only Python tooling lands in the worker dir.
