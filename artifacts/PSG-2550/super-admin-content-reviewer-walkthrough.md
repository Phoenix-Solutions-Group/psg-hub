# Super Admin Walkthrough: Content Approvals Review Workspace

**Issue:** PSG-2550  
**Audience:** PSG super admin or internal operator leading the human test  
**Last updated:** 2026-08-03  
**Status:** Ready for Nick review after the workspace-first Content Approvals rework.

## Bottom Line

Use this walkthrough to test the corrected Content Approvals experience as a PSG super admin. The current flow is workspace-first: create or choose one Review Workspace for one body shop, add one or more documents, add reviewers, preview the reviewer experience, start the review, then confirm the invited reviewer can comment and submit a decision.

## Direct Links

- Super admin Content Approvals screen: https://home.psgweb.me/ops/bsm-content-approvals
- Reviewer link format after starting a review: `https://home.psgweb.me/review-workspace?invite=<invite-token>`
- Sample files in the repo: `artifacts/PSG-2550/sample-files/`

## What To Say First

"Content Approvals gives PSG one controlled place to send customer marketing work for approval. A super admin creates a private Review Workspace for one shop, adds the files or generated pages the customer needs to review, chooses the reviewers, and starts a secure review. The customer uses a private link and one-time code to add comments and approve or request changes."

Business value:

- PSG can review full content packages instead of chasing approvals through email.
- Each workspace is tied to one shop, which reduces the risk of showing the wrong content to the wrong customer.
- Decisions, comments, files, and versions stay auditable.

## Pre-Walkthrough Checklist

- Sign in with a PSG operations account that has the `manage_bsm_content_approvals` permission.
- Use one demo shop for the entire walkthrough.
- Use demo-safe files only. Do not upload customer lists, insurance documents, credentials, invoices, or production records.
- Keep one reviewer email available for the test. Use a safe internal or test inbox unless Nick approves a real customer invite.
- Open the sample folder: `artifacts/PSG-2550/sample-files/`.

## Current Upload Types To Test

These are the file types currently accepted by the super-admin Content Approvals upload control. Each file must be under 25 MB.

| Sample file | Type tested | Expected behavior |
| --- | --- | --- |
| `bsm-review-sample-proof.pdf` | PDF | Uploads as a review document and opens from the proof link. |
| `bsm-review-sample-mailer.docx` | Word document, DOCX | Uploads as a review document and opens from the proof link or attachment behavior provided by the browser. |
| `bsm-review-sample-landing.html` | HTML | Uploads as a review document. The app stores HTML safely and opens the proof through the review link. |
| `bsm-review-sample-copy.md` | Markdown | Uploads as a document-type review file. |
| `bsm-review-sample-copy.txt` | Plain text | Uploads as a document-type review file. |
| `bsm-review-sample-before-after.png` | PNG image | Uploads and previews as an image. |
| `bsm-review-sample-before-after.jpg` | JPG image | Uploads and previews as an image. |
| `bsm-review-sample-before-after.webp` | WebP image | Uploads and previews as an image. |

Important note for Nick: the underlying review-workspace processing code has a contract for DOC files and HTML ZIP packages, but the current super-admin upload control does not expose DOC or ZIP upload as a testable path on this screen. Do not mark DOC or HTML ZIP as passed from this walkthrough until a visible upload path exists.

## Human Test Walkthrough

### 1. Open Content Approvals

1. Go to https://home.psgweb.me/ops/bsm-content-approvals.
2. Confirm the page title says **Content Approvals**.
3. Confirm the page explains that each approval is managed as a **Review Workspace**.
4. In **Shop**, choose the demo shop.

Expected result: the page shows workspace controls, reviewer controls, document controls, and a table named **Workspace documents**.

### 2. Create A Review Workspace

1. In **Workspace title**, enter a clear title, for example `Nick QA - August content review`.
2. In **Reviewer instructions**, enter a short instruction, for example `Please check the offer, phone number, and requested changes before approval.`
3. Select **Create workspace**.

Expected result: the new workspace is selected in **Review Workspace**, and the page shows a success message that the workspace is ready for documents and reviewers.

What to say: "A one-document approval and a multi-document approval now use the same workspace model. That keeps reviewer progress and decisions in one place."

### 3. Add Reviewers

1. In **Reviewer email**, enter the test reviewer email.
2. In **Reviewer name**, enter the reviewer name if available.
3. Select **Add reviewer**.
4. If saved reviewer contacts appear, also test selecting one saved contact.

Expected result: the selected reviewer appears as a small selected reviewer row or chip. Removing the reviewer should also work.

What to say: "The reviewer is selected before starting the round. That prevents the review from being sent with no responsible customer contact."

### 4. Add The First Uploaded File

1. In **Review title**, enter `PDF proof review`.
2. In **Context note for the customer**, enter `Please confirm this proof is ready for customer-facing use.`
3. Leave the source switch on **File**.
4. Choose `artifacts/PSG-2550/sample-files/bsm-review-sample-proof.pdf`.
5. Select **Add document**.

Expected result:

- The document appears in **Workspace documents**.
- The document is attached to the selected Review Workspace.
- The item enters edit mode so a super admin can adjust the title, note, or replacement file before reviewer submission.

### 5. Add A Generated Page

1. Select **Generated page**.
2. In **Review title**, enter `Generated landing page review`.
3. In **Context note for the customer**, enter `Please review this generated page before PSG schedules it.`
4. In **Generated page path**, enter `/generated/demo-shop/august-offer`.
5. In **Preview URL**, enter a safe demo URL if one exists. Otherwise leave it blank.
6. In **Source content ID**, enter a demo ID if one exists. Otherwise leave it blank.
7. Select **Attach**.

Expected result: the generated page appears in **Workspace documents** as a generated-page item.

### 6. Add The Remaining Sample Files

Repeat the file upload step for each sample file listed in "Current Upload Types To Test."

For each file:

1. Give the document a simple title that names the file type.
2. Add a customer context note.
3. Select the sample file.
4. Select **Add document**.
5. Confirm it appears in **Workspace documents**.

Expected result: each accepted file appears in the workspace document list. If any current sample file is rejected, record the exact file name and error message.

### 7. Edit A Document Before Submission

1. Find one uploaded document in **Workspace documents**.
2. Select **Edit**.
3. Change the title or context note.
4. For an uploaded file, choose a replacement file from the sample folder.
5. Select **Save edit**.

Expected result: the document updates and the page shows that the edit was saved as the usable version.

What to say: "A super admin can correct the item before the customer submits a decision. That makes the workspace usable for real production review instead of treating the first upload as final forever."

### 8. Preview The Workspace

1. Confirm the Review Workspace is selected.
2. Select **Preview read-only**.
3. Review the document list shown in preview mode.
4. For at least one document with an **Open proof** link, open the proof.

Expected result:

- Preview mode says comments and decisions are not saved there.
- Documents show their processing status and review status.
- Proof links open in a new tab when available.

### 9. Start The Review

1. Confirm the page does not show a blocker message.
2. Confirm at least one document is attached.
3. Confirm at least one reviewer is selected.
4. Select **Start review**.

Expected result:

- The page shows **Review started**.
- It lists how many documents were sent and how many reviewers were invited.
- Each reviewer has a private `/review-workspace?invite=...` link and a one-time code.

If **Start review** is disabled, check the blocker message. The expected blockers are:

- Create or select a Review Workspace first.
- Add at least one document before starting review.
- Start review is available after every document finishes processing successfully.
- Choose at least one reviewer before starting review.

### 10. Open The Reviewer Experience

1. Copy one reviewer link from **Review started**.
2. Open the full link using the production base URL: `https://home.psgweb.me/review-workspace?invite=<invite-token>`.
3. Enter the one-time code shown for that reviewer.
4. Select **Open review**.

Expected result: the reviewer sees the private Body Shop Marketer Review workspace with the documents listed.

What to say: "The reviewer does not need broad PSG Hub access. They use a private invite and code for this review."

### 11. Review The Actual File

1. In the reviewer workspace, open at least one proof.
2. Confirm the proof content matches the file or generated page added by the super admin.
3. For image files, confirm the image renders in the review area.
4. For non-image files, confirm the proof link or embedded proof opens without showing private storage paths or internal error details.

Expected result: the reviewer can inspect the actual proof content or proof link before making a decision.

### 12. Add A Private Comment

1. Select **Comment on this document** for the document being tested.
2. In **Private comment**, enter `Please update the offer wording before approval.`
3. Select **Add suggestion**.

Expected result: the comment appears in **Private comments** with a pin number. The comment remains part of the reviewer workspace.

### 13. Request Changes

1. Choose **Request changes**.
2. In **Decision note**, enter `The offer needs one wording update before approval.`
3. Select **Submit review**.

Expected result:

- The review becomes read-only after submit.
- The reviewer sees the submitted state.
- If the review round is still active, the reviewer can use **Reopen response**.

### 14. Reopen And Approve

1. Select **Reopen response**.
2. Choose **Approve**.
3. Update the decision note if needed.
4. Select **Submit review** again.

Expected result: the revised submission is saved. This confirms that a reviewer can revise while the round remains open.

### 15. Confirm Super Admin Tracking

1. Return to https://home.psgweb.me/ops/bsm-content-approvals.
2. Confirm the workspace document table shows comment counts and the latest decision.
3. Confirm the workspace row reflects the active review state.

Expected result: PSG staff can see customer feedback and decision status without relying on an email thread.

### 16. Remove Demo Documents

Use this only for demo records.

1. In **Workspace documents**, choose a demo item.
2. Select **Remove**.
3. Confirm the remove action.

Expected result: the item leaves the active workspace document list.

## Features Covered

- Super-admin access gate for Content Approvals.
- Shop-scoped workspace selection.
- Review Workspace creation.
- Reviewer instructions.
- Saved reviewer contact selection.
- New reviewer entry.
- File upload review documents.
- Generated-page review documents.
- Required title and customer context note.
- Required Review Workspace before attaching documents.
- File size and file type validation.
- Edit title, note, and replacement file before submission.
- Attach existing unattached items to the selected workspace.
- Read-only workspace preview.
- Start review.
- Reviewer invite link and one-time code.
- Reviewer secure access screen.
- Reviewer document list.
- Proof opening from the reviewer workspace.
- Private reviewer comments.
- Change-request requirement that at least one comment exists before requesting changes.
- Approve decision.
- Changes-requested decision.
- Submitted review read-only state.
- Reopen response while the round remains active.
- Admin tracking of comments and latest decision.
- Remove from active library for demo cleanup.

## Pass Or Fail Checklist

Mark the walkthrough as passed only if all of these are true:

- The Content Approvals link opens for a PSG super admin.
- A Review Workspace can be created for one demo shop.
- At least one reviewer can be added.
- PDF, DOCX, HTML, Markdown, text, PNG, JPG, and WebP sample files can each be tested through the current upload control.
- A generated-page review item can be attached.
- Preview read-only works and does not save comments or decisions.
- Start review produces a reviewer link and one-time code.
- The reviewer can open the review with the link and code.
- The reviewer can inspect the actual proof or proof link.
- The reviewer can add a private comment.
- The reviewer can request changes after adding a comment.
- The reviewer can reopen and resubmit while the round remains active.
- The super admin can see the resulting comments and latest decision.
- Demo records can be removed from the active list after testing.

## Known Gap To Confirm Before Public Customer Rollout

The current super-admin screen does not expose DOC upload or HTML ZIP upload, even though the lower-level processing contract includes those file kinds. Nick should not sign off that DOC and HTML ZIP are customer-ready from this walkthrough alone. They need either a visible upload path or a separate release note saying those formats are deferred.

## Safety Rules

- Do not upload real customer private documents.
- Do not use a real customer email unless Nick approves that customer-facing test.
- Do not share invite links or one-time codes outside the test group.
- Do not publish this as a customer-facing guide until Nick approves it.

## Sources Checked

- `Reference.md`
- `docs/runbooks/graphify-codebase-graph.md`
- Graphify query: `where are the content reviewer, content approvals, workspaces, file upload, and review routes in psg-hub`
- PSG-2605 completed requirements summary
- `apps/psg-hub/src/app/ops/bsm-content-approvals/page.tsx`
- `apps/psg-hub/src/components/ops/bsm-content-approval-manager.tsx`
- `apps/psg-hub/src/lib/bsm/content-approvals-shared.ts`
- `apps/psg-hub/src/lib/bsm/review-workspace-processing.ts`
- `apps/psg-hub/src/app/review-workspace/reviewer-workspace.tsx`

## Notes For PSG-2550

This is an internal operator walkthrough and human test guide. It does not publish customer-facing documentation or promote a public launch.
