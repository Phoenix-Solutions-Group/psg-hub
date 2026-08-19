# PSG-2860 Recovery Branch API/Server Conflict Inventory

Date: 2026-08-19
Owner: Ravi
Branch inspected: `feat/psg-790-tedesco-lead-endpoint`
Comparison target: `origin/main`

## Bottom Line

The recovery branch has no literal merge-conflict markers in API/server files, and the route ownership guard passes. The remaining risk is behavioral conflict: several server areas changed on both the recovery branch and `main`, so Ada should make the final keep/split/drop calls before this branch is merged.

I did not edit route behavior in this pass. There were no safe text conflicts to resolve directly, and changing the overlapping behavior without Ada's merge-queue decision would risk dropping already-shipped work.

## Scope Checked

- API routes: `apps/psg-hub/src/app/api/**`
- Server libraries: `apps/psg-hub/src/lib/**`
- Server scripts: `apps/psg-hub/scripts/**`
- Database-adjacent files: `apps/psg-hub/supabase/**`
- Runtime config: `apps/psg-hub/vercel.json`

## Branch Size

- Branch relation to `origin/main`: `333` commits ahead, `167` commits behind.
- Full three-dot changed-file count: `513` files.
- Server-side files changed versus `origin/main`: `288` files.
- Server-side adds/modifies/deletes versus `origin/main`: `125` added, `124` modified, `39` deleted.
- API route area changed versus `origin/main`: `62` files, including `40` route handlers and `22` API tests.
- Server-library area changed versus `origin/main`: `183` files, including `80` tests.
- Supabase/config area changed versus `origin/main`: `27` files.

## Checks Run

```bash
rg -n "^(<<<<<<<|=======|>>>>>>>)" apps/psg-hub/src apps/psg-hub/scripts apps/psg-hub/supabase apps/psg-hub/vercel.json package.json pnpm-lock.yaml
```

Result: no conflict markers found.

```bash
COREPACK_HOME="$PWD/.corepack" node apps/psg-hub/scripts/check-route-ownership.mjs
```

Result: passed. It checked `245` hub routes and `30` legacy routes, with `4` approved exact overlaps.

Graphify was used before broad repo reading:

```bash
graphify query "where are Next.js API routes, server actions, middleware, and route handlers in psg-hub" --budget 1500
```

## Can Resolve Directly

These are safe to reconcile as mechanical or evidence-preserving changes once Ada opens the merge batch:

- Keep newly added tests beside their matching route/library when the implementation is also kept.
- Keep harmless support scripts that only read or dry-run data and have tests, such as Pipedrive audit/cleanup helpers, after secret and no-write checks.
- Keep added read/status endpoints only when they are route-owner clean and have auth coverage, such as Google Ads audit downloads, GTM status, and Yext status/import routes.
- Remove deleted tests only when their covered module is also intentionally removed or superseded by an equivalent test in the recovery branch.
- Preserve database migrations in timestamp order, but do not apply production migrations from this recovery branch until Ada confirms the final migration set.

## Needs Ada Decision

These are behavior overlaps where both sides may contain valid work. Do not silently choose one version.

1. **Pipedrive server flow**
   - Changed routes: `cron/pipedrive-sync`, `cron/pipedrive-recurring`, `ops/pipedrive/asana-migrate`, `ops/pipedrive/onboarding-setup`, `webhooks/pipedrive`.
   - Changed libraries/scripts: `src/lib/pipedrive/**`, `src/lib/crm/pipedrive/**`, `scripts/pipedrive-*.mjs`.
   - Decision needed: which Pipedrive automations are approved for the recovery merge, and which remain separate tools or follow-up issues.

2. **Content approval and review workspace**
   - Changed routes: `bsm/content-approvals/**`, `bsm/review-workspace/**`, `ops/bsm/review-workspace/**`, `reviews/[id]/**`.
   - Changed libraries: `src/lib/bsm/content-approvals*`, `src/lib/bsm/customer-content-review.ts`, `src/lib/bsm/review-workspace.ts`.
   - Decision needed: keep the new comment/attachment/version/restore-request behavior only after Ada confirms it matches the approved BSM review contract.

3. **Production printing and mail artwork**
   - Changed routes: `production/**`, `ops/production/templates/**`.
   - Changed libraries: `src/lib/production/**`.
   - Deleted libraries: `src/lib/mail-artwork/**`, replaced by production/postcard rendering changes.
   - Decision needed: whether `mail-artwork` is truly superseded or must be preserved for existing production templates.

4. **Import and direct-mail eligibility**
   - Changed routes: `ops/import/validate`, `ops/import/commit`.
   - Changed libraries: `src/lib/ops/import/**`, `src/lib/ops/mail/**`.
   - Changed migrations: import suppression/direct-mail eligibility related migrations.
   - Decision needed: confirm final import suppression and eligibility rules before merging because they affect mail-send eligibility and customer data handling.

5. **Billing, admin, and auth**
   - Changed routes: billing checkout/portal in committed diff, auth post-login, shop switch, admin tier/user routes.
   - Deleted route: `shop/settings`.
   - Changed libraries: `src/lib/auth/**`, `src/lib/ops/user-management.ts`, `src/lib/ops/security-profiles.ts`.
   - Decision needed: verify the latest `main` billing/auth/admin behavior is not lost, especially for tenant access and user lifecycle flows.

6. **Cron and outbound-message paths**
   - Changed routes: `cron/monthly-report`, `cron/nurture-publish`, `cron/board-briefing-email`, plus Pipedrive cron routes.
   - Changed libraries: `src/lib/board-briefing/**`, `src/lib/nurture/**`, `src/lib/report/**`.
   - Decision needed: no outbound email/publish behavior should be activated from this branch without owner confirmation and focused tests.

7. **Database migration ordering**
   - Changed files include `25` migration files plus `supabase/config.toml`, `schema-manifest.json`, and a seed file.
   - Decision needed: Ada should reconcile duplicate or superseded migrations before any production database action. This inventory is not approval to apply migrations.

## Deleted Server-Side Files To Review

- `apps/psg-hub/src/app/api/ops/admin/analytics/sync/route.ts`
- `apps/psg-hub/src/app/api/ops/reviews/restore-requests/[id]/route.ts`
- `apps/psg-hub/src/app/api/shop/settings/route.ts`
- `apps/psg-hub/src/lib/analytics/manual-sync.ts`
- `apps/psg-hub/src/lib/auth/auth-errors.ts`
- `apps/psg-hub/src/lib/bsm/demo-analytics-context.ts`
- `apps/psg-hub/src/lib/content-quality/**`
- `apps/psg-hub/src/lib/mail-artwork/**`
- `apps/psg-hub/src/lib/pipedrive/flip-deals-won.ts`
- `apps/psg-hub/src/lib/production/postcard-registry.ts`
- `apps/psg-hub/src/lib/report/run-cron.ts`
- `apps/psg-hub/src/lib/shop/settings-validation.ts`

## Recommended Next Action

Ada should split the server merge queue by the seven decision groups above. Ravi can take the direct-resolution batches after Ada confirms the intended behavior for each group, starting with low-risk status/read routes and their tests.

Relevant SOPs checked: board communication standard, Graphify code-navigation rule, board escalation/review standard.
