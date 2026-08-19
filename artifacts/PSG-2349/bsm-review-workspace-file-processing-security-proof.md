# BSM Review Workspace File Processing And Security Proof

Issue: PSG-2349
Date: 2026-07-28
Owner: Ravi

## Bottom Line

PSG Hub has a solid starting point for private, shop-scoped review records, but it is not ready to promise the new Body Shop Marketer document review workspace file-processing scope to customers.

The current app can safely reuse the existing `bsm_content_review_*` tables, private Supabase Storage pattern, service-role upload minting, audit-event model, and external PDF-render worker pattern. The risky processing pieces are not implemented yet: 100 MB review uploads, DOC conversion, malware scanning, safe HTML ZIP extraction, and sanitized HTML preview isolation.

Recommendation: do not raise the customer promise yet. Build a quarantined processing pipeline outside the Next.js request path, using private storage, per-shop paths, a processing-jobs table, explicit authorization checks, and an isolated worker image that includes conversion, scanning, ZIP inspection, and HTML sanitization tools.

## Sources Checked

- `Reference.md`
- `PLANNING.md`
- `apps/psg-hub/.paul/STATE.md`
- `apps/psg-hub/.paul/codebase/INTEGRATIONS.md`
- Approved plan: `/PSG/issues/PSG-2341#document-plan`
- `docs/specs/004-bsm-content-approvals-architecture.md`
- `docs/specs/005-bsm-content-approver-v2-plan.md`
- Graphify query: `BSM review workspace uploads private storage background PDF malware sanitization`
- `apps/psg-hub/src/lib/bsm/content-approvals.ts`
- `apps/psg-hub/src/lib/bsm/content-approvals-shared.ts`
- `apps/psg-hub/src/lib/bsm/customer-content-review.ts`
- `apps/psg-hub/supabase/migrations/20260717021500_bsm_content_approval_review_items.sql`
- `apps/psg-hub/src/lib/report/storage.ts`
- `apps/psg-hub/src/lib/ops/intake/signed-upload.ts`
- `apps/psg-hub/workers/report-renderer/README.md`
- Supabase Storage pricing docs, checked 2026-07-28: `https://supabase.com/docs/guides/storage/pricing`

## Existing Patterns To Reuse

| Area | Current pattern | Reuse decision |
| --- | --- | --- |
| Review records | `bsm_content_review_items`, versions, reviewers, comments, decisions, restore requests, and events. | Reuse and extend. Add projects, sections, rounds, invitations, processing jobs, sessions, threads, and tombstones rather than creating a separate subsystem. |
| Tenant isolation | Tables carry `shop_id`; row-level security limits customer reads by `user_shop_ids()` and reviewer assignment. | Reuse, but v2 must also isolate invite-only reviewers who do not have PSG Hub accounts. |
| Private files | Bucket `bsm-content-approvals` is private. Storage object read policy requires the first path segment to match an allowed shop. | Reuse the private-bucket model, but use a new v2 path shape: `{shopId}/{projectId}/{documentId}/{versionId}/{artifactKind}/{fileName}`. |
| Upload minting | Existing content approvals and pilot intake use service-role signed upload URLs. | Reuse for direct-to-storage uploads. Do not stream 100 MB files through the Next.js route. |
| Audit on writes | Review comments, decisions, and item creation write `bsm_content_review_events`. | Reuse and extend for upload, scan, conversion, retry, deletion, invite, and round events. |
| PDF generation | Monthly reports use an external Chromium worker because Chromium was not reliable in Vercel Fluid Compute. | Reuse the external-worker approach for summary PDFs; do not add Chromium to the main app runtime. |
| Background execution | Ads mutations use a Vercel Sandbox bridge with durable job records and log mirroring, but it is board-gated and domain-specific. | Use the same architectural shape for document processing, but create a separate document-worker contract and gate. |

## Proof Results

| Proof area | Result | Measured or observed result | Recommendation | Risk if not solved |
| --- | --- | --- | --- | --- |
| 100 MB uploads | Partial pass | Node streamed a 100 MB local file in 151 ms with heap staying near 5 MB and resident memory rising from about 43 MB to 79 MB. Reading the same file into memory raised resident memory to about 146 MB. Current app limit is still 25 MB in code and the Supabase bucket migration. | Use browser direct-to-Supabase signed upload for originals, keep the app route as metadata-plus-token only, and raise only a quarantined v2 bucket/path to 100 MB after integration testing. | If the app buffers uploads, a few concurrent 100 MB files can exhaust memory or time out. If the bucket limit stays 25 MB, the promised upload size fails. |
| PDF preview | Partial pass | Existing monthly-report PDF storage and external PDF worker patterns are proven in the codebase. No v2 document preview route exists yet for uploaded PDFs. | Store original PDFs privately, create an authorized preview route, support HTTP range/streaming where possible, and keep no download button in reviewer UI. | Large PDFs may load slowly, fail on mobile, or expose private files if served by broad signed URLs. |
| DOC/DOCX-to-PDF conversion | Fail | No `libreoffice`, `soffice`, or conversion dependency is installed in the app runtime. Current accepted Word support is only DOCX upload metadata; no conversion pipeline exists. | Put LibreOffice or another converter in an isolated worker image with network disabled during conversion. Support both `.doc` and `.docx`, store output PDF as a review copy, and keep the original quarantined. | PSG could accept files reviewers cannot preview, or conversion could run unsafely inside the web app. Legacy `.doc` is especially risky because parsing old formats has a larger attack surface. |
| Malware scanning | Fail | No `clamscan` or malware-scanning integration is available in the app runtime. No scan-status field or processing gate exists in the current review upload flow. | Add a scanner in the document worker, reject EICAR and other unsafe fixtures before any reviewer access, and record scan engine/version/result in processing jobs and audit events. | A malicious file could be stored and then exposed to reviewers or staff before detection. |
| HTML sanitization | Fail | Current code allows HTML upload by MIME/extension, but there is no sanitizer dependency such as DOMPurify and no isolated sanitized-preview artifact. | Sanitize server-side in the worker, remove scripts/forms/event handlers/unsafe URLs/external network calls, produce a static artifact manifest, and render in a sandboxed iframe with a restrictive Content Security Policy. | Uploaded HTML can execute script, phone home to third parties, phish reviewers, or navigate them away from the review. |
| HTML ZIP safety | Fail | No ZIP parsing or inspection dependency/utility is present in the app runtime. No manifest, expansion-ratio check, path traversal check, symlink check, file-count cap, or executable-file rejection exists. | Process ZIPs only in the worker. Reject `../` paths, absolute paths, symlinks, executables, nested archives unless explicitly allowed, too many files, excessive total expanded size, and ambiguous entry files. | ZIP slip, zip bombs, executable payloads, and ambiguous bundles can compromise storage integrity or worker stability. |
| Background processing limits | Partial pass | The app has cron and approval-queue patterns, an ads Sandbox bridge, and an external report worker, but no document-processing queue/table exists yet. Vercel Sandbox timeout helpers clamp up to 45 minutes for ads jobs. | Add `bsm_content_review_processing_jobs` with idempotency keys, per-file status, retry limits, worker logs, hard file-count limits, and a project-level readiness gate before invitations can be sent. | A 50-document project can overload request routes, leave users with unclear failures, or send reviewers to incomplete/unsafe files. |
| Deletion and recovery | Partial pass | The plan requires 30-day recoverability and purge tombstones. Current v1 review records have archive/restore concepts, but no project tombstones or storage purge workflow for v2. | Add soft delete, access disablement during recovery, scheduled purge, storage-object cleanup, and minimal tombstone/audit retention. | Deleted projects may remain accessible, or purge may erase audit evidence PSG needs. |
| Storage cost | Pass for rough estimate | Supabase Storage pricing checked 2026-07-28: Pro/Team include 100 GB file storage; overage is $0.0213 per GB-month. A worst-case 50-document project at 100 MB originals is about 5 GB. If PSG stores original plus PDF/review copy at roughly 2x, budget about 10 GB per project. Overage cost is about $0.21/month per full-size project after the included quota, before egress. | Track original bytes, processed bytes, and summary bytes per project. Show cost estimates in admin tooling if usage grows. | Storage itself is cheap; repeated previews and downloads can create egress cost and performance risk. |
| PDF summary | Partial pass | Existing monthly report renderer can generate private PDFs through a controlled worker. No v2 summary template exists yet for completed and closed-early review rounds. | Reuse the report-worker style: render a private summary route into PDF, store in private storage, include reviewer attribution, non-responder labels, decisions, and triaged comments. | Closed-early rounds could be misread as complete approval, and PSG may lack a durable customer-facing summary record. |

## Security Findings

- Current v1 storage path is constrained to `{shopId}/{reviewItemId}/{versionId}/{fileName}` by database check and private storage policy. That is good and should be kept.
- Current customer read access repeats the database access check in application code before service-role reads. That is the right pattern for v2, especially because v2 invites will not always map to PSG Hub users.
- Current storage bucket allows authenticated users to read objects if the first storage path segment is one of their shops. For v2 reviewer links, use exact project/invitation/session checks in a route rather than broad signed object URLs.
- Existing uploads create the review item before the file is uploaded and scanned. For v2, the visible review state must remain `quarantined` or `processing` until upload, scan, conversion, and artifact manifest all pass.
- The v1 bucket and app code currently permit images, Markdown, and text in addition to PDF, DOCX, and HTML. The approved v2 plan should narrow the public promise to PDF, DOC, DOCX, HTML, and HTML ZIP unless product explicitly keeps the extra types.

## Recommended Implementation Shape

1. Add v2 processing schema first: projects, documents/sections/round links, processing jobs, artifacts, invitations/sessions, tombstones, and audit events.
2. Create a private v2 storage convention with separate `original`, `quarantine`, `review-copy`, `sanitized-html`, and `summary` artifact kinds.
3. Keep upload direct-to-storage through signed upload URLs; never stream 100 MB through a normal app route.
4. Build a document worker image with LibreOffice, ClamAV or equivalent scanner, ZIP inspection, HTML sanitizer, PDF metadata extraction, and strict network-off processing.
5. Require a processing manifest before any reviewer route can load a file.
6. Generate summary PDFs through the existing external-worker pattern or a sibling controlled worker, not through the main app runtime.
7. Add tests for tenant isolation, reviewer isolation, unsafe file rejection, ZIP path rejection, sanitization, idempotent retries, and delete/purge behavior.

## Verification Performed

- Used Graphify before broad repo reading.
- Read the approved plan and required engineering references.
- Inspected current BSM review services, private storage helpers, migration policies, and worker patterns.
- Checked local runtime availability for conversion, scanning, ZIP, and PDF tooling.
- Measured 100 MB local streaming and buffering behavior in Node 24.18 on Linux x64.
- Checked current Supabase Storage pricing from official docs on 2026-07-28.

## Final Disposition

Proof complete. The safe path is to proceed to design/build tasks for a quarantined worker-backed processing pipeline. The current app foundation passes as a reuse base, but the customer-facing file-processing promise fails until the missing worker and security gates are built and tested.
