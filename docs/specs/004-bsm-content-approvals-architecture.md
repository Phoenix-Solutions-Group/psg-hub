# BSM Content Approvals Architecture

**Status:** Engineering foundation for PSG-2245.

## Bottom Line

BSM content approvals use the `bsm_content_review_*` tables as the active
system of record. Each review item belongs to one shop, has one current version,
keeps historical versions, records customer comments and decisions, and appends
an event record for every review action that matters.

The older `content_approval_*` tables from
`20260717023000_bsm_content_approval_visibility.sql` are not the implementation
path for first-release customer approvals. They remain migration history until a
separate cleanup task consolidates or removes them.

## Business Rules

- A customer can only see approval records for shops they belong to.
- A customer can only comment or decide on review items where they are an
  assigned reviewer.
- Only shop owners and shop managers can approve, decline, request updates, or
  ask PSG to restore an older version.
- PSG-only notes stay hidden from customer users.
- Restore requests do not change the active version. A PSG admin must approve
  and apply the restore.
- Every decision and restore request must leave an audit trail with who acted,
  when they acted, the review item, and the affected version.

## Active Data Model

| Table | Purpose |
| --- | --- |
| `bsm_content_review_items` | One approval request tied to `shop_id`, optional `customer_profile_id`, optional source `content_items.id`, current status, and `current_version_id`. |
| `bsm_content_review_versions` | Versioned file or generated-page payloads. One version per item can have `status = 'current'`. |
| `bsm_content_review_reviewers` | Reviewer allow-list for a review item. This narrows access beyond shop membership. |
| `bsm_content_review_comments` | Customer or PSG comments with explicit visibility. First-release customer comments use `shop_and_psg`; PSG-private comments use `psg_private`. |
| `bsm_content_review_decisions` | Customer or PSG approval decisions against a specific version. |
| `bsm_content_restore_requests` | Customer requests to restore an older version. Requests stay `pending` until PSG resolves them. |
| `bsm_content_review_events` | Append-only audit log for item creation, comments, decisions, restore requests, and future admin restore outcomes. |

Uploaded files live in the private Supabase storage bucket
`bsm-content-approvals`. Object paths must start with the shop ID:
`{shopId}/{reviewItemId}/{versionId}/{fileName}`.

## Access Model

Customer access has two layers:

1. Shop membership: the user must belong to the item shop via `shop_users`.
2. Reviewer assignment: the user must be listed on `bsm_content_review_reviewers`
   for that item, unless the row is intentionally assigned to all shop users.

Database row-level security enforces tenant isolation for direct database reads.
Application routes repeat the same check before using the service role for
multi-table reads and writes.

PSG admin access is route-gated through `manage_bsm_content_approvals` before
service-role writes. Admin writes should also create `bsm_content_review_events`
rows and, where applicable, existing PSG audit records.

## Workflow

1. PSG creates a review item from an uploaded file or generated page.
2. PSG creates version 1, marks it current, assigns reviewers, and records
   `review_item_created`.
3. Customer reviewers open the dashboard review page.
4. Customers add comments or make a decision. Each action writes the business
   record and then appends a matching event log row.
5. If updates are needed, PSG creates a new version and supersedes the old
   current version.
6. If a customer requests an older version, the request stays pending until PSG
   approves or rejects it.
7. Approved content is shown in the approved-content archive from the decision
   and current version records.

## Verification Checklist

- Unit tests cover file validation, review item creation, generated-page review
  creation, comment events, decision events, and restore-request events.
- Migration tests cover the visibility vocabulary and row-level security helper
  for the older visibility tables while they remain in the schema history.
- Before shipping a milestone, run a database-policy check that proves a user
  from Shop A cannot read Shop B approval rows or storage objects.
- Before production release, Tess should run the customer workflow: upload or
  generated-page review, customer comment, customer approval/update request,
  restore request, and PSG admin restore resolution.

## Sources Reviewed

- `Reference.md`
- `docs/runbooks/graphify-codebase-graph.md`
- gbrain page `projects/bsm/planning`
- Graphify query: BSM content approval access and database relationships
- `apps/psg-hub/supabase/migrations/20260717021500_bsm_content_approval_review_items.sql`
- `apps/psg-hub/src/lib/bsm/content-approvals.ts`
- `apps/psg-hub/src/lib/bsm/customer-content-review.ts`
