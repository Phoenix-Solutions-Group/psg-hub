# Super Admin Walkthrough: Content Reviewer Features

**Issue:** PSG-2550  
**Audience:** PSG super admin or internal operator leading a walkthrough  
**Last updated:** 2026-07-31  
**Status:** Internal walkthrough for the current BSM content review foundation plus planned reviewer workspace behavior.

## Bottom Line

Use this walkthrough to show how PSG prepares marketing content for customer review, keeps the content tied to the correct body shop, collects approval decisions, and preserves an audit trail. The current live foundation is the BSM content approval library. The larger document review workspace is planned on the same foundation and should be described as the next step until QA and launch approval are complete.

## What To Say First

"This feature gives PSG a controlled way to send shop-specific marketing content for review before it goes live. A super admin can create a review item, attach a file or generated page, assign it to the right shop, and track customer decisions. The business value is fewer email-thread approvals, clearer accountability, and less risk that the wrong customer sees or approves the wrong content."

## Pre-Walkthrough Checklist

- Confirm the account has PSG operations access with the `manage_bsm_content_approvals` permission.
- Pick one demo shop and keep the whole walkthrough inside that shop.
- Use demo-safe content only. Do not upload customer private files, live credentials, or real production records.
- Use the demo-safe sample files in `artifacts/PSG-2550/sample-files/`. They cover every currently supported upload type.
- Prepare one short customer-facing context note, for example: "Please review this July offer before PSG schedules it for publication."
- If showing planned v2 behavior, say clearly that it is the review workspace roadmap and not a live customer promise until Tess QA and Nick approval are complete.

## Sample Files For Nick's Human Test

Use these files to validate that each supported document type can be uploaded, viewed or downloaded correctly, commented on, and reviewed. Each file is intentionally demo-only and contains no real customer data.

| File | What it validates | Expected viewer behavior |
| --- | --- | --- |
| `artifacts/PSG-2550/sample-files/bsm-review-sample-proof.pdf` | PDF upload and review | Opens inline in the browser review view. |
| `artifacts/PSG-2550/sample-files/bsm-review-sample-before-after.png` | PNG image upload and review | Opens inline as an image. |
| `artifacts/PSG-2550/sample-files/bsm-review-sample-before-after.jpg` | JPG image upload and review | Opens inline as an image. |
| `artifacts/PSG-2550/sample-files/bsm-review-sample-before-after.webp` | WebP image upload and review | Opens inline as an image. |
| `artifacts/PSG-2550/sample-files/bsm-review-sample-copy.md` | Markdown upload and review | Opens inline in the browser review view. |
| `artifacts/PSG-2550/sample-files/bsm-review-sample-copy.txt` | Plain text upload and review | Opens inline in the browser review view. |
| `artifacts/PSG-2550/sample-files/bsm-review-sample-landing.html` | HTML upload and review routing | Downloads as an attachment for safety. Upload and decision tracking should still work. |
| `artifacts/PSG-2550/sample-files/bsm-review-sample-mailer.docx` | Word document upload and review routing | Downloads as an attachment for safety. Upload and decision tracking should still work. |

Validation pattern for each file:

1. Upload the file as a super admin.
2. Confirm the new item appears in the content review library for the demo shop.
3. Open the file from the customer review view.
4. Confirm the expected inline or download behavior from the table.
5. Add one reviewer comment.
6. Submit one decision: approve, decline, or request updates.
7. Replace the file once from the admin edit flow to confirm version handling.
8. Archive the demo review item when the test is complete.

## Current Super Admin Flow

### 1. Open The Content Approval Area

Explain that this area is for PSG staff, not general shop users. Access is gated before the system loads review records or allows uploads.

What to show:

- Shop selector.
- Optional customer profile field.
- Review Workspace selector when a workspace exists for the shop.
- Review title and customer context note.
- File versus generated-page source switch.
- Existing review library list.

Plain-language point:

"The first control is shop selection because every review must belong to one shop. That is what prevents one customer from seeing another customer's marketing content."

### 2. Create A Review Item

Choose the demo shop, enter a clear title, and add a customer context note. Then choose either:

- **File:** upload a PDF, Markdown file, HTML file, image, Word document, or text file under 25 MB.
- **Generated page:** enter the generated page path and, optionally, a web preview link and source content ID.

What to say:

"This creates a review record before any customer decision happens. PSG can use it for uploaded marketing files or for a generated page that needs customer approval."

Expected result:

- The item appears at the top of the review library.
- If the item is attached to a Review Workspace, the system states it is attached to that workspace.
- If it is not attached, the system states it is in the customer review library.

### 3. Edit Before Customer Submission

Open the new item for editing. Update the title or context note, or replace the file if needed.

What to say:

"Before the customer submits a decision, PSG can correct the item and save the usable version. The system keeps version history rather than treating files as informal email attachments."

Expected result:

- The edited title and note save successfully.
- If a replacement file is uploaded, the new version becomes the usable version.

### 4. Attach To A Review Workspace

If a Review Workspace exists for the selected shop, choose it and attach the review item.

What to say:

"The Review Workspace is the project-style experience we are building toward. The current content approval item can be linked to that workspace, so we are extending the existing system instead of creating a separate review product."

Expected result:

- The item shows the selected workspace relationship.
- The system rejects attaching an item to a workspace for a different shop.

### 5. Explain Customer Reviewer Access

Explain the customer side without over-promising planned v2 details.

Current rules:

- A customer must belong to the shop connected to the review item.
- A customer must be an assigned reviewer for that item unless the item is intentionally available to all eligible shop users.
- Only shop owners and shop managers can approve, decline, request updates, or ask PSG to restore an older version.
- PSG-only notes stay hidden from customer users.

What to say:

"The customer reviewer does not get broad access to PSG's system. They only see review records for their shop and only the items they are allowed to review."

### 6. Explain Decisions And Follow-Up

Walk through the decision outcomes at a business level:

- Approved content can move forward.
- Changes requested tells PSG the customer needs updates before release.
- Restore requests let a customer ask PSG to bring back an older version, but a PSG admin must approve and apply that restore.

What to say:

"The decision is not just a message in a thread. It becomes a tracked business record with who acted, what version they reviewed, and when they acted."

### 7. Archive A Review Item

Use archive only for a demo item or no-longer-active item.

What to say:

"Archiving removes the item from the active library without making it look like it was never part of the process. That matters for auditability."

Expected result:

- The item leaves the active library.
- The archive action is recorded as an admin action.

## Planned Review Workspace Walkthrough

Use this section only when explaining the next version. Introduce it as planned behavior that extends the current system.

Recommended script:

"The next version turns content approvals into a project workspace. PSG creates one private project for one shop, adds documents, invites reviewers, collects decisions and pinned comments, then generates a summary. It is designed for website pages, campaigns, flyers, and larger marketing packages that need structured review."

Planned workspace flow:

1. PSG creates a private review project for one shop.
2. PSG adds sections and uploads documents.
3. The system processes each file into a safe review copy.
4. PSG starts a review round and invites reviewers.
5. Reviewers verify access with an emailed one-time code.
6. Reviewers see the project checklist and review required documents.
7. Reviewers approve as-is or request changes.
8. Changes requested require specific comments or pins.
9. PSG triages comments as open, accepted, declined, or needs clarification.
10. Replacement uploads create new versions and, when needed, a new review round.
11. The round closes after reviewers submit or PSG closes it early with a reason.
12. PSG generates a summary PDF for the project and round.

Planned limits to state clearly:

- Phones are for reading, decisions, summaries, and clarification replies. Desktop or tablet is the expected place for pin-based commenting unless UX testing proves phone pins are reliable.
- Reviewers should never see other reviewers' private comments.
- Review links, one-time codes, and reviewer sessions must expire, be revocable, and avoid storing raw secrets.
- Public launch requires Tess QA and Nick approval before customers use it.

## Common Questions

**Can a shop see another shop's review content?**  
No. Review records are shop-scoped, and customer access requires shop membership plus reviewer eligibility.

**Can PSG send a generated landing page for approval?**  
Yes. The current flow supports a generated-page review item with a path and optional preview link.

**Can PSG replace a file after upload?**  
Yes, before customer submission the admin can save an edited item and upload a replacement file as the usable version.

**Can customers restore an older version themselves?**  
No. Customers can request a restore, but PSG must approve and apply it.

**Is the v2 project workspace ready to promise publicly?**  
No. It is the planned direction, but large-file processing, document conversion, malware scanning, safe HTML handling, summary generation, QA, and public approval gates must be completed before launch.

## Demo Data Safety Rules

- Do not upload real customer lists, claims, invoices, credentials, or private documents.
- Do not use live customer emails for a demo invitation unless the walkthrough has explicit approval.
- Do not show raw storage paths, tokens, internal error details, or private customer records.
- Keep the walkthrough inside one demo shop from start to finish.

## Acceptance Check For This Walkthrough

- A super admin can explain the business purpose in plain English.
- A super admin can show how to create, edit, attach, and archive a content review item.
- A super admin can explain who can see the item and why shop isolation matters.
- A super admin can explain decision outcomes and restore-request handling.
- A super admin can distinguish current content approval functionality from planned v2 Review Workspace functionality.
- A super admin can state the launch guardrails: Tess QA and Nick approval before customer-facing release.

## Sources Checked

- `Reference.md`
- `docs/runbooks/graphify-codebase-graph.md`
- Graphify query: `where are content reviewer features, review queue, content approval, or super admin docs/routes in psg-hub`
- Graphify query: `what file types does the BSM content reviewer/content approvals upload and preview flow support? include relevant files`
- `docs/specs/004-bsm-content-approvals-architecture.md`
- `docs/specs/005-bsm-content-approver-v2-plan.md`
- `apps/psg-hub/src/components/ops/bsm-content-approval-manager.tsx`
- `apps/psg-hub/src/lib/bsm/content-approvals-shared.ts`
- `apps/psg-hub/src/app/api/ops/bsm/content-approvals/route.ts`
- `apps/psg-hub/src/app/api/bsm/content-approvals/[id]/file/route.ts`
- `apps/psg-hub/src/lib/bsm/content-approvals.ts`

## Notes For PSG-2550

This is an internal walkthrough artifact. It does not publish a customer-facing page, start a production launch, or bypass the required QA/review gates for the planned Review Workspace.
