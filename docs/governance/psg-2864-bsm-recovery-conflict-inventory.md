# PSG-2864 BSM Recovery Conflict Inventory and Duplicate-File Policy

**Issue:** PSG-2864 - Create BSM recovery conflict inventory and duplicate-file policy
**Owner:** Ravi
**Date:** 2026-08-19
**Status:** Ready for Ada's recovery merge queue

## Bottom Line

This document gives the BSM recovery team a simple rule before conflict resolution
starts: do not silently choose between duplicate or competing files. Keep the active
`apps/psg-hub` path as the product source, preserve accepted task evidence, and split
unclear behavior differences into follow-up issues owned by the right person.

The current checkout does not contain unresolved git conflict markers in the active
tree. The recovery risk is parallel work: many files are changed locally, several
new files are untracked, and the recovery branch is both ahead of and behind
`origin/main`.

## Current Recovery Snapshot

- Branch checked: `feat/psg-790-tedesco-lead-endpoint`
- Short commit checked: `77411766`
- Relationship to `origin/main`: 167 commits behind and 333 commits ahead
- Dirty worktree: yes, with many unrelated modified and untracked files already
  present before this inventory was written
- Live conflict markers: none found in the scoped active tree with
  `rg -n '^(<<<<<<<|=======|>>>>>>>)'`
- Exact duplicate tracked file contents in scoped active docs/source search: none found
- Migration filename duplicates: none found in `apps/psg-hub/supabase/migrations`

## Duplicate-File Policy

Use these rules for every recovery conflict and duplicate path.

1. Keep `apps/psg-hub` as the active product app.
   `psg-advantage-portal` is reference-only unless a separate approved task says
   otherwise.
2. Keep the version with passing focused tests and the most recent accepted
   Paperclip evidence when both sides added the same file for the same behavior.
3. If two files implement different business behavior, do not bury the choice in
   a merge. Create a follow-up issue that names the owner, decision needed, and
   customer or operations impact.
4. Preserve append-only history for audits, approvals, production, webhooks, and
   imports. Do not delete audit rows, historical versions, or idempotency records
   as a shortcut for conflict resolution.
5. For database migrations, never rename or reorder a migration already applied to
   a shared environment. Add a new corrective migration instead.
6. For customer-facing pages, emails, downloadable files, public pages, or visible
   demo flows, require Tess QA evidence and Nick approval before production use.
7. For security-sensitive changes, including authentication, customer data access,
   secret handling, row-level data locks, adapter credentials, and admin powers,
   route the decision to Ada before merge.
8. If the merge winner is unclear after reading tests and task evidence, leave the
   parent recovery work blocked on a named owner and exact decision rather than
   guessing.

## Conflict Inventory

| Area | Files or source of truth | Current risk | Policy for recovery |
| --- | --- | --- | --- |
| Active app versus legacy portal | `apps/psg-hub/docs/ops/route-ownership/README.md`, `route-ownership-manifest.json`, `psg-advantage-portal/` | New work can accidentally recreate old portal routes or revive legacy behavior. | Keep `apps/psg-hub`; use the route ownership manifest for overlaps; legacy portal remains reference-only. |
| Content approvals v1 versus review workspace v2 | `docs/specs/004-bsm-content-approvals-architecture.md`, `docs/specs/005-bsm-content-approver-v2-plan.md`, `docs/specs/006-bsm-review-workspace-architecture.md` | Multiple documents describe related approval systems; a merge could accidentally create a second product path. | `bsm_content_review_*` stays the active foundation. Older `content_approval_*` tables remain migration history until a cleanup task. V2 extends, not replaces, the foundation. |
| Content review migrations | `20260717021500_bsm_content_approval_review_items.sql`, `20260728183000_bsm_review_workspace_foundation.sql`, later fix migrations through `20260803174500_bsm_content_review_round_revisions.sql` | Many migrations touch the same table family, so ordering and applied-history mistakes can break customer review data. | Do not rename applied migrations. Keep corrective migrations additive and tenant-safe. Verify row-level access rules before release. |
| Import pipeline and suppression rules | `apps/psg-hub/src/lib/ops/import/**`, `20260629000000_filemaker_staging_ingest.sql`, `20260717180500_import_suppression_rules.sql` | Import work is currently both modified and has untracked additions, including suppression handling. | Resolve by behavior tests first. Imports must stay idempotent and shop-safe; suppression must not be dropped during conflict resolution. |
| Google Ads customer request work | `apps/psg-hub/src/lib/google-ads/customer-requests.ts`, `apps/psg-hub/src/app/dashboard/ads/**`, `20260717000000_google_ads_customer_requests.sql` | Customer request UI/API work overlaps with dashboard edits and new untracked route files. | Keep customer-visible request behavior only when the API route, UI action, access check, and focused tests all agree. Customer-facing changes need QA before production use. |
| Production and mail modules | `apps/psg-hub/src/lib/production/**`, `apps/psg-hub/src/lib/ops/mail/**`, `20260717183000_production_document_print_idempotency.sql` | Production printing and mail history are operationally sensitive; duplicate decisions can double-print or lose history. | Preserve print idempotency, prior-send checks, and historical records. Any uncertain behavior gets an Ada decision before merge. |
| Public/demo verification files | `apps/psg-hub/e2e/**`, `apps/psg-hub/public/e2e-content-approval-*`, `apps/psg-hub/docs/runbooks/clean-bsm-demo-login-walkthrough.md` | Demo evidence files are partly untracked; a recovery merge could cite evidence that never lands on trunk. | Evidence must be committed or attached to the issue before it is used as proof. Demo/public paths need Tess QA and Nick review before going live. |
| Brand package and PSG assets | `packages/ui/psg-brand/**`, `docs/psg/logos-graphics/**` | Brand files are modified in the shared worktree and can affect visible UI broadly. | Do not mix brand asset decisions into server/API conflict batches. Route visual impact to Lee or the designated brand reviewer before release. |
| Paperclip helper code | `apps/psg-hub/src/lib/paperclip/issues.ts` | New untracked task-integration code may touch orchestration behavior. | Treat as internal integration code; avoid committing secrets, tokens, or broad permissions. Security-sensitive behavior needs Ada review. |

## Resolution Checklist For Each Conflict Batch

- Name the business area and owner.
- List files resolved.
- State which side was kept and why in plain language.
- Name any follow-up issue created for unresolved product or business decisions.
- Run the smallest relevant check, such as a route test, unit test, migration
  lint/read-through, or route ownership check.
- Confirm no secret values, customer records, or private source files were added.
- Leave a Paperclip comment with the result and relevant SOPs checked.

## Verification Performed For This Inventory

- Read project source-of-truth order in `Reference.md`.
- Read active recovery context in `docs/governance/psg-2857-process-reset-review.md`.
- Read route ownership guardrail in `apps/psg-hub/docs/ops/route-ownership/README.md`.
- Used Graphify before broad repo search:
  `graphify query "where are duplicate or recovered BSM files, specs, migrations, and route ownership documents tracked?" --budget 1500`
- Checked for unresolved conflict markers:
  `rg -n '^(<<<<<<<|=======|>>>>>>>)' --glob '!node_modules/**' --glob '!docs/Filemaker Exports/**' --glob '!graphify-out/**' --glob '!psg-worktrees/**' .`
- Checked migration filename duplicates:
  `git ls-files apps/psg-hub/supabase/migrations | sed 's#.*/##' | sort | uniq -d`
- Checked scoped tracked exact duplicate file contents across active source and docs with `sha256sum`.

No runtime code was changed for this inventory.
