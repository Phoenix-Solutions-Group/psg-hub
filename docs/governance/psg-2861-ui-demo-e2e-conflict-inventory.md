# PSG-2861 UI, Demo, and End-to-End Test Conflict Inventory

**Issue:** PSG-2861 - Recovery branch UI/demo/E2E conflict inventory
**Owner:** Nora
**Date:** 2026-08-19
**Branch checked:** `feat/psg-790-tedesco-lead-endpoint` at `f8a1f58e`
**Target checked:** `origin/main`
**Merge base:** `fc4319a898847c14237732170bc4f09f3b669bdd`

## Bottom Line

The UI, demo, and browser-test lane is not ready for a clean merge. A non-destructive
Git merge simulation shows direct conflicts in the demo test setup, the customer
dashboard, content approvals, review workspace, superadmin user management, and
production/mail-artwork surfaces.

This lane covers 84 files changed on the recovery branch relative to `origin/main`
under the scoped UI/demo/E2E paths: 44 added files and 40 modified files. The scoped
diff is about 14,207 added lines and 620 removed lines. `origin/main` also changed
72 files in the same lane after the recovery branch split, so simple "take the
branch" resolution would drop mainline fixes.

## Commands Used

```bash
git status --short --branch
git merge-base origin/main HEAD
git merge-tree --write-tree --messages origin/main HEAD
git diff --name-only origin/main...HEAD -- apps/psg-hub/src/app/dashboard apps/psg-hub/src/app/ops apps/psg-hub/src/app/review-workspace apps/psg-hub/src/components apps/psg-hub/e2e apps/psg-hub/playwright.config.ts apps/psg-hub/package.json
git diff --name-only HEAD...origin/main -- apps/psg-hub/src/app/dashboard apps/psg-hub/src/app/ops apps/psg-hub/src/app/review-workspace apps/psg-hub/src/components apps/psg-hub/e2e apps/psg-hub/playwright.config.ts apps/psg-hub/package.json
git diff --check origin/main...HEAD -- apps/psg-hub/src/app apps/psg-hub/src/components apps/psg-hub/e2e apps/psg-hub/docs/runbooks apps/psg-hub/playwright.config.ts apps/psg-hub/package.json
```

## Exact Conflict Hot Spots In Nora Lane

### Demo and Browser Test Harness

These conflicts decide whether the shared demo and release browser tests can run:

- `apps/psg-hub/e2e/analytics.spec.ts` - content conflict.
- `apps/psg-hub/e2e/bsm-review-workspace.spec.ts` - added on both sides.
- `apps/psg-hub/e2e/fixtures.ts` - content conflict.
- `apps/psg-hub/e2e/focused-bsm-walkthrough.spec.ts` - added on both sides.
- `apps/psg-hub/e2e/global.setup.ts` - content conflict.
- `apps/psg-hub/e2e/production-happy-path.spec.ts` - content conflict.
- `apps/psg-hub/e2e/superadmin-walkthrough.spec.ts` - added on both sides.
- `apps/psg-hub/package.json` - content conflict in scripts/dependencies.
- `apps/psg-hub/playwright.config.ts` - content conflict.

Resolution rule: preserve the mainline stabilization commits for auth, shop switch,
production, and hosted browser assertions while retaining the recovery branch's clean
Riverside demo role path. Do not choose either side wholesale.

Focused verification after resolution:

```bash
pnpm --filter psg-hub test:e2e -- --grep "clean BSM demo|production|analytics"
```

### Customer Dashboard and Analytics UI

These conflicts affect what a shop owner sees in the demo and customer dashboard:

- `apps/psg-hub/src/app/dashboard/__tests__/page.test.tsx` - added on both sides.
- `apps/psg-hub/src/app/dashboard/analytics/__tests__/page.test.tsx` - added on both sides.
- `apps/psg-hub/src/app/dashboard/analytics/page.tsx` - content conflict.
- `apps/psg-hub/src/app/dashboard/approvals/content/[id]/page.tsx` - added on both sides.
- `apps/psg-hub/src/app/dashboard/approvals/page.tsx` - content conflict.
- `apps/psg-hub/src/app/dashboard/layout.tsx` - content conflict.
- `apps/psg-hub/src/app/dashboard/page.tsx` - content conflict.
- `apps/psg-hub/src/components/analytics/direct-mail-panel.tsx` - added on both sides.
- `apps/psg-hub/src/components/analytics/__tests__/direct-mail-panel.test.tsx` - added on both sides.
- `apps/psg-hub/src/components/dashboard/approval-card.tsx` - content conflict.
- `apps/psg-hub/src/components/dashboard/__tests__/approval-card.test.tsx` - added on both sides.
- `apps/psg-hub/src/components/dashboard/bsm-content-review-actions.tsx` - added on both sides.

Resolution rule: keep the mainline direct-mail and analytics hardening, then layer
the recovery branch's Riverside demo fallbacks and content approval links on top.
Customer-facing copy and demo-only labels need one final business review before
public use.

Focused verification after resolution:

```bash
pnpm --filter psg-hub test -- src/app/dashboard src/components/analytics src/components/dashboard
```

### Ops Demo, Review Workspace, and Superadmin UI

These conflicts affect PSG staff and superadmin demo flows:

- `apps/psg-hub/src/app/ops/admin/users/page.tsx` - added on both sides.
- `apps/psg-hub/src/app/ops/bsm-progress/page.tsx` - added on both sides.
- `apps/psg-hub/src/app/ops/bsm-review-workspace/__tests__/page.test.ts` - added on both sides.
- `apps/psg-hub/src/app/ops/companies/page.tsx` - content conflict.
- `apps/psg-hub/src/app/ops/page.tsx` - content conflict.
- `apps/psg-hub/src/app/ops/production/page.tsx` - content conflict.
- `apps/psg-hub/src/app/review-workspace/reviewer-workspace.tsx` - added on both sides.
- `apps/psg-hub/src/components/ops/bsm-content-approval-manager.tsx` - recovery branch adds a large new manager.
- `apps/psg-hub/src/components/ops/mail-artwork-editor.tsx` - added on both sides.
- `apps/psg-hub/src/components/ops/template-gate-actions.tsx` - content conflict.
- `apps/psg-hub/src/components/ops/user-access-manager.tsx` - added on both sides.
- `apps/psg-hub/src/components/ops/__tests__/bsm-content-approval-manager.test.tsx` - added on both sides.
- `apps/psg-hub/src/components/ops/__tests__/user-access-manager.test.tsx` - added on both sides.

Resolution rule: split by surface. Superadmin user management should be resolved
with the mainline lifecycle work. Content approval and review workspace should be
resolved as one bundle because the UI, tests, and routes depend on each other.
Production and mail-artwork should be resolved separately because they touch print
workflow behavior.

Focused verification after resolution:

```bash
pnpm --filter psg-hub test -- src/app/ops src/components/ops src/app/review-workspace
```

### Auth and Demo Entry Points

These conflicts affect whether demo users can sign in, recover access, and land on
the right surface:

- `apps/psg-hub/src/app/(auth)/forgot-password/page.tsx` - added on both sides.
- `apps/psg-hub/src/app/(auth)/login/page.tsx` - content conflict.
- `apps/psg-hub/src/app/auth/callback/route.ts` - added on both sides.
- `apps/psg-hub/src/app/auth/callback/__tests__/route.test.ts` - added on both sides.
- `apps/psg-hub/src/components/auth/forgot-password-form.tsx` - added on both sides.
- `apps/psg-hub/src/components/auth/reset-password-form.tsx` - added on both sides.
- `apps/psg-hub/src/components/auth/signup-form.tsx` - content conflict.

Resolution rule: preserve the mainline sign-up and password recovery fixes. Then
reapply only demo routing behavior that is needed for the Riverside walkthrough.

Focused verification after resolution:

```bash
pnpm --filter psg-hub test -- src/app/auth src/components/auth
pnpm --filter psg-hub test:e2e -- --grep "auth|clean BSM demo"
```

## Largest UI Overlaps

The branch also has large UI additions and rewrites that need careful review because
they change the visible app. Some are direct merge conflicts; the rest may merge
cleanly but still need product review before the recovered branch can be trusted:

- `apps/psg-hub/src/components/ops/bsm-content-approval-manager.tsx` - 1,682 added lines.
- `apps/psg-hub/src/components/ops/mail-artwork-editor.tsx` - 1,620 added lines.
- `apps/psg-hub/src/app/dashboard/analytics/page.tsx` - 793 added / 182 removed lines.
- `apps/psg-hub/src/components/analytics/direct-mail-panel.tsx` - 650 added lines.
- `apps/psg-hub/src/components/ops/user-access-manager.tsx` - 632 added lines.
- `apps/psg-hub/src/app/review-workspace/reviewer-workspace.tsx` - 621 added lines.
- `apps/psg-hub/src/app/dashboard/page.tsx` - 587 added / 21 removed lines.

## Other Conflicts Ada/Ravi Should Own

The merge simulation also reported conflicts outside Nora's UI/demo/E2E lane,
including API routes, library modules, migrations, schema manifests, and workflow
files. Those should stay in Ada/Ravi's server-side recovery lane, but Nora's UI
resolution depends on them for:

- content approval and review workspace API behavior;
- direct-mail metrics API behavior;
- shop switch behavior;
- production document behavior;
- auth callback behavior;
- package scripts and Playwright setup.

## Recommended Resolution Order

1. Resolve `package.json`, `playwright.config.ts`, and `e2e/*` first so every later
   UI resolution has one repeatable browser-test harness.
2. Resolve auth pages/forms and callback routing so the demo logins land correctly.
3. Resolve customer dashboard and analytics UI, including direct-mail metrics and
   Riverside demo fallbacks.
4. Resolve content approvals and review workspace as one bundle.
5. Resolve superadmin user management separately.
6. Resolve production/mail-artwork UI after the server-side production conflicts
   are settled.

## Verification Notes

Current checkout verification:

- Current branch relationship to `origin/main` is 167 commits behind and 336
  commits ahead.
- `git merge-tree --write-tree --messages origin/main HEAD` produced the conflicts
  listed above without changing the working tree.
- `rg -n '^(<<<<<<<|=======|>>>>>>>)'` found no live conflict markers in the
  scoped UI/demo/E2E files.
- `git diff --check origin/main...HEAD` found whitespace issues in two API files
  outside the core UI lane:
  - `apps/psg-hub/src/app/api/ads-mutations/gtm/status/__tests__/route.test.ts`
  - `apps/psg-hub/src/app/api/ads-mutations/gtm/status/route.ts`

No browser tests were run in this inventory heartbeat because the task was to map
conflicts, not resolve them.

## SOPs Checked

Relevant SOPs checked: board communication standard, Graphify code-navigation rule,
board escalation/review standard. No public/customer-facing change was shipped.

## PSG-2910 Resolution Update — 2026-08-19

The customer-facing interface, Riverside demo, sign-in, and browser-test batch is
resolved in the isolated `feat/psg-2908-bsm-recovery-preview` merge worktree.
This cleared 43 direct conflicts and reduced the shared merge from 107 unresolved
files to 64. The remaining conflicts are outside this UI/demo/browser-test batch
and are ready for the server-side owner to resolve in the same merge.

For every direct conflict in this batch, the resolution keeps the current mainline
file. This is intentional: current mainline already contains the recovered
Riverside demo, content-review, analytics, and review-workspace behavior, plus the
later browser-test stability, accessibility contrast, and production safety fixes.
Taking the older recovery-branch side would have removed those fixes. Recovery
files that merged without a conflict remain included in the shared merge.

Resolved areas:

- the app package and Playwright browser-test configuration;
- analytics, production, review-workspace, and superadmin browser tests and fixtures;
- login, password recovery, sign-up, and authentication callback behavior;
- customer dashboard, analytics, approvals, and Riverside content pages;
- staff operations pages, content approvals, production, and review workspace;
- shared analytics, authentication, dashboard, and operations components and tests.

There is no unresolved customer-facing product decision in this batch. Nothing was
deployed or made public. Graphify was checked before verification, but the isolated
merge worktree has no generated code graph; refreshing it during an intentionally
conflicted merge would produce an unreliable graph, so verification used the exact
conflict inventory above.
