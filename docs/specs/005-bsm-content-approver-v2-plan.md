# BSM Content Approver V2 Plan

**Status:** Draft for PSG-2341. Needs Noelle product/UX review before implementation tasks are split out.

## Bottom Line

Build Content Approver v2 as a document review workspace on top of the current
`bsm_content_review_*` foundation, not as a separate product. The existing v1
tables already give PSG a shop-scoped approval record, versions, reviewers,
comments, decisions, private storage, and audit events. V2 should extend that
model with projects, rounds, one-time-code reviewer invitations, document
processing, pinned feedback, triage, and summary generation.

This must remain a PSG Hub module, not a standalone product, separate customer
portal, or separate deployment. This work should stay behind the current v0.4
milestone until the technical proofs are complete and the CEO assigns a roadmap
slot. The largest risks are 100 MB document processing, legacy DOC conversion,
safe HTML ZIP rendering, malware scanning, and background-job capacity.

## Sources Reviewed

- `Reference.md`
- `README.md`
- `apps/psg-hub/README.md`
- `docs/runbooks/graphify-codebase-graph.md`
- Graphify query: `BSM content approval access and database relationships`
- Graphify query: `where are BSM content review routes services and tests`
- Graphify query: `private storage email pdf worker patterns in psg-hub`
- `docs/specs/004-bsm-content-approvals-architecture.md`
- `apps/psg-hub/supabase/migrations/20260717021500_bsm_content_approval_review_items.sql`
- `apps/psg-hub/src/lib/bsm/content-approvals.ts`
- `apps/psg-hub/src/lib/bsm/customer-content-review.ts`
- `apps/psg-hub/src/app/api/ops/bsm/content-approvals/route.ts`
- `apps/psg-hub/src/components/ops/bsm-content-approval-manager.tsx`
- `apps/psg-hub/src/lib/mail/sendgrid.ts`
- `apps/psg-hub/src/lib/report/storage.ts`
- `apps/psg-hub/workers/report-renderer/README.md`
- GitHub issue 10: `Spec: PSG Hub document review workspace for website and
  marketing approvals`

Note: the PSG knowledge base endpoint was present in the runtime, but the
heartbeat did not include a valid authorization token for read-only search.
This plan therefore uses repository sources and Graphify only.

## Existing Foundation To Reuse

| Existing area | Keep using it for V2 |
| --- | --- |
| `bsm_content_review_items` | Treat each document as a review item, linked to one project and one round. |
| `bsm_content_review_versions` | Store immutable uploaded or processed document versions. Never overwrite files. |
| `bsm_content_review_reviewers` | Extend from profile-based reviewers to invite-based reviewers. |
| `bsm_content_review_comments` | Keep comment bodies and add pin, viewport, thread, and triage metadata. |
| `bsm_content_review_decisions` | Keep per-document decisions, with V2 vocabulary mapped to approved or changes requested. |
| `bsm_content_review_events` | Continue append-only audit for every important action. |
| Private Supabase storage | Keep original uploads private; add processed review copies and generated summaries. |
| `manage_bsm_content_approvals` | Keep PSG admin route gating and audit writes. |
| SendGrid adapter | Send invitations, one-time codes, reminders, and round notifications. |
| Report PDF worker pattern | Generate the consolidated PDF summary after round completion or early close. |

## Proposed V2 Domain Model

Add these concepts without removing the current v1 tables:

| New concept | Purpose |
| --- | --- |
| `bsm_content_review_projects` | One private workspace for one shop/customer. Holds project title, status, owner, collaborators, deletion lifecycle, and audit metadata. |
| `bsm_content_review_project_collaborators` | Named PSG users who can work on the project, plus audited superadmin support. |
| `bsm_content_review_sections` | Named sections with ordering. No nested folders. |
| `bsm_content_review_rounds` | Review round state: draft, inviting, active, completed, closed early. |
| `bsm_content_review_invitations` | Emailed reviewer invites, expiry, revoked state, reminder state, one-time-code challenge state, and verified-device session links. |
| `bsm_content_review_document_requirements` | Which documents require a fresh decision in a round; unchanged documents carry decisions forward. |
| `bsm_content_review_comment_threads` | Stable thread and triage state for submitted pin comments and clarification replies. |
| `bsm_content_review_processing_jobs` | Background processing state for PDF, DOC/DOCX conversion, HTML sanitization, ZIP extraction, malware scan, and summary generation. |
| `bsm_content_review_sessions` | Verified reviewer devices authorized until invitation expiry or revocation. |
| `bsm_content_review_tombstones` | Minimal audit record retained after permanent deletion. |

Recommended relationship: projects contain sections; sections contain ordered
`bsm_content_review_items`; rounds choose reviewers and document requirements;
decisions and comments remain tied to item versions.

## Workflow

1. PSG creates a project for one shop and adds named PSG collaborators.
2. PSG adds sections and uploads up to 50 documents.
3. Each upload creates an original private object and a processing job.
4. Processing produces an immutable review copy:
   - PDF stays PDF.
   - DOC/DOCX becomes a PDF review copy.
   - HTML is sanitized and isolated.
   - HTML ZIP bundles are safely extracted, sanitized, and served from a private review path.
5. Invitations stay disabled until all required documents are ready.
6. PSG starts a round and invites up to 20 reviewers by email.
7. Reviewers authenticate with an emailed one-time code. A verified device remains authorized until expiry or revocation.
8. Reviewers see the full project, but only their own comments.
9. Reviewers place numbered pins and comments on desktop/tablet. Phones can read but should direct users to a larger screen for pin placement.
10. Each document requires either Approved as-is or Changes requested. Changes requested requires at least one pin comment.
11. Reviewers can save drafts, then submit once. Submission locks pins, original comments, and decisions.
12. PSG triages submitted comments as Open, Accepted, Declined, or Needs clarification.
13. Needs clarification reopens only that comment thread for reviewer replies.
14. Replacement uploads create new immutable versions and a new round can require decisions only for changed documents.
15. A round completes automatically when all active reviewers submit, or PSG can close it early with non-responders listed.
16. PSG generates a consolidated PDF summary for the project/round.

## File Processing Rules

- Raise the upload ceiling from 25 MB to the requested 100 MB only after proof testing.
- Allow PDF, DOC, DOCX, HTML, and HTML ZIP bundles. Remove images, Markdown, and plain text from the v2 public promise unless product explicitly keeps them.
- Store originals separately from processed review copies.
- Use private storage paths under the shop and project:
  `{shopId}/{projectId}/{documentId}/{versionId}/{artifactKind}/{fileName}`.
- Block active content, scripts, remote network requests, unsafe ZIP paths,
  symlinks, unsupported executable content, and excessive expansion.
- Keep processing status visible as Processing, Ready, or Failed.
- Keep invitations locked until required documents are Ready.
- Do not promote a quarantined file to the review workspace until its signature,
  scan, conversion, and output manifest all pass.

## Access And Security Rules

- PSG internal admins can create projects.
- Project access is limited to the creator, named PSG collaborators, and audited superadmin support.
- Reviewers do not need PSG Hub accounts.
- Reviewer access requires an emailed one-time code.
- Invitations expire after 14 days and can be revoked.
- One automatic reminder is sent on day 7.
- Resending creates a new invitation rather than reusing the old token.
- Reviewers never see another reviewer comments.
- No download button appears in the reviewer UI.
- Storage and data access must stay shop-scoped, with row-level database access rules and service-role route checks.
- Reviewer invite links, one-time codes, and verified-device sessions must be
  rate-limited, revocable, and stored without raw secrets.
- Public/customer-facing launch requires Nick approval and Tess QA before go-live.

## Technical Proofs Before Build

| Proof | Acceptance bar |
| --- | --- |
| 100 MB uploads | A 100 MB PDF uploads, processes, previews, and deletes without timeout or memory failure. |
| DOC conversion | Legacy `.doc` and modern `.docx` convert to stable PDF review copies with basic formatting preserved. |
| Malware scanning | Infected test fixture is rejected before reviewer access; clean fixtures pass. |
| HTML sanitization | Scripts, inline event handlers, forms, external network calls, and unsafe URLs are blocked. |
| HTML ZIP extraction | Path traversal, symlinks, executable files, and zip expansion attacks are rejected. |
| Background jobs | 50-document project completes within an agreed processing window and reports per-document failures clearly. |
| Storage cost | 50 documents at the maximum promised size has a measured monthly storage cost estimate. |
| PDF summary | Completed and closed-early rounds both generate summary PDFs with accurate reviewer attribution and non-responder information. |

## Implementation Slices

1. **Planning and UX alignment**
   - Noelle reviews the product flow, reviewer workspace, admin workspace, empty states, processing states, and phone/tablet behavior.
   - Ada finalizes the technical plan after UX review.

2. **Proof spike**
   - Build isolated proofs for conversion, scanning, HTML ZIP processing, and background execution.
   - Do not expose a customer-facing route yet.

3. **Schema and services**
   - Add project, round, invitation, processing, thread, session, and tombstone tables.
   - Extend existing content approval services rather than creating a parallel subsystem.
   - Add database access tests for shop isolation and reviewer comment isolation.

4. **Admin workspace**
   - Create project, section, upload, processing status, reviewer invite, resend, revoke, round start, round close, triage, clarification, replacement upload, and summary generation flows.

5. **Reviewer workspace**
   - Add one-time-code access, project reading, document preview, viewport-aware pins, draft saving, required decisions, submit locking, and clarification replies.

6. **Summary and lifecycle**
   - Generate consolidated PDF summaries.
   - Add soft delete, 30-day recovery, permanent purge, and tombstone retention.

7. **QA and approval**
   - Tess runs desktop/tablet/phone workflow checks, access isolation checks, processing failure checks, and summary PDF checks.
   - Nick reviews before any public/customer-facing launch.

## Noelle PMO Review Decision

Product direction is approved for proof-spike planning with UX refinement in
parallel. Use a hybrid admin workspace and a guided reviewer workspace:

- Admin workspace: project-first dashboard with a document library inside each
  project. PSG needs to manage by customer/project first, then by documents,
  reviewers, round status, and exceptions.
- Reviewer workspace: round checklist as the main path, with section navigation
  inside the project. The reviewer should always understand which documents
  still need a decision before submission.
- Pin interaction: desktop and tablet support numbered pins with comment drafts,
  drag/reposition before submit, and a visible selected-pin state. After submit,
  pins and original comments are locked.
- Carried-forward decisions: show them as already approved from a previous
  round, with the prior round name/date and a clear marker when a changed
  document requires a fresh decision.
- Phone behavior: phones can read documents, decisions, summaries, and
  clarification replies. Phones should not place pins in v2 unless UX proves the
  interaction is reliable.
- HTML preview fidelity: v2 needs enough fidelity for layout, copy, links, and
  visible marketing content review. It does not need to be a live website or
  support active scripts, forms, tracking, external calls, or downloads.

Additional states that must be covered before build:

- Processing: uploading, scanning, converting, ready, failed, retry requested,
  and deleted/replaced. Failed files must show the reason in plain language and
  keep invitations disabled when the failed file is required.
- Reminders: pending invite, viewed/not submitted, automatic day-7 reminder sent,
  manual resend sent, expired, and revoked.
- Locked submissions: submitted reviewers can read their final response and
  summary, but cannot change decisions, pins, or original comments unless PSG
  opens a clarification thread.
- Early close: PSG can close a round before every reviewer submits, with a
  required reason, non-responder list, and summary output that labels missing
  responses clearly.
- Clarification replies: reopening must be per comment thread only. The reviewer
  can reply in that thread, but cannot change the original decision or add new
  unrelated pins.
- Reviewer exit and recovery: reviewers need save-draft feedback, submit
  confirmation, expired-link recovery, revoked-link messaging, and wrong-code or
  too-many-attempts states.
- Round outcome labels: completed rounds must distinguish Approved, Changes
  requested, and Closed early. Closed early must never read like unanimous
  approval.
- Accessibility: keyboard users and screen-reader users must be able to move
  through documents, pins, comments, and decisions without relying only on visual
  pin placement or color.
- Lifecycle: completed projects need archive, delete, 30-day recovery, permanent
  purge, disabled access during recovery, and a minimal deletion audit record.
- Launch gate: no production migration, storage bucket creation, live customer
  invitation, public preview link, or customer-facing launch is authorized by
  this planning review.

## Recommendation

Approve this as the starting plan for proof spikes and UX refinement, not full
build. The critical path is:

1. Ada owns technical proof spikes for 100 MB uploads, document conversion,
   malware scanning, HTML ZIP handling, background jobs, storage cost, and PDF
   summary generation.
2. Axel owns the UX architecture pass for the admin workspace, reviewer
   workspace, state coverage, and desktop/tablet/phone behavior.
3. Full schema and UI implementation should wait until the proof-spike results
   and UX architecture pass are complete.

This keeps PSG from promising large-file processing, legacy DOC conversion, safe
HTML ZIP previews, and 50-document projects before the risks are measured.
