# PSG-2344 Content Approver v2 Proof Spike Results

Generated: 2026-07-28T17:17:12.946Z

## Bottom Line

Recommendation: **revise the plan before full build**. Large-file streaming, safe HTML/ZIP rejection rules, scaled batch processing, storage-cost math, and the summary attribution data shape are technically workable. Two launch-critical requirements are not proven in the current PSG Hub runtime: Word document conversion and malware scanning. Do not promise Content Approver v2 until those are added as managed services or explicitly removed from scope.

## Results

| Proof | Result | Evidence |
| --- | --- | --- |
| 100 MB PDF | pass | Created, streamed to a review copy, preview-checked, and deleted 100 MB. Copy time: 205 ms. RSS after run: 115.5 MiB. |
| DOC/DOCX conversion | blocked | No LibreOffice/soffice binary is available, so legacy .doc and .docx conversion cannot be proven in this runtime. |
| Malware scanning | blocked | No ClamAV scanner is available, so the infected EICAR fixture cannot be rejected before reviewer access in this runtime. |
| HTML safety | pass | Script tags, event handlers, forms, unsafe URLs, and external calls were rejected by the proof validator. |
| HTML ZIP safety | pass | Path traversal, absolute paths, symlinks, executable entries, and excessive expansion were rejected by the proof validator. |
| 50-document processing | pass | Processed 50 scaled 2 MB PDF documents in 656 ms (152.4 MB/s). Projected 50 x 100 MB copy/hash window: 33 seconds before conversion/scanning/rendering overhead. |
| Storage cost | pass | 50 originals plus 50 processed review copies at 100 MB each is 9.77 GiB. Estimated base storage: $0.21/month before transfer, backups, and database costs. |
| Summary PDF | pass | Generated a PDF-shaped summary artifact containing reviewer attribution and a clear non-responder line for early close. This proves the summary data contract and attribution wording, not browser-rendered PDF fidelity. |

## Engineering Recommendation

Proceed with a reduced next slice only:

1. Keep PDFs and sanitized HTML/HTML ZIP in scope for the next implementation slice.
2. Add a real malware-scanning service before any reviewer can access uploaded files. Best fit: ClamAV/`clamd` in a managed worker or another private scanning service with a hard fail-closed policy.
3. Add a real document-conversion worker before promising `.doc` or `.docx`. Best fit: a containerized LibreOffice worker that writes immutable PDF review copies and reports per-file conversion errors.
4. Treat 100 MB x 50 documents as an asynchronous background job path. The measured local copy/hash throughput is acceptable, but conversion and scanning will dominate the true processing window.
5. Keep invitations locked until every required document has passed scanning and processing.

## Technical Detail

The proof script is `artifacts/PSG-2344/content-approver-v2-proof-spikes.mjs`.
Raw results are in `artifacts/PSG-2344/content-approver-v2-proof-results.json`.

SOPs checked: board communication standard, Graphify code-navigation rule, PSG knowledge-base rule. The knowledge-base environment variables were not available in this runtime, so this spike used Paperclip, repository docs, Graphify, and local measurements only.
