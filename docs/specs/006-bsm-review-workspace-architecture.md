# BSM Review Workspace Architecture

**Status:** Architecture draft for PSG-2350. Do not treat this as approval to
ship production schema changes.

## Bottom Line

Build the Body Shop Marketer review workspace by extending the existing
`bsm_content_review_*` foundation. The current system already owns shop-scoped
review items, immutable versions, reviewer assignment, comments, decisions,
private storage paths, and append-only event rows. The v2 workspace should add
project, round, invitation, processing, session, thread, summary, and deletion
lifecycle tables around that foundation instead of replacing it.

The implementation should not start until Ravi's file-processing proof
(PSG-2349) confirms the safe limits and tooling for 100 MB files, legacy DOC
conversion, malware scanning, HTML ZIP handling, background jobs, deletion, and
storage cost.

## Sources Reviewed

- PSG-2350 issue body and PSG-2341 approved feature plan.
- PSG-2349 proof task status. No proof results were available as of this draft.
- `Reference.md`
- `PLANNING.md`
- `.paul/codebase/ARCHITECTURE.md`
- `.paul/codebase/STACK.md`
- `.paul/codebase/STRUCTURE.md`
- `.paul/codebase/CONVENTIONS.md`
- `.paul/codebase/TESTING.md`
- `apps/psg-hub/.paul/STATE.md`
- `apps/psg-hub/.paul/MILESTONES.md`
- `docs/runbooks/graphify-codebase-graph.md`
- Graphify query: `where are BSM review workspace review response version restore approval routes and data services`
- Graphify query: `what files define bsm_content_review tables and customer content review service`
- `docs/specs/004-bsm-content-approvals-architecture.md`
- `docs/specs/005-bsm-content-approver-v2-plan.md`
- PSG-2341 attachment `19-UI-SPEC.md`
- `apps/psg-hub/supabase/migrations/20260717021500_bsm_content_approval_review_items.sql`
- `apps/psg-hub/supabase/migrations/20260717190000_harden_bsm_content_approval_advisors.sql`
- `apps/psg-hub/src/lib/bsm/content-approvals.ts`
- `apps/psg-hub/src/lib/bsm/content-approvals-shared.ts`
- `apps/psg-hub/src/lib/bsm/customer-content-review.ts`
- `apps/psg-hub/src/app/api/ops/bsm/content-approvals/route.ts`
- `apps/psg-hub/src/lib/auth/ops-access.ts`
- `apps/psg-hub/src/lib/audit/access-audit.ts`

## Existing Foundation To Extend

| Existing area | Keep | Extend for v2 |
| --- | --- | --- |
| `bsm_content_review_items` | Current document-level approval request tied to one `shop_id`, current version, status, source content item, and creator. | Add nullable `project_id`, `section_id`, `initial_round_id`, ordering, document processing state, required flag, and deletion timestamps. Each workspace document remains one review item. |
| `bsm_content_review_versions` | Immutable document version record with storage bucket/path, filename, content type, checksum, preview type, and one current version per item. | Add original artifact fields, processed review artifact fields, sanitized HTML manifest, page count, dimensions, scan status, conversion status, and `round_id` that introduced the version. Never overwrite storage paths. |
| `bsm_content_review_reviewers` | Profile-based allow-list for v1 customer reviewers. | Keep for authenticated PSG Hub customers; add nullable `invitation_id`, reviewer display/email fields, active round membership, and submission state. Do not force guest reviewers into `profiles`. |
| `bsm_content_review_comments` | Comment body, visibility, marker JSON, author profile, soft-delete marker. | Preserve body storage; add `thread_id`, `invitation_id` or `reviewer_session_id`, pin number, normalized page/viewport coordinates, draft/submitted lock fields, and immutable snapshot fields for submitted comments. |
| `bsm_content_review_decisions` | Per-document decision for current v1 vocabulary. | Scope to `round_id`, `invitation_id`, and `version_id`; map v2 labels to `approve` and `request_updates`; require a submitted pin comment before `request_updates`. |
| `bsm_content_restore_requests` | v1 customer restore request for older versions. | Keep for v1 content approval restore. Do not reuse for v2 document replacement or 30-day project recovery; those need project lifecycle tables. |
| `bsm_content_review_events` | Append-only event table for review actions. | Continue as the module event log, but add project, round, invitation, thread, processing job, summary, and tombstone references. Keep one row for every operational action that matters. |
| Private bucket `bsm-content-approvals` | Shop-prefixed private object storage. | Reuse the bucket if proof confirms it is suitable. Move v2 paths to `{shopId}/{projectId}/{documentId}/{versionId}/{artifactKind}/{fileName}` and keep originals separate from processed review copies. |
| `manage_bsm_content_approvals` | PSG admin capability gate for current ops routes. | Keep for admin access. Add collaborator checks so a PSG staff member can only work on projects they created, were named on, or accessed as audited superadmin support. |
| `recordAuditEvent` | Append-only PSG admin audit row for privileged writes. | Continue for privileged route-level changes, and add new closed-vocabulary audit actions before implementation. Use `bsm_content_review_events` for module timeline and `access_audit` for admin accountability. |

## Proposed Tables

### `bsm_content_review_projects`

One private workspace for one shop/customer.

Key fields:

- `id uuid primary key`
- `shop_id uuid not null references shops(id)`
- `title text not null`
- `description text`
- `status text not null`: `draft`, `processing`, `ready`, `active`, `completed`, `closed_early`, `archived`, `deleting`, `deleted`
- `owner_profile_id uuid not null references profiles(id)`
- `current_round_id uuid null`
- `created_by_profile_id uuid not null`
- `created_at`, `updated_at`
- `archived_at`
- `deleted_at`
- `recover_until`
- `metadata_jsonb jsonb not null default '{}'`

Rules:

- Exactly one shop owns the project.
- Only PSG staff with `manage_bsm_content_approvals` can create projects.
- Project access for PSG staff is owner, named collaborator, or audited superadmin support.
- `deleted_at` disables reviewer access immediately. Permanent purge happens after `recover_until`.

### `bsm_content_review_project_collaborators`

Named PSG users who can support a project.

Key fields:

- `id uuid primary key`
- `project_id uuid not null references bsm_content_review_projects(id)`
- `shop_id uuid not null`
- `profile_id uuid not null references profiles(id)`
- `role text not null`: `owner`, `collaborator`, `support`
- `added_by_profile_id uuid not null`
- `added_at`
- `removed_at`

Rules:

- Unique active row per `project_id, profile_id`.
- `support` is for superadmin break-glass access and must write both
  `bsm_content_review_events` and `access_audit`.

### `bsm_content_review_sections`

Named project sections with ordering. No nested folders.

Key fields:

- `id uuid primary key`
- `project_id uuid not null`
- `shop_id uuid not null`
- `title text not null`
- `position integer not null`
- `created_at`, `updated_at`
- `deleted_at`

Rules:

- Unique active `position` per project.
- Documents are ordered within sections through `bsm_content_review_items`.

### Extensions To `bsm_content_review_items`

Keep each document as one review item.

Add fields:

- `project_id uuid references bsm_content_review_projects(id)`
- `section_id uuid references bsm_content_review_sections(id)`
- `position integer`
- `required boolean not null default true`
- `processing_status text not null default 'pending'`: `pending`, `uploading`, `scanning`, `converting`, `sanitizing`, `ready`, `failed`, `quarantined`, `deleted`, `replaced`
- `processing_error_code text`
- `processing_error_message text`
- `latest_processing_job_id uuid`
- `deleted_at timestamptz`
- `replaced_by_review_item_id uuid`

Rules:

- v1 rows may have `project_id = null`.
- v2 rows must have `project_id` and `section_id`.
- A project cannot start a round until every required item is `ready`.
- Keep the current 25 MB limit until PSG-2349 proves the requested 100 MB path.

### Extensions To `bsm_content_review_versions`

Keep versions immutable.

Add fields:

- `project_id uuid`
- `round_id uuid null`
- `original_storage_bucket text`
- `original_storage_path text`
- `processed_storage_bucket text`
- `processed_storage_path text`
- `processed_content_type text`
- `artifact_manifest_jsonb jsonb not null default '{}'`
- `page_count integer`
- `desktop_viewport_jsonb jsonb`
- `mobile_viewport_jsonb jsonb`
- `scan_status text`: `pending`, `clean`, `infected`, `failed`
- `conversion_status text`: `not_needed`, `pending`, `complete`, `failed`
- `sanitization_status text`: `not_needed`, `pending`, `complete`, `failed`
- `introduced_by_round_id uuid`
- `superseded_by_version_id uuid`

Rules:

- Original and processed artifacts are separate private objects.
- PDF originals may also be the review copy if scan passes.
- DOC/DOCX must produce an immutable PDF review copy before reviewer access.
- HTML/ZIP must produce an inert review artifact and manifest before reviewer access.

### `bsm_content_review_rounds`

One review cycle inside a project.

Key fields:

- `id uuid primary key`
- `project_id uuid not null`
- `shop_id uuid not null`
- `round_number integer not null`
- `status text not null`: `draft`, `inviting`, `active`, `completed`, `closed_early`, `cancelled`
- `started_by_profile_id uuid`
- `started_at`
- `completed_at`
- `closed_by_profile_id`
- `closed_at`
- `closed_reason text`
- `outcome text`: `approved`, `changes_requested`, `closed_early`, `cancelled`
- `summary_version_id uuid null`
- `created_at`, `updated_at`

Rules:

- Unique `project_id, round_number`.
- A normal round is `approved` only when every active reviewer approves every required document.
- Any requested change makes the outcome `changes_requested`.
- `closed_early` must never be reported as unanimous approval.
- Closing early revokes outstanding invitations and stores non-responder data for the summary.

### `bsm_content_review_round_documents`

Which documents need a fresh decision in a round.

Key fields:

- `id uuid primary key`
- `round_id uuid not null`
- `project_id uuid not null`
- `shop_id uuid not null`
- `review_item_id uuid not null`
- `version_id uuid not null`
- `decision_required boolean not null`
- `carried_from_round_id uuid null`
- `carried_decision_id uuid null`
- `created_at`

Rules:

- One row per document per round.
- Changed documents require fresh decisions.
- Unchanged documents can visibly carry forward prior decisions.

### `bsm_content_review_invitations`

Email invitations for account and guest reviewers.

Key fields:

- `id uuid primary key`
- `project_id uuid not null`
- `round_id uuid not null`
- `shop_id uuid not null`
- `reviewer_profile_id uuid null`
- `reviewer_email text not null`
- `reviewer_name text`
- `status text not null`: `draft`, `sent`, `viewed`, `submitted`, `expired`, `revoked`, `superseded`
- `token_hash text not null`
- `code_hash text null`
- `code_attempt_count integer not null default 0`
- `last_code_sent_at`
- `expires_at not null`
- `reminder_due_at`
- `reminder_sent_at`
- `resend_of_invitation_id uuid null`
- `revoked_by_profile_id uuid null`
- `revoked_at`
- `submitted_at`
- `created_by_profile_id uuid not null`
- `created_at`, `updated_at`

Rules:

- Maximum 20 active invitations per round.
- Invitations expire after 14 days unless proof/UX updates the policy before build.
- One automatic day-7 reminder.
- Resending creates a new invitation and supersedes the old one.
- Store only hashes of invitation tokens and one-time codes.
- Reviewers see the whole project but only their own comments and submission.

### `bsm_content_review_sessions`

Verified reviewer device sessions.

Key fields:

- `id uuid primary key`
- `invitation_id uuid not null`
- `project_id uuid not null`
- `round_id uuid not null`
- `shop_id uuid not null`
- `session_hash text not null`
- `device_label text`
- `verified_at not null`
- `last_seen_at`
- `expires_at not null`
- `revoked_at`
- `created_at`

Rules:

- Session expiry cannot outlive invitation expiry.
- Revoked or superseded invitations revoke sessions immediately.
- Store only a session hash, never the raw cookie/token value.

### `bsm_content_review_comment_threads`

Stable triage state for submitted pin comments and clarification replies.

Key fields:

- `id uuid primary key`
- `project_id uuid not null`
- `round_id uuid not null`
- `shop_id uuid not null`
- `review_item_id uuid not null`
- `version_id uuid not null`
- `owner_invitation_id uuid not null`
- `root_comment_id uuid null`
- `pin_number integer not null`
- `status text not null`: `draft`, `submitted`, `open`, `accepted`, `declined`, `needs_clarification`, `clarification_answered`, `resolved`
- `triaged_by_profile_id uuid null`
- `triaged_at`
- `clarification_opened_at`
- `clarification_closed_at`
- `created_at`, `updated_at`

Rules:

- Threads belong to one reviewer invitation.
- Reviewers never see another reviewer's threads.
- `needs_clarification` reopens only this thread. It does not unlock the original decision or unrelated comments.

### Extensions To `bsm_content_review_comments`

Add fields:

- `thread_id uuid references bsm_content_review_comment_threads(id)`
- `round_id uuid`
- `invitation_id uuid null`
- `reviewer_session_id uuid null`
- `comment_kind text`: `pin`, `clarification_reply`, `psg_reply`, `system_note`
- `draft_status text`: `draft`, `submitted`, `locked`
- `pin_number integer`
- `page_number integer`
- `viewport text`: `desktop`, `mobile`, `pdf_page`
- `x_ratio numeric`
- `y_ratio numeric`
- `selection_jsonb jsonb not null default '{}'`
- `submitted_at`
- `locked_at`

Rules:

- Pin coordinates are normalized ratios, not pixels.
- Submitted comments are immutable. Add replies instead of editing originals.
- `psg_private` remains hidden from reviewers.
- A reviewer can insert or update only their own drafts before submission; after submission they can only add clarification replies when that thread is reopened.

### Extensions To `bsm_content_review_decisions`

Add fields:

- `project_id uuid`
- `round_id uuid`
- `invitation_id uuid null`
- `carried_from_decision_id uuid null`
- `submitted_at`
- `locked_at`

Rules:

- One active reviewer decision per `round_id, review_item_id, version_id, invitation_id`.
- V2 display labels map to stored values:
  - `Approved as-is` -> `approve`
  - `Changes requested` -> `request_updates`
- `request_updates` requires at least one submitted pin comment for the same reviewer, round, document, and version.

### `bsm_content_review_processing_jobs`

Background job state for scan, conversion, sanitization, ZIP extraction, preview generation, deletion, and summary generation.

Key fields:

- `id uuid primary key`
- `project_id uuid not null`
- `review_item_id uuid null`
- `version_id uuid null`
- `round_id uuid null`
- `shop_id uuid not null`
- `kind text not null`: `upload_scan`, `pdf_preview`, `doc_to_pdf`, `html_sanitize`, `zip_extract`, `summary_pdf`, `purge`
- `status text not null`: `queued`, `running`, `succeeded`, `failed`, `cancelled`
- `attempt_count integer not null default 0`
- `idempotency_key text not null`
- `input_jsonb jsonb not null default '{}'`
- `output_jsonb jsonb not null default '{}'`
- `error_code text`
- `error_message text`
- `queued_at`, `started_at`, `finished_at`
- `created_by_profile_id uuid null`
- `created_at`, `updated_at`

Rules:

- Unique `idempotency_key`.
- Jobs must be retry-safe and must not create duplicate versions, summaries, events, invitations, or storage objects.
- Do not promote an artifact to `ready` unless the scan/conversion/sanitization manifest passes.

### `bsm_content_review_summaries`

Generated consolidated summary outputs.

Key fields:

- `id uuid primary key`
- `project_id uuid not null`
- `round_id uuid not null`
- `shop_id uuid not null`
- `status text not null`: `queued`, `generated`, `failed`, `deleted`
- `storage_bucket text`
- `storage_path text`
- `generated_by_profile_id uuid not null`
- `generated_at`
- `payload_jsonb jsonb not null default '{}'`
- `created_at`, `updated_at`

Rules:

- Summaries are private storage objects.
- Include project, round, document versions, reviewer decisions, numbered pins, replies, triage statuses, reviewer attribution, non-responders, and early-close reason.
- Summary generation is operational reporting, not a legal signature.

### `bsm_content_review_deletion_tombstones`

Minimal audit record after permanent purge.

Key fields:

- `id uuid primary key`
- `project_id uuid not null`
- `shop_id uuid not null`
- `project_title text`
- `deleted_by_profile_id uuid not null`
- `deleted_at not null`
- `purged_at not null`
- `reason text`
- `counts_jsonb jsonb not null default '{}'`
- `retention_policy text not null default '30_day_recoverable_delete'`

Rules:

- Keep only minimal operational evidence.
- Do not keep reviewer comments, files, tokens, one-time codes, or session data in the tombstone.

## Lifecycle States

### Project

- `draft`: PSG is creating sections, documents, and collaborators.
- `processing`: at least one required document is not ready.
- `ready`: all required documents are ready and a round can be started.
- `active`: a round is open to reviewers.
- `completed`: final round completed normally.
- `closed_early`: latest round closed by PSG before all reviewers submitted.
- `archived`: visible to PSG but not actively reviewable.
- `deleting`: inside the 30-day recovery window.
- `deleted`: permanently purged except for tombstone.

### Document

- `pending`, `uploading`, `scanning`, `converting`, `sanitizing`, `ready`, `failed`, `quarantined`, `deleted`, `replaced`.

### Round

- `draft`, `inviting`, `active`, `completed`, `closed_early`, `cancelled`.

### Invitation

- `draft`, `sent`, `viewed`, `submitted`, `expired`, `revoked`, `superseded`.

### Thread

- `draft`, `submitted`, `open`, `accepted`, `declined`, `needs_clarification`, `clarification_answered`, `resolved`.

## Authorization And Privacy Rules

Plain-language requirements:

- Each shop only sees its own records. Every new table stores `shop_id`, and every database policy checks that the requester belongs to that shop or is authorized PSG staff.
- Reviewers only see the project tied to their invitation. A reviewer invitation or verified session is the reviewer authorization source, not a public link and not the dashboard shop switcher.
- Reviewers never see other reviewers' comments, drafts, decisions, sessions, or invitation status.
- PSG staff only see projects they are allowed to support: creator, named collaborator, or audited superadmin support.
- Guest reviewers do not need PSG Hub accounts, but their token, one-time code, and device session must be hashed, rate-limited, expirable, and revocable.
- Deleting a project immediately removes reviewer access. Permanent deletion after 30 days removes files, comments, invitations, sessions, jobs, and summaries, leaving only a tombstone.

Database policy shape:

- Keep default-deny row-level security on every new table.
- Use `shop_id` on every table to simplify tenant filtering and indexes.
- Customer account policies can continue using `public.user_shop_ids()` for authenticated reviewers.
- Guest reviewer routes should use service-role reads only after validating an invitation/session hash, expiry, revocation state, and project status in application code. Guest access should not receive broad database grants.
- PSG staff routes should call `requireOpsFn("manage_bsm_content_approvals")`, then verify project collaborator access before service-role writes.
- Superadmin support should require an `access_audit` row explaining the support action.

Storage policy shape:

- Keep storage private.
- Use paths under `{shopId}/{projectId}/{documentId}/{versionId}/{artifactKind}/{fileName}`.
- Never expose raw storage paths, raw tokens, parser errors, or stack details to reviewers.
- Signed URLs should be short-lived and only issued after route-level authorization.
- No reviewer download button in v2.

## Service Boundaries

### Admin project service

Owns:

- Create/archive/delete/recover projects.
- Add/remove PSG collaborators.
- Add/reorder sections.
- Start rounds and close rounds early.
- Enforce project collaborator access after `manage_bsm_content_approvals`.
- Write `bsm_content_review_events` and `access_audit` for privileged changes.

Recommended location:

- Extend `apps/psg-hub/src/lib/bsm/content-approvals.ts` or split to
  `apps/psg-hub/src/lib/bsm/review-workspace/admin.ts` once implementation begins.

### Document service

Owns:

- File validation.
- Version creation.
- Original and processed storage path construction.
- Required document readiness.
- Replacement upload and immutable version rules.

Important constraint:

- Current shared validation allows 25 MB and includes images, Markdown, and text.
  The approved v2 promise is PDF, DOC, DOCX, HTML, and HTML ZIP up to 100 MB.
  Do not change the shared runtime limit or public promise until PSG-2349 proves it.

### Processing job service

Owns:

- Creating idempotent scan/conversion/sanitization/summary/purge jobs.
- Updating per-document status from job results.
- Ensuring failed/quarantined files cannot be invited.
- Recording machine-readable output manifests.

Implementation dependency:

- Wait for PSG-2349 to recommend whether this runs in Vercel Sandbox, an existing worker pattern, Supabase jobs, or a separate queue.

### Invitation and session service

Owns:

- Creating invitations.
- Sending and resending email.
- Hashing tokens and one-time codes.
- Verifying codes.
- Creating verified device sessions.
- Revoking, expiring, and superseding invitations.
- Day-7 reminder scheduling.

Rules:

- Never store raw token/code/session values.
- Resend creates a new invitation.
- Verified sessions expire no later than the invitation.

### Reviewer workspace service

Owns:

- Reading project, sections, documents, current review copies, and the reviewer's own draft/submitted state.
- Saving draft pins and comments.
- Recording document decisions.
- Validating `Changes requested` requires a submitted pin comment.
- Submitting and locking one reviewer response for a round.
- Handling clarification replies without reopening unrelated work.

Rules:

- Authenticated reviewers go through existing Supabase auth plus reviewer assignment.
- Guest reviewers go through invitation/session validation only.
- Phones may read but should not be allowed to place pins unless UX later proves it.

### Triage service

Owns:

- PSG status changes on submitted comment threads.
- PSG replies.
- Needs-clarification reopen and close.
- Immutable history of triage actions.

Rules:

- Triage changes require project staff authorization.
- Every triage action writes `bsm_content_review_events`.

### Summary and lifecycle service

Owns:

- Consolidated PDF summary generation.
- Early-close non-responder summary.
- Archive, 30-day recovery, permanent purge, and tombstone creation.

Rules:

- Summary output must identify closed-early rounds plainly.
- Purge jobs must be idempotent and must not leave live invitations or sessions behind.

## Migration Risks

| Risk | Why it matters | Required mitigation |
| --- | --- | --- |
| Parallel schema drift | The repo already has v1 `bsm_content_review_*` tables and older `content_approval_*` migration history. | Extend v1 tables. Do not create a second review subsystem. Add compatibility columns that allow existing v1 rows with `project_id = null`. |
| Reviewer identity split | V1 assumes `profile_id`; v2 allows invited reviewers without PSG Hub accounts. | Keep profile-based reviewers for authenticated users and add invitation/session rows for guests. Do not create fake profiles for guests. |
| Guest access bypassing row-level security | Guest users cannot rely on Supabase authenticated policies. | Keep guest database grants closed. Validate invitation/session in server routes before service-role reads. |
| Comment isolation | Reviewers must not see each other's comments. | Scope comments and threads by `invitation_id` and filter every reviewer read by that id/session. Add policy tests for reviewer A vs reviewer B. |
| 100 MB and 50-document ceiling | Current limit is 25 MB, and 50 x 100 MB implies a 5 GB project before processed copies. | Hold public limits behind PSG-2349 measurements and a shared server-owned config. |
| DOC conversion and HTML ZIP safety | Unsafe conversion or ZIP extraction can expose active content, external requests, or path traversal. | Wait for PSG-2349 proof. Require scan/conversion/sanitization manifests before `ready`. |
| Event and admin audit gaps | The module will contain customer-facing decisions and privileged staff actions. | Write `bsm_content_review_events` for module history and `access_audit` for privileged admin/support actions. Add audit action vocabulary before code. |
| Deletion completeness | Permanent purge must remove files, comments, invitations, sessions, jobs, and summaries while retaining a minimal audit tombstone. | Build purge as an idempotent job with counts and post-purge verification. |
| Existing code paths | `listBsmContentApprovals`, current API routes, and customer review routes expect item-level records. | Keep item-level APIs working for v1 rows. Add v2-specific services/routes rather than breaking existing v1 calls. |

## Prerequisites From Ravi's Proof Work

Ada should not open implementation until PSG-2349 answers these items:

- Proven maximum file size for upload, processing, preview, and delete in the chosen runtime.
- Whether the v2 launch promise can be 100 MB or must use a lower measured limit.
- PDF preview approach and page/image/text extraction approach.
- DOC and DOCX conversion tool choice, runtime, fidelity, and failure mode.
- Malware scanning tool choice, quarantine behavior, and clean/infected test result.
- HTML sanitization policy and proof that scripts, event handlers, forms, unsafe URLs, external network calls, and downloads are blocked.
- HTML ZIP extraction proof for path traversal, symlinks, executable files, unsupported content, and expansion limits.
- Background job runtime and queue recommendation, including 50-document processing estimate.
- Deletion proof for original files, processed files, sessions, invitations, comments, summaries, and tombstone retention.
- Storage cost estimate for worst-case project size, including processed copies and summaries.

## Implementation Readiness Checklist

Before schema implementation:

- Update this architecture with PSG-2349 proof results.
- Confirm final file limits in one shared server-owned config.
- Confirm Noelle's UX route and state decisions are reflected in route contracts.
- Add migration plan that preserves existing v1 rows.
- Add RLS tests for shop isolation, reviewer invitation isolation, PSG collaborator access, and guest denial without valid session.
- Add service tests for idempotent job creation, immutable versions, decision lock, comment isolation, clarification reopen, early close, and purge.
- Add `access_audit` action vocabulary for project create/update/delete/recover, collaborator changes, invitation revoke/resend, round close, superadmin support, summary generation, and purge.
- Route public/customer-facing launch through Tess QA and Nick approval.

## Non-Goals For PSG-2350

- No production schema changes.
- No storage bucket creation.
- No customer-facing routes or public links.
- No file conversion or malware scanning implementation.
- No deployment.
