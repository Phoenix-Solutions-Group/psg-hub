# PSG-2550 Content Reviewer Sample Files

These files are demo-safe test inputs for the super admin content reviewer walkthrough. They contain no customer data, credentials, or production records.

## Files To Upload

| File | Type | Expected behavior |
| --- | --- | --- |
| `bsm-review-sample-proof.pdf` | PDF | Opens inline in the browser review view. |
| `bsm-review-sample-before-after.png` | PNG image | Opens inline as an image. |
| `bsm-review-sample-before-after.jpg` | JPG image | Opens inline as an image. |
| `bsm-review-sample-before-after.webp` | WebP image | Opens inline as an image. |
| `bsm-review-sample-copy.md` | Markdown | Opens inline in the browser review view. |
| `bsm-review-sample-copy.txt` | Plain text | Opens inline in the browser review view. |
| `bsm-review-sample-landing.html` | HTML | Downloads as an attachment for safety; still validates upload and review routing. |
| `bsm-review-sample-mailer.docx` | Word document | Downloads as an attachment for safety; still validates upload and review routing. |

## Human Test Pattern

1. Upload one file at a time as a super admin.
2. Confirm the created item appears in the content review library.
3. Open the customer review file link.
4. Confirm the expected inline or attachment behavior from the table above.
5. Add a reviewer comment and submit a decision.
6. Replace the file once to confirm edit/version behavior.
7. Archive the demo item after the test.
