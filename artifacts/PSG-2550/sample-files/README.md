# PSG-2550 Content Approvals Sample Files

These files are demo-safe test inputs for the PSG super-admin Content Approvals walkthrough. They contain no customer data, credentials, or production records.

Use them from the super-admin screen:

https://home.psgweb.me/ops/bsm-content-approvals

## Files To Upload

| File | Type tested | Expected behavior |
| --- | --- | --- |
| `bsm-review-sample-proof.pdf` | PDF | Uploads as a workspace document and opens from the proof link. |
| `bsm-review-sample-mailer.docx` | Word document, DOCX | Uploads as a workspace document and opens from the proof link or browser attachment behavior. |
| `bsm-review-sample-landing.html` | HTML | Uploads as a workspace document and opens through the review proof path. |
| `bsm-review-sample-copy.md` | Markdown | Uploads as a document-type review file. |
| `bsm-review-sample-copy.txt` | Plain text | Uploads as a document-type review file. |
| `bsm-review-sample-before-after.png` | PNG image | Uploads and previews as an image. |
| `bsm-review-sample-before-after.jpg` | JPG image | Uploads and previews as an image. |
| `bsm-review-sample-before-after.webp` | WebP image | Uploads and previews as an image. |

## Important Gap

The lower-level review-workspace processing contract includes DOC files and HTML ZIP packages, but the current super-admin upload control does not expose DOC or ZIP upload on the Content Approvals screen. Do not mark DOC or HTML ZIP as passed from this sample pack.

## Human Test Pattern

1. Create or select one Review Workspace for one demo shop.
2. Add one safe reviewer.
3. Upload one sample file at a time as a super admin.
4. Confirm the created item appears in the **Workspace documents** table.
5. Use **Preview read-only** to confirm the workspace preview loads.
6. Use **Start review** to create the reviewer link and one-time code.
7. Open the reviewer link, enter the one-time code, and inspect the proof.
8. Add one private comment.
9. Submit one **Request changes** decision.
10. Reopen the response and submit one **Approve** decision.
11. Return to Content Approvals and confirm the latest decision and comment count are visible.
12. Remove demo items from the active list after testing.
