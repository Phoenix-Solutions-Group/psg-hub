# PSG Hub

PSG Hub is the unified product through which collision repair shops and PSG staff access PSG services.

## Language

**Body Shop Marketer (BSM)**:
The shop-facing marketing product offered and branded within PSG Hub. BSM names the offer, not a separate application or visual brand.
_Avoid_: Standalone BSM platform, separate BSM application, BSM design system

**Strategic Report**:
The board-facing forward plan for BSM, reconciled to PSG Hub's current capabilities, unresolved bets, and next decisions.
_Avoid_: Greenfield build plan, engineering backlog, unabridged workstream compilation

**Review Workspace**:
The single container for a shop's review activity, including a required title and overall reviewer instructions, one or more documents, selected reviewers, comments, decisions, and review rounds. Each document has a display name and may have its own note. Every approval uses a Review Workspace, including a review of only one document.
_Avoid_: Standalone Content Approval, approval item, separate document-review flow

**Content Approvals**:
The single PSG Hub destination for creating, previewing, sending, and monitoring Review Workspaces. Its top-level queue lists Review Workspaces, with document and reviewer progress beneath each one. It may contain separate task-focused views, but users never choose between competing approval products or navigation entries. This plural name identifies the product surface, not a separate record type or workflow.
_Avoid_: BSM Review Workspace as a second navigation area, Content Approval as an individual record

**Review Document**:
A versioned uploaded or PSG-generated deliverable inside a Review Workspace that a reviewer must approve or request changes to. Content Approvals does not edit the deliverable; an admin uploads or regenerates a new immutable version after making changes in its source tool. Supported uploads use the workspace's safe review-copy pipeline rather than a separate approval flow.
_Avoid_: Content Approval, content item

**Review Round**:
A bounded, immutable request for selected reviewers to evaluate a fixed set of Review Document versions and submit their decisions. Documents added after a round starts are queued for the next round. A round may complete when all active reviewers submit or when an admin closes it early.
_Avoid_: Approval cycle, mutable review session

**Review Invitation**:
A recipient-specific access link sent by PSG Hub when a review starts and protected by the reviewer's one-time email code. The admin may copy or resend the same invitation link; it is not a public workspace link.
_Avoid_: Shared public link, anonymous review link, generic workspace URL

**Reviewer**:
A contact associated with the Review Workspace's shop who is invited to review without needing a PSG Hub account. An admin may select an existing shop contact or create a new shop contact while assigning reviewers.
_Avoid_: Arbitrary email recipient, PSG Hub user requirement, anonymous commenter

**Workspace Preview**:
The admin's optional, read-only simulation of the complete reviewer experience before a round starts, including document order, instructions, rendering, and comment controls. Preview actions do not persist and the interface must clearly identify Preview mode.
_Avoid_: File thumbnail, admin edit view, test submission

**Start Review**:
The explicit, confirmed admin action that freezes a ready document set into a Review Round and sends each selected reviewer a Review Invitation. It is distinct from Preview and cannot run while a required review copy is still processing or quarantined.
_Avoid_: Review button, implicit send, preview-and-send action

**Round Result**:
The aggregate outcome of a Review Round. A round completes automatically only after every active reviewer submits; revoking an invitation removes that reviewer from the requirement. The result is Approved only when every active reviewer approves every required document, otherwise it is Changes requested. An admin may instead end an incomplete round as Closed early, which records nonresponders and never represents unanimous approval.
_Avoid_: Majority approval, silent timeout completion, early close reported as Approved

**Review Submission**:
A reviewer's versioned set of document decisions and annotations for a Review Round. While the round is open, the reviewer may explicitly reopen a submission, returning their progress to In progress, then edit and submit a new revision. Every submitted revision remains in the audit history; a closed round cannot be reopened by the reviewer.
_Avoid_: Silently mutable submission, overwritten review history, post-close edit

**Review Annotation**:
A comment anchored to a specific Review Document version by either a positioned pin or a selected-text highlight. Highlights are available only when the safe review copy exposes selectable text; image-only pages use pins and are not OCR-processed. An annotation never floats forward to a different document version without an explicit new anchor.
_Avoid_: Unanchored change request, cross-version comment position

**Historical Content Approval**:
A completed or archived record from the approval system that preceded Review Workspaces. It remains read-only and visible within Content Approvals for audit history; it cannot start a new review flow.
_Avoid_: Legacy creation path, editable legacy approval
