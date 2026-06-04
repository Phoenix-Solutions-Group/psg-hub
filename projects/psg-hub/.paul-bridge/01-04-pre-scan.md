# 01-04 Pre-Scan — local_reach archive

**Scanned:** 2026-05-31
**Source:** `/Users/schoolcraft_mbpro/apps/projects/local_reach/`
**Status:** SOURCE EXISTS

## Total size

- **Pre-clean total: 3.6 GB** (plan estimate was ~6 GB; actual is smaller)
- **Estimated post-clean: ~3.23 GB** (after stripping 378 MB regenerable artifacts)
- Post-clean size is dominated by a single data file (see below), not code.

## Size note (operator decision point)

| Item | Size | Type | Pre-clean? |
|------|------|------|-----------|
| `accidents.db` | **2.9 GB** | SQLite collision-accident DB (single file) | NO — not a regenerable-artifact pattern; archived as-is |
| `.git/` | ~ (hidden) | Repo history | NO — kept intentionally (archive stays a real recoverable repo) |
| `.venv/` | ~ (hidden) | Python virtualenv | NO — regenerable but not in pre-clean pattern list |

`accidents.db` alone is ~80% of the post-clean archive. Plan disposition (D69) = archive whole. If operator wants the 2.9 GB DB dropped from the archive, say so at the checkpoint.

## Top-level listing (non-hidden, by size)

```
2.9G  accidents.db
191M  app
136M  pipeline
 89M  _temp
 52M  scripts
 17M  output
1.1M  new-tracys-report-v2   ← client output
1.0M  dist
976K  api
428K  tracys-research-v3     ← client output
300K  docs
200K  src
 56K  supabase
 44K  andrej-karpathy-skills-main
 ...  (php pipeline files, test logs, yaml configs, *.md docs)
```
Hidden dirs present (not in `*` glob): `.git .venv .claude .planning .agent .agents .vite .vscode`

## Detected client output directories

Both expected Tracy's outputs found. No additional output dirs matched.

OUTPUT: /Users/schoolcraft_mbpro/apps/projects/local_reach/new-tracys-report-v2
OUTPUT: /Users/schoolcraft_mbpro/apps/projects/local_reach/tracys-research-v3

| Output dir | Size | mtime |
|------------|------|-------|
| new-tracys-report-v2 | 1.1 MB | 2026-04-06 |
| tracys-research-v3 | 428 KB | 2026-04-06 |

## Regenerable artifacts to pre-clean (Task 2)

**378 MB reclaimable**, all `node_modules` (no vendor/.next/.wrangler/.cache present):

```
190M  app/node_modules
134M  pipeline/node_modules
 52M  scripts/node_modules
  8K  pipeline/src/node_modules
```
Plus `dist/` (1.0M root) + `pipeline/dist/` (1.2M). 33 `.DS_Store` files to delete.

Pattern set: `node_modules vendor .next dist build .wrangler .cache` + `.DS_Store`.
None overlap real source trees (`src/`, `app/src`, `api/`, `pipeline/src`, `public/` preserved).

## Verification

- [x] Source surveyed before any mutation (read-only scan)
- [x] `tracys` present in scan (grep count ≥ 1)
- [x] Total + estimated post-clean size recorded
- [x] Client output dirs + sizes + mtimes captured
- [x] Regenerable artifact dirs + sizes captured
