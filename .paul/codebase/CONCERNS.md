# CONCERNS

*Last mapped: 2026-05-28*

Concerns are ranked by **consolidation impact** — what will block / break a unified `psg-hub`.

## 🔴 High — Will Block Consolidation If Unresolved

### 1. No monorepo tooling at workspace root

- No `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, or root `package.json` at `/Users/schoolcraft_mbpro/apps/psg/`
- Each active app has its own `.git/` (separate repos) — but `portal/HANDOFF-psg-data-lake.md` claims they all live under `Phoenix-Solutions-Group/data`. Inconsistency must be confirmed.
- **Impact:** Cannot share UI primitives, types, Supabase client wrappers across apps without restructure.
- **Action:** Decide before planning — single repo with workspaces vs single Next app absorbing the rest.

### 2. Next.js version drift

- `psg-advantage-portal` on Next 15.5.12 — `psg-advantage-portal/package.json`
- `psg-import` on Next 16.2.3 — `psg-import/package.json`
- React 19.1.0 vs 19.2.4 — minor but real
- **Impact:** Can't share components across the two as-is.
- **Action:** Align on one version when building hub (Next 16 if Vercel is on it, else 15).

### 3. Project ownership / location ambiguity

- `portal/HANDOFF-psg-data-lake.md` says workspace root **is** the monorepo — but only data-lake + portal are mentioned. Doesn't account for the 12 other dirs.
- `portal/` itself is a stub (only HANDOFF doc), so its existence is misleading.
- **Impact:** Risk of duplicating work or fighting git history during consolidation.
- **Action:** User confirm: which subdirs are in the `Phoenix-Solutions-Group/data` repo vs separate repos?

### 4. Overlapping / abandoned projects need explicit kills

- `invoice/` (empty) vs `invoice-psgdigital/` (WordPress) — **kill candidates** unless WP is still production
- `dashboard-psgdigital/` (PHP `about.php`) vs `psg-advantage-portal/` (Next.js) — name implies overlap; PHP version looks like a one-page legacy
- `portal/` (stub) vs `psg-advantage-portal/` — portal/ looks orphaned
- `sst-psgdigital/` — name implies SST/AWS but no SST config, only `.gitignore`. **Probably kill.**
- `web-dev-skills/`, `psg/` (Obsidian), `local-reach-content/`, `pipedrive/` — non-code; move out of workspace
- `shop-theacrb/` — WordPress, scope unclear
- **Impact:** Workspace looks bigger / messier than it is. New contributors confused.
- **Action:** Get explicit user verdict on each in audit step.

### 5. Two PAUL workspaces in the same parent dir

- `psg-import/.paul/` already exists with active milestones / phases / handoffs
- Newly-created `/.paul/` at workspace root (this one)
- **Impact:** PAUL tooling pointed at the root will not see the import sub-project's PAUL state.
- **Action:** Decide whether to absorb `psg-import` plans into the root PAUL or treat as a separate satellite project referenced from `psg-hub` plans.

## 🟡 Medium — Risk Without Blocking

### 6. No formatter across the entire workspace

- No `.prettierrc`, `.prettierrc.json`, `biome.json`, `.editorconfig` anywhere
- **Impact:** Inconsistent formatting; harder to merge across apps.
- **Action:** Add Prettier or Biome at the chosen workspace root before adding files to hub.

### 7. Auth coverage only in one app

- Supabase Auth is in `psg-advantage-portal` only. `psg-import` deploy and `psg-data-lake` scripts have no user-facing auth.
- **Impact:** When `psg-hub` consolidates, every surface needs to land behind the same auth shell — including the import tool if it's integrated.
- **Action:** Define auth boundary in PLAN. Plan to migrate `psg-import` behind hub auth, or proxy.

### 8. Required integrations not yet built

Per user intent (customer-facing analytics: Google Ads, Google Analytics, SEMrush, sentiment, invoices, payments, post-repair follow-up):

- Google Ads — only static CSVs exist (`api-psghub/ads-dash/Google Ads/`)
- Google Analytics — no integration anywhere
- SEMrush — no integration anywhere
- Stripe / payments — no integration anywhere
- Pipedrive — only xlsx audits in `pipedrive/`, no API code

**Impact:** Significant net-new build, not just consolidation. Scope is **build + consolidate**, not pure consolidation.

### 9. No CI configuration visible at workspace root

- Per-project Vercel exists (`*/​.vercel/`) but no `.github/workflows/`, no CircleCI / GitHub Actions seen at root
- **Impact:** No automated test gate before deploy.
- **Action:** Add CI as part of hub Phase 1.

### 10. Sensitive data handling

- Supabase migrations include explicit PII / sensitivity hardening:
  - `20260428171537_psg_sensitive_pii_schema.sql`
  - `20260428173000_psg_sensitive_pii_hardening.sql`
  - `20260428174000_psg_redact_public_survey_raw_payload.sql`
- This signals **the existing app is already handling PII carefully**.
- **Impact:** Hub consolidation must preserve / extend these RLS + redaction patterns. Skipping = compliance regression.
- **Action:** Treat migrations as load-bearing. Do not re-baseline schema casually.

## 🟢 Lower — Worth Noting

### 11. `.env.local` files committed-ish

- `psg-advantage-portal/.env.local` (mode `-rw-r--r--`) — verify it's `.gitignored`. If not, it's tracked.
- `psg-data-lake/.env.local` (mode `-rw-------`) — owner-only, good
- `psg-import/.env.local` (mode `-rw-r--r--`) — verify gitignore
- **Action:** Grep `.gitignore`s. Rotate any leaked secrets.

### 12. `.DS_Store` files committed across the workspace

- `.DS_Store` in repo root, `psg-advantage-portal/`, `psg-data-lake/`, `psg-import/`, and almost every dir
- **Impact:** Cosmetic, but signals lax `.gitignore` discipline
- **Action:** Workspace-level `.gitignore` for `.DS_Store`

### 13. README in `psg-advantage-portal` is still the create-next-app default

- `psg-advantage-portal/README.md` is the unmodified Next.js boilerplate despite the app being a serious dashboard with 27 tests, 30+ migrations, a 12KB Master Project Plan, and a design system doc
- **Impact:** Onboarding penalty. New contributors won't know what this app does without spelunking.
- **Action:** Replace README during hub planning.

### 14. Heavy committed binaries

- `local-reach-content/discovery.mp4` — 94 MB committed
- Multiple `.xlsx` and `.docx` files in `pipedrive/`, `psg-data-lake/Export/`
- `psg-agentic-os-dev-packet.docx` at root (32KB)
- **Impact:** Repo bloat if these are in git.
- **Action:** Check git LFS usage; move binaries out if not tracked properly.

### 15. Multiple Vercel project links

- Root `.vercel/`, `psg-advantage-portal/.vercel/`, `psg-import/.vercel/`
- **Impact:** Three Vercel projects when probably need one or two.
- **Action:** Audit Vercel project list; consolidate during hub launch.

## Honest Unknowns

- Have not enumerated TODO/FIXME comments yet (skipped to save context).
- Have not searched for hardcoded credentials (skipped — recommend `gitleaks` scan before any consolidation commit).
- Have not verified which Vercel deployments are actually live in production.
- `psg-data-lake` test coverage is unknown — only confirmed `pytest_cache/` exists.

These should be checked in a follow-up audit pass before locking the hub plan.
