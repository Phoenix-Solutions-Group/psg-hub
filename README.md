# PSG Workspace

Monorepo root for Phoenix Solutions Group's unified platform work. Active development consolidates here under `apps/psg-hub/`. Target single GitHub repo: `Phoenix-Solutions-Group/data` (D7).

## What's here

| Path | Purpose |
|------|---------|
| `apps/` | Deployed Next.js apps + Python workers (workspace members) |
| `packages/` | Shared workspace packages (Sanity studio, integrations, design system submodule, etc.) |
| `archive/` | Retired-but-preserved code (local_reach, ads-dashboard absorbed scaffold) |
| `projects/` | SEED PLANNING.md artifacts (immutable post-graduation) |
| `psg-data-lake/` | Python ETL feeder, in-place, untouched (D14) |
| `psg-advantage-portal/` | Market intelligence source code, in-place; ported into hub in v0.3 |
| `psg-import/` | RO/Estimate import preprocessor, in-place; absorbed into v1.1 ops (D13) |
| `api-psghub/` | Reference patterns for Google Ads UI |
| `.paul/codebase/` | Workspace-wide codebase map (STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS) |

## Active development

`apps/psg-hub/` is the unified PSG platform target — customer portal + internal ops backbone + agentic market intelligence. See `apps/psg-hub/.paul/` for current PAUL state and `projects/psg-hub/PLANNING.md` for the SEED ideation v7 (71 design decisions, 10 milestones).

## Workspace commands

Run from this directory (`apps/psg/`):

```bash
pnpm install                          # install all workspace deps
pnpm -r list                          # list workspace members
pnpm dev --filter=psg-hub             # dev server for psg-hub
pnpm build                            # build all members (turbo cached)
pnpm test                             # run all tests
pnpm typecheck                        # typecheck all members
pnpm lint                             # lint all members
```

Workspace runtime per `package.json`:
- pnpm 9.15.x (pinned via `packageManager`)
- Node ≥ 24 (Vercel Fluid Compute default per Tech Stack)
- Turborepo 2.x

## Workspace members

Empty until first `package.json` lands under `apps/` or `packages/`. The graduation skeleton at `apps/psg-hub/` does not yet have a `package.json` — that lands in `v0.1` Phase 1 Plan 01-05 when the BSM dashboard relocates here.

## Decision history

71 design decisions logged in `projects/psg-hub/PLANNING.md`. See that file for the canonical SEED ideation artifact. Open questions remaining: Q15 (FileMaker historical migration scope — defer to v1.3.5 add-on if triggered).

## Out-of-scope adjacent directories

Per the D71 unmapped-`~/apps/`-scan, these PSG-adjacent directories live outside this workspace and are NOT part of the psg-hub consolidation:

- `~/apps/_psg-archive/` — archive root for PSG ops material relocated in v0.1 Phase 1 (CFO, daily-content-brief, governance, obsidian-vault, python-scripts, Automation, DEGWEB review, etc.)
- `~/apps/gbrain/` — external gbrain CLI (MCP registered globally)
- `~/apps/open-design/` — external design framework

## Repo target

GitHub: `Phoenix-Solutions-Group/data` (D7). Single repo for the workspace.
Production domain for psg-hub: `hub.psgweb.me`.
Vercel project: existing `psg-advantage-portal` project, re-linked + renamed in v0.1 Phase 3 (D54).
