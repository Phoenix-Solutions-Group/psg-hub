# Phase 19: Secure Document Review - Context

**Gathered:** 2026-07-28
**Status:** Ready for research
**Source:** User brief plus PSG Hub module decision

<domain>
## Phase Boundary

Create a PSG Hub module where authorized PSG staff upload one HTML, DOCX, or PDF document, invite one or more reviewers, collect comments anchored to the displayed document, and receive a submitted review. Reviewers may be authenticated PSG Hub users or external guests using expiring links.

The module manages review workflow and document versions. It does not edit the document contents.

</domain>

<decisions>
## Locked Decisions

### Product placement
- D-01: Secure Document Review is a module inside PSG Hub, not a standalone application.
- D-02: Phase 19 follows the current v0.4 billing and v1.0 launch work; it does not interrupt Phases 15-18.

### Upload and display
- D-03: An authorized review administrator can upload one HTML, DOCX, or PDF file per document version.
- D-04: Every supported upload is normalized into one inert, consistently reviewable artifact; uploaded HTML must never execute as active content in a reviewer browser.
- D-05: The original upload and normalized review artifact remain in private Supabase Storage and are never exposed by a public storage URL.

### Persistence and authentication
- D-20: Supabase project `gylkkzmcmbdftxieyabw` is the system of record for module authentication, relational review state, comments, annotations, audit events, and private document objects.
- D-21: Supabase Auth handles authenticated reviewers; guest-review access is represented by module-owned recipient and token records in Postgres.
- D-22: Phase 19 authors and tests migrations locally. Naming the shared production project does not authorize a production migration, storage-bucket change, or data write.

### Reviewer access
- D-06: The first release supports both authenticated PSG Hub reviewers and external guest reviewers.
- D-07: Guest access uses an expiring, revocable, recipient-specific link. Raw access tokens are not stored.
- D-08: Authenticated access is limited to the specifically assigned review plus existing PSG Hub authorization rules.

### Comments and submission
- D-09: A reviewer can place a pin on a page and attach a comment to that exact location.
- D-10: A reviewer can edit or delete their own draft comments until submission.
- D-11: Submitting a review records a stable submitted snapshot and locks reviewer edits unless an administrator reopens it.
- D-12: The administrator can view submitted comments in document order, jump to each pin, and download the original document.

### Review iterations
- D-13: An administrator may upload a revised document as a new immutable version and invite reviewers again without overwriting prior reviews.
- D-14: Comments remain attached to the version that was reviewed; the system does not attempt to migrate anchors between versions.

### Notifications and audit
- D-15: PSG Hub sends an invitation email when a review is assigned and notifies the administrator when it is submitted.
- D-16: Upload, invitation, link revocation, submission, reopening, and version creation are auditable events.

### Safety and scope
- D-17: File type, actual MIME signature, and size are validated before storage or conversion.
- D-18: Conversion of untrusted files is isolated from the PSG Hub runtime and cannot make arbitrary network requests.
- D-19: The first release has no inline document editing, freehand drawing, shapes, real-time coauthoring, arbitrary public sharing, or automatic comment-anchor migration.

### Claude's Discretion
- Exact file-size and guest-link expiry defaults.
- Exact route names and component boundaries.
- Conversion runtime, provided it reuses PSG Hub or its existing hosting platform where practical and satisfies D-04, D-17, and D-18.
- Pin coordinate representation and responsive scaling method.
- Whether email reminders are included if they add no new infrastructure.

</decisions>

<requirements>
## Requirements

- SDR-01: Authorized PSG staff can create a review and upload HTML, DOCX, or PDF.
- SDR-02: The system validates and stores the original in private Supabase Storage, then creates an inert normalized review artifact in private Supabase Storage.
- SDR-03: Staff can assign authenticated reviewers and invite guest reviewers with expiring, revocable links.
- SDR-04: A reviewer can open only assigned reviews and cannot enumerate other reviews or storage objects.
- SDR-05: A reviewer can place, edit, and delete page pins with comments before submission.
- SDR-06: Pin placement remains aligned when the document is zoomed or resized.
- SDR-07: Submission locks a stable comment snapshot and notifies the administrator.
- SDR-08: Staff can inspect submitted comments in page order and jump from a comment to its pin.
- SDR-09: Staff can reopen a review or create a new document version without changing historical submissions.
- SDR-10: Security tests cover token hashing, expiry, revocation, authorization boundaries, malicious file rejection, and active-HTML isolation.
- SDR-11: Accessibility tests cover keyboard pin selection, visible focus, readable comment relationships, and non-pointer navigation.
- SDR-12: Supabase project `gylkkzmcmbdftxieyabw` owns Auth, Postgres module state, and private Storage objects; local verification proves the schema and RLS before any production gate.

</requirements>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project state and sequencing
- `.paul/PROJECT.md` - PSG Hub product boundaries, roles, constraints, and established integrations.
- `.paul/ROADMAP.md` - Phase placement after the v1.0 launch gate.
- `.paul/STATE.md` - Current milestone status and production boundaries.

### Existing patterns to reuse
- `src/lib/report/storage.ts` - Private Supabase Storage and dependency-injected storage testing.
- `src/lib/report/download.ts` - Membership-gated private PDF download behavior.
- `src/lib/report/render.ts` - Existing HTML-to-PDF report rendering seam.
- `src/lib/auth/shop-access.ts` - Existing authenticated shop-access checks.
- `src/lib/email/sendgrid.ts` - Existing PSG email adapter.
- `.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md` - Binding migration and production-safety protocol.

### Supabase target
- Supabase project `gylkkzmcmbdftxieyabw` - Existing shared PSG Hub Auth, Postgres, and Storage system of record. Read-only grounding only during planning; production mutation requires a later operator gate.

</canonical_refs>

<deferred>
## Deferred Ideas

- Inline editing of HTML, Word, or PDF contents.
- Real-time cursor presence or simultaneous collaborative editing.
- Freehand drawing, rectangles, arrows, stamps, and signature workflows.
- Automatic anchor migration or visual diffing between document versions.
- Public anonymous links that are not recipient-specific and expiring.
- Multi-document review packages.

</deferred>

---

*Phase: 19-secure-document-review*
*Context gathered: 2026-07-28*
