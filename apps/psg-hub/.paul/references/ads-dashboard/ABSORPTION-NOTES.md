# ads-dashboard Absorption Notes (D70)

**Absorbed:** 2026-05-29 during psg-hub v0.1 Phase 1 Plan 01-03.

## What was absorbed

These artifacts are now reference material for v0.3 phase 1 in psg-hub:

| Source | Purpose in psg-hub |
|--------|--------------------|
| PROJECT.md | Original core value + business context for the customer dashboard surface |
| ROADMAP.md | 5-phase breakdown (Foundation, Data Pipeline, Multi-Client + RLS, Story Layer, Reports + Polish) — guides v0.3 phase plans |
| STATE.md | Snapshot of in-flight state at absorption (Phase 1 of 5, 01-01 APPLY done, 01-02–01-04 written and queued, milestone 0%) |
| SPECIAL-FLOWS.md | Skill loadout already in use on ads-dashboard PAUL — relevant for v0.3 phase planning |
| config.md | PAUL config — reference only |
| paul.json | Satellite manifest snapshot — reference only |
| phases/01-foundation/01-01-PLAN.md | Next.js scaffold + Vercel + CI plan (BSM Next 16 supersedes; reference only) |
| phases/01-foundation/01-01-AUDIT.md | Enterprise audit applied to 01-01 — patterns worth reusing in psg-hub plans |
| phases/01-foundation/01-02-PLAN.md | `/brandkit` token extraction + Tailwind theme — informs v0.1 Phase 2 brand work |
| phases/01-foundation/01-03-PLAN.md | Supabase magic-link auth + JWT claims (BSM has shipped auth; reference for shape) |
| phases/01-foundation/01-04-PLAN.md | Demo /c/wallace page with dummy data + impeccable critique gate — design intent for v0.3 hub marketing surface |
| handoffs/ | Session handoffs from ads-dashboard development — context for v0.3 absorption planning |
| ORIGINAL-PLANNING.md | Full SEED-equivalent ideation transcript |
| ORIGINAL-README.md | Original developer brief |
| ORIGINAL-SECURITY.md | Security posture intent |

## What was archived (not absorbed)

The scaffold codebase from `~/apps/ads-dashboard/` moves to `apps/psg/archive/ads-dashboard/` (Task 3 in this plan). BSM Next 16 + workspace pnpm monorepo supersedes the Next 15 scaffold — nothing in the code is materially reusable post-D70.

## What was decommissioned

- GitHub repo `Phoenix-Solutions-Group/ads-dashboard` archived via read-only flag (set in Task 4 checkpoint).
- Vercel project decommission deferred (Task 5 records the project name; actual delete happens at v0.3 absorption-complete to keep the demo URL up during the absorption window).

## v0.3 phase 1 picks up here

Per `projects/psg-hub/PLANNING.md` v0.3 Phase 1 (D70 rewrite), the hub builds:

- Story-led narrative UI ("Up 23% vs last month — added 3 new conversion goals on May 4") — design intent from ads-dashboard ROADMAP Phase 4
- "What PSG did" timeline (`psg_activity_notes` table) — concept from ads-dashboard `note` table
- Goals-based trend coloring (`shop_goals` table) — concept from ads-dashboard `goal` table (Phase 4 scoped)
- Monthly print-styled report at `/dashboard/shop/[shopId]/report/[month]` + PDF export — design intent from ads-dashboard Phase 5
- Pilot clients seeded: Wallace (6048611995), Tedesco (7763526490) per D61; Flower Hill data preserved but not in v1.0 pilot

The absorbed PAUL plan files are the design-intent canon. v0.3 phase plans in psg-hub will reference these by path.

## Restoration

If any absorbed artifact needs to be checked against the original after archive, the original codebase (including `.git` directory and `.paul/` tree) lives at `apps/psg/archive/ads-dashboard/`. GitHub repo is read-only but not deleted.
