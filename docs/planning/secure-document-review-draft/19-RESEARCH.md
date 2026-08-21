# Phase 19: Secure Document Review - Research

**Researched:** 2026-07-28
**Domain:** Secure document ingestion, inert normalization, recipient-scoped review, anchored comments, and immutable submission
**Confidence:** HIGH for the repo architecture and authorization model; MEDIUM for the proposed conversion image until it is exercised with the phase fixture corpus. [VERIFIED: repository inspection + Next.js 16 installed guides + Supabase official docs] [ASSUMED]

<user_constraints>
## User Constraints (from CONTEXT.md)

The following constraints are copied verbatim from `19-CONTEXT.md`; every item in this block is phase-authoritative. [VERIFIED: .paul/phases/19-secure-document-review/19-CONTEXT.md]

### Locked Decisions

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

### Codex's Discretion

- Exact file-size and guest-link expiry defaults.
- Exact route names and component boundaries.
- Conversion runtime, provided it reuses PSG Hub or its existing hosting platform where practical and satisfies D-04, D-17, and D-18.
- Pin coordinate representation and responsive scaling method.
- Whether email reminders are included if they add no new infrastructure.

### Deferred Ideas (OUT OF SCOPE)

- Inline editing of HTML, Word, or PDF contents.
- Real-time cursor presence or simultaneous collaborative editing.
- Freehand drawing, rectangles, arrows, stamps, and signature workflows.
- Automatic anchor migration or visual diffing between document versions.
- Public anonymous links that are not recipient-specific and expiring.
- Multi-document review packages.
</user_constraints>

<phase_requirements>
## Phase Requirements

The requirement descriptions below are copied from the phase context; the support column is the prescriptive planning consequence. [VERIFIED: .paul/phases/19-secure-document-review/19-CONTEXT.md]

| ID | Description | Research Support |
|----|-------------|------------------|
| SDR-01 | Authorized PSG staff can create a review and upload HTML, DOCX, or PDF. | Add a module capability check and a 4 MiB direct multipart ingestion route; validate all bytes before persistence. [VERIFIED: existing security-profile schema + Vercel Functions limits] |
| SDR-02 | The system validates and stores the original in private Supabase Storage, then creates an inert normalized review artifact in private Supabase Storage. | Normalize to a manifest plus page PNGs and extracted page text inside a deny-all-network sandbox, then persist original and artifact under generated immutable keys. [CITED: https://vercel.com/docs/sandbox] [ASSUMED] |
| SDR-03 | Staff can assign authenticated reviewers and invite guest reviewers with expiring, revocable links. | Model recipients explicitly; use Supabase profile IDs for authenticated recipients and SHA-256 token digests plus expiry/revocation for guests. [VERIFIED: existing Supabase auth pattern + Node.js crypto API] |
| SDR-04 | A reviewer can open only assigned reviews and cannot enumerate other reviews or storage objects. | Put every metadata and object read behind one server-only authorization helper; do not grant guest or reviewer direct `storage.objects` access. [VERIFIED: existing report download route + Supabase Storage access-control docs] |
| SDR-05 | A reviewer can place, edit, and delete page pins with comments before submission. | Store page plus normalized coordinates; enforce the editable state in a database trigger/RPC, not only in the UI. [ASSUMED] |
| SDR-06 | Pin placement remains aligned when the document is zoomed or resized. | Persist `x_ratio` and `y_ratio` in `[0,1]` against the normalized page and render pins with percentage positioning. [ASSUMED] |
| SDR-07 | Submission locks a stable comment snapshot and notifies the administrator. | Use one transaction/RPC to lock the recipient, copy ordered comments to immutable JSON, change state, append audit, and enqueue a notification ledger record. [ASSUMED] |
| SDR-08 | Staff can inspect submitted comments in page order and jump from a comment to its pin. | Query snapshot comments by page/Y/X/creation order and implement bidirectional focus/scroll between list rows and pin buttons. [ASSUMED] |
| SDR-09 | Staff can reopen a review or create a new document version without changing historical submissions. | Preserve prior snapshots; reopen creates another editable cycle, while a revised file creates a new immutable version and new recipients. [ASSUMED] |
| SDR-10 | Security tests cover token hashing, expiry, revocation, authorization boundaries, malicious file rejection, and active-HTML isolation. | Build a malicious-file fixture corpus and test both the server gate and converter contract before UI polish. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html] |
| SDR-11 | Accessibility tests cover keyboard pin selection, visible focus, readable comment relationships, and non-pointer navigation. | Add keyboard placement mode, native pin buttons, explicit relationships, axe checks, and Playwright keyboard-only flows. [CITED: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html] |
| SDR-12 | Supabase project `gylkkzmcmbdftxieyabw` owns Auth, Postgres module state, and private Storage objects; local verification proves the schema and RLS before any production gate. | Author migrations locally, run reset/RLS fixtures locally, and keep production entirely read-only during Phase 19 planning and implementation until a later operator gate. [VERIFIED: 19-CONTEXT.md + Phase 6 migration-safety protocol] |
</phase_requirements>

## Summary

Phase 19 should be planned as a narrow, server-mediated workflow, not as a general document editor. The smallest safe artifact is a versioned bundle containing a manifest, one inert PNG per page, and page text for accessibility/search support; the original file is retained only for gated administrator download. This representation keeps every uploaded format out of the reviewer browser, makes pin geometry deterministic, and avoids adding a browser PDF/Office/HTML runtime. [VERIFIED: D-04/D-09/D-14 in 19-CONTEXT.md] [ASSUMED]

The upload ladder should start at a **4 MiB file ceiling, 100 rendered pages, and 7-day guest-link expiry**. A 4 MiB ceiling keeps ingestion under Vercel's 4.5 MB request-body limit with conservative multipart overhead, so the route can inspect the actual bytes before any persistent write. Raising the ceiling later requires a deliberately designed private quarantine/TUS path because Supabase recommends resumable uploads above 6 MB, and that path must be reconciled with D-17's “validate before storage” rule. [CITED: https://vercel.com/docs/functions/limitations] [CITED: https://supabase.com/docs/guides/storage/uploads/resumable-uploads] [ASSUMED]

Conversion should use `@vercel/sandbox` with a custom OCI image pinned by digest and `networkPolicy: "deny-all"`. The image should contain Chromium, LibreOffice, Poppler, and `file`; it performs deep format validation, converts HTML/DOCX to PDF, rasterizes every PDF page, extracts text, returns the artifact, and is destroyed. This is materially safer than the existing long-lived report renderer, whose local code launches Chromium with `--no-sandbox` and permits selected network navigation; reuse its adapter/testing seam, not its trust boundary. [VERIFIED: workers/report-renderer source inspection] [CITED: https://vercel.com/docs/sandbox] [CITED: https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox] [ASSUMED]

**Primary recommendation:** Plan a page-image review system with a 4 MiB/100-page v1 ladder, one server-only dual-auth gate, immutable version/submission records, and deny-all-network Vercel Sandbox normalization before any Supabase Storage write. [VERIFIED: phase constraints + official platform limits] [ASSUMED]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Upload envelope, size and extension checks | Frontend Server (Route Handler) | Sandbox | The server rejects over-limit requests immediately; the sandbox validates actual format structure before conversion. [VERIFIED: Next.js Route Handler docs] [ASSUMED] |
| Untrusted format validation and normalization | Isolated Sandbox | Frontend Server | Parser/converter execution must be outside PSG Hub and unable to make network requests. [VERIFIED: D-17/D-18] |
| Reviewer and administrator authorization | Frontend Server / DAL | Database / RLS | A single authorization function handles Supabase sessions and guest cookies; RLS and state triggers are backstops. [VERIFIED: Next.js data-security guide + existing app access pattern] |
| Review/version/comment/submission state | Database / Storage | Frontend Server | Postgres owns transactional state and audit; private Storage owns immutable bytes. [VERIFIED: D-20] |
| Page display and pin interaction | Browser / Client | Frontend Server | The browser receives only inert page images/text and places accessible controls using normalized coordinates. [VERIFIED: D-04/D-09] [ASSUMED] |
| Original/artifact delivery | Frontend Server | Private Storage | Server authorization precedes service-role download; no public or long-lived signed URL is exposed. [VERIFIED: existing report download route + D-05] |
| Invitation/submission notifications | Frontend Server | Database | Transactions create a durable notification record; the existing SendGrid adapter performs the external send afterward. [VERIFIED: src/lib/mail/sendgrid.ts] [ASSUMED] |

## Project Constraints (from AGENTS.md)

- Work from the exact nested app root, `/Users/schoolcraft_mbpro/dev/psg/internal/psg-hub/apps/psg-hub`, and inspect monorepo layout before diagnosing missing paths. [VERIFIED: user-provided AGENTS.md instructions + `pwd`]
- Treat installed Next.js 16 as version-specific; read `node_modules/next/dist/docs/` and heed deprecations before implementing routes, runtime choices, auth, or Server/Client Component boundaries. [VERIFIED: AGENTS.md]
- Read project docs/specs/roadmap/plan artifacts and map every requirement to code/tests before making completion claims. [VERIFIED: user-provided AGENTS.md instructions]
- Prefer CLI automation when access exists, but pause for production promotions, destructive deletion, required secrets, or machine-external blast radius. [VERIFIED: user-provided AGENTS.md instructions]
- Phase 19 planning and migration work is local-only; project `gylkkzmcmbdftxieyabw` is read-only context until a separate operator gate. [VERIFIED: D-22 + Phase 6 migration-safety protocol]
- New shared-schema tables require RLS in the same migration; authorization helpers belong in `private`, use `SECURITY DEFINER SET search_path = ''`, and must not modify sibling-module policies/tables. [VERIFIED: .paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md + CHECKLIST-rls-review.md]
- Staff policy checks must reuse `private.current_user_has_fn('<capability>')`; do not introduce a project-global custom JWT hook for this module. [VERIFIED: existing migrations + Phase 6 protocol]

## Standard Stack

### Core

| Library / service | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| Next.js | 16.2.3 installed | App Router pages, Route Handlers, server-only DAL, private file proxy | It is the app's current framework; installed docs specify Web `Request`/`Response`, `request.formData()`, async route params, and Node runtime configuration. [VERIFIED: pnpm list + installed Next.js 16 docs] |
| React | 19.2.4 installed | Reviewer/admin components and accessible pin state | It is the existing renderer; no additional annotation framework is needed for percentage-positioned native buttons. [VERIFIED: pnpm list] [ASSUMED] |
| Supabase JS / SSR | 2.106.2 / 0.10.3 installed | Authenticated sessions, Postgres, private Storage | These are the existing app adapters and D-20's locked system of record. [VERIFIED: pnpm list + D-20] |
| PostgreSQL / RLS | Existing Supabase project; local CLI 2.107.0 | Review state, recipient scope, snapshots, audit, transition enforcement | The existing project already uses RLS and private capability helpers; this phase must extend that spine. [VERIFIED: migration inspection + `supabase --version`] |
| `@vercel/sandbox` | 2.9.0 | Firecracker-isolated conversion with deny-all egress and a custom image | Vercel documents filesystem/process isolation, network policy, and custom images for untrusted code/input. [VERIFIED: npm registry + slopcheck + Vercel Sandbox docs] |
| Node `crypto` | Node 26.4.0 locally; use supported Vercel Node runtime in deploy | Guest-token generation and SHA-256 digests | The built-in module avoids a token package and supports cryptographic random bytes/hashing. [VERIFIED: local `node --version` + Node built-in API] |

### Supporting

| Library / tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| Zod | 4.4.3 installed | Route payload and manifest validation | Validate metadata, recipient inputs, sandbox output, and mutation payloads; never treat browser MIME as authoritative. [VERIFIED: pnpm list] [ASSUMED] |
| SendGrid adapter | `@sendgrid/mail` 8.1.6 installed | Invitations and submission notices | Reuse `src/lib/mail/sendgrid.ts`, including its retry/circuit-breaker behavior. [VERIFIED: pnpm list + source inspection] |
| LibreOffice | Pin exact converter-image package version; local LibreOfficeDev 26.8 alpha only for exploration | DOCX-to-PDF | Run headless only inside the conversion image. [CITED: https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html] |
| Poppler utilities | Pin exact converter-image package version; local tools available | PDF metadata, rasterization, text extraction | Use `pdfinfo`, `pdftoppm`, and `pdftotext` after structural validation. [VERIFIED: local command availability] [ASSUMED] |
| Chromium + Puppeteer | Pin image and package versions together | HTML-to-PDF with JavaScript disabled and resource requests aborted | Use only inside the deny-all sandbox; disable JavaScript before navigation. [CITED: https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.page.setjavascriptenabled.md] |
| Vitest / Playwright / axe | 4.1.7 / 1.60.0 / 4.11.3 installed | Unit/integration, workflow, keyboard, and accessibility tests | Extend the existing local Supabase E2E and per-file coverage conventions. [VERIFIED: pnpm list + test config inspection] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Page PNG artifact | PDF.js in the reviewer browser | PDF.js would preserve selectable text and native PDF fidelity, but it adds a browser parser and does not normalize HTML/DOCX into the same simplest display surface. Defer until text selection/search is required. [CITED: https://mozilla.github.io/pdf.js/examples/] [ASSUMED] |
| Direct 4 MiB Route Handler upload | Supabase TUS upload to a quarantine prefix | TUS supports larger files, but persistent bytes arrive before deep validation and complicate D-17, cleanup, and object authorization. Use only in a later explicit large-file phase. [CITED: https://supabase.com/docs/guides/storage/uploads/resumable-uploads] |
| Vercel Sandbox | Existing Hetzner report renderer | The existing worker is trusted-report infrastructure, starts Chromium with `--no-sandbox`, and allows controlled outbound navigation; it is the wrong boundary for hostile Office/HTML/PDF parsers. [VERIFIED: workers/report-renderer source inspection] |
| Module-owned random guest token | Supabase anonymous user or JWT invitation | Module records make recipient, expiry, rotation, and revocation explicit without expanding Supabase Auth identities or relying on self-contained-token revocation semantics. [VERIFIED: D-21] [ASSUMED] |

**Installation:**

```bash
pnpm add @vercel/sandbox@2.9.0
```

The converter image dependencies must be pinned in the image definition and the deployed image referenced by immutable digest; no floating `latest` tag should be accepted by the adapter. [CITED: https://vercel.com/docs/sandbox] [ASSUMED]

## Package Legitimacy Audit

The only proposed new application package passed the required registry, official-documentation, source-repository, postinstall, and slopcheck checks on 2026-07-28. [VERIFIED: npm registry + Vercel official docs + slopcheck]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@vercel/sandbox` 2.9.0 | npm | Package created 2025-05-20; version 2.9.0 published 2026-07-24 | 3,068,590/week for 2026-07-18 through 2026-07-24 | `github.com/vercel/sandbox` | OK; no `postinstall` reported | Approved. [VERIFIED: npm registry + Vercel docs + slopcheck] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: slopcheck]

## Architecture Patterns

### System Architecture Diagram

```text
Authorized admin browser
        |
        | multipart upload (hard file ceiling)
        v
Next.js Route Handler / server-only DAL
        |
        +--> reject extension / byte length / coarse magic mismatch
        |
        v
Vercel Sandbox (new ephemeral microVM, deny-all network)
        |
        +--> deep format validation
        +--> HTML --Chromium, JS off--> PDF
        +--> DOCX --LibreOffice------> PDF
        +--> PDF --------------------> PDF
        +--> PDF --Poppler-----------> manifest + page PNGs + page text
        |
        +--> any failure: destroy sandbox, persist nothing
        |
        v
Next.js orchestration
        |
        +--> private Supabase Storage: original + immutable artifact bundle
        +--> Postgres RPC: version + audit event
        +--> compensating object cleanup if DB commit fails

Auth reviewer session --------+
                              +--> shared authorizeDocumentReview() --> gated page/object/mutation routes
Guest URL fragment -> exchange+
                      |
                      +--> HttpOnly scoped cookie; DB digest/expiry/revocation check each request

Reviewer page images + pin controls --> draft comments
                                       |
                                       v
Postgres submit RPC: lock recipient -> snapshot -> audit -> notification ledger
                                       |
                                       v
SendGrid adapter -> administrator email
```

This flow ensures no uploaded HTML, DOCX, or PDF is embedded in the reviewer browser and no persistent object is written until the format has passed validation and conversion. [VERIFIED: D-04/D-17] [ASSUMED]

### Recommended Project Structure

```text
src/
├── app/
│   ├── dashboard/document-reviews/             # authenticated admin/reviewer pages
│   ├── review/guest/                            # minimal guest shell and fragment exchange
│   └── api/document-reviews/                    # upload, objects, comments, state routes
├── components/document-review/                  # page viewer, pin, comment list/forms
└── lib/document-review/
    ├── auth.ts                                  # shared auth/guest/admin gate
    ├── tokens.ts                                # random token, digest, cookie rules
    ├── upload.ts                                # envelope checks and orchestration
    ├── converter.ts                             # injected Sandbox adapter
    ├── artifact.ts                              # manifest schema and page keys
    ├── storage.ts                               # injected private Storage adapter
    ├── comments.ts                              # ordered reads and DTOs
    ├── notifications.ts                         # durable-send adapter
    └── schemas.ts                               # Zod boundaries
supabase/
├── migrations/                                 # tables, RLS, RPCs, triggers, private bucket
└── tests/                                       # SQL authorization and state-transition tests
workers/
└── document-converter/                          # pinned custom image and fixture self-check
e2e/
└── document-review.spec.ts                      # auth + guest + keyboard workflows
```

The exact file split is discretionary, but authorization, conversion, storage, and notification adapters should remain dependency-injected so unit tests do not require live external services. [VERIFIED: existing report storage/render patterns] [ASSUMED]

### Pattern 1: Validate Before Persistent Storage

**What:** Read a deliberately small upload into memory, reject the envelope, run deep validation and conversion in an ephemeral sandbox, validate the returned manifest, and only then write original and artifact objects. [VERIFIED: D-17/D-18] [ASSUMED]

**When to use:** Every version upload; there is no “temporarily public” or shared quarantine path in the first release. [VERIFIED: D-05/D-17]

**Validation ladder:**

1. Reject missing filename, unsupported extension, file byte length over 4 MiB, and obviously inconsistent leading bytes in the Route Handler. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html] [ASSUMED]
2. Inside the sandbox, use detected MIME plus structural checks: PDF header/trailer and `pdfinfo`; DOCX ZIP integrity with `[Content_Types].xml` and `word/document.xml`; HTML UTF-8 decoding and an HTML-document marker. [ASSUMED]
3. Reject encrypted PDFs, malformed documents, DOCX archive expansion over 100 MiB, output over 100 pages, or any non-zero/timeout converter failure. [ASSUMED]
4. Validate the sandbox result with Zod, compute SHA-256 digests, and upload under generated UUID paths with `upsert: false`. [ASSUMED]
5. Insert the immutable version and audit event; if the database transaction fails, delete only the newly generated object prefix as a compensating action. [ASSUMED]

### Pattern 2: Inert Page Bundle

**What:** Normalize all formats to a versioned manifest plus page images and page text. A manifest should include schema version, source digest, page count, and each page's pixel width/height, image path, and text path. [ASSUMED]

**When to use:** All reviewer and staff display routes. The original is download-only for authorized staff. [VERIFIED: D-04/D-12]

**HTML rule:** Treat HTML as a single-file, offline document. Disable JavaScript before navigation, apply a restrictive CSP, abort subresource requests, and also enforce sandbox `deny-all` networking; external CSS/fonts/images therefore will not render and the upload UI must say they must be inlined. [CITED: https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.page.setjavascriptenabled.md] [CITED: https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox] [ASSUMED]

### Pattern 3: One Dual-Mode Authorization Gate

**What:** `authorizeDocumentReview()` returns a typed actor only after exact recipient/review/version validation. Authenticated users are verified with Supabase `getUser()` and assigned profile ID; guests are verified by hashing the scoped HttpOnly cookie and checking digest, expiry, revocation, recipient, version, and state. [VERIFIED: installed Next.js authentication/data-security guides + D-07/D-08] [ASSUMED]

**When to use:** Page loads, manifests, page images/text, comments, submission, original download, reopen, revocation, and version creation. Every object path must be derived from the authorized database row rather than accepted from the request. [VERIFIED: existing report download pattern] [ASSUMED]

**Failure behavior:** Return a uniform not-found response for absent, unassigned, expired, or revoked guest resources so opaque IDs do not become an enumeration oracle. [ASSUMED]

### Pattern 4: Fragment-to-Cookie Guest Exchange

**What:** Put the one-time raw guest token after `#` in the invitation URL. The guest shell reads the fragment, POSTs it in the request body, immediately removes it with `history.replaceState`, and receives a Secure, HttpOnly, SameSite=Strict cookie scoped to the guest-review path. [ASSUMED]

**Why:** URL fragments are not sent in the initial HTTP request, which reduces exposure in server access logs and referrers; the server stores only a SHA-256 digest and checks the recipient record on every use. [CITED: https://url.spec.whatwg.org/] [ASSUMED]

**Token default:** Generate 32 random bytes, encode base64url, store a unique SHA-256 digest, expire after 7 days, and rotate on re-invitation. Never put the token in logs, database audit payloads, localStorage, sessionStorage, query strings, or error text. [ASSUMED]

### Pattern 5: Database-Enforced Review State

**What:** Use service-only transactional RPCs and triggers for submission, reopening, version creation, invite/revoke, and audit. A submission takes a row lock, copies the reviewer's ordered current comments into an immutable JSON snapshot, increments submission number, locks edits, appends audit, and creates a notification ledger row. [ASSUMED]

**When to use:** Any action that must not partially succeed or race with another mutation. UI disablement is only feedback; database checks are the authority. [ASSUMED]

**Reopen semantics:** Keep every prior snapshot immutable. Reopening changes the recipient back to editable and the next submission produces a new numbered snapshot. New file versions create new recipient assignments and never move old comments. [VERIFIED: D-11/D-13/D-14] [ASSUMED]

### Pattern 6: Responsive, Accessible Pins

**What:** Store `page_number`, `x_ratio`, and `y_ratio`, with database checks that ratios are between zero and one. Render the page wrapper `position: relative`, the image at responsive width, and each native `<button>` at percentage `left`/`top`. [ASSUMED]

**When to use:** Pointer placement, zoom/resizing, staff comment jumps, and keyboard placement. Coordinates should be computed from the displayed page bounding rectangle, not viewport coordinates. [ASSUMED]

**Keyboard mode:** Provide an “Add comment on this page” button that activates a visible crosshair button. Arrow keys move by 1%, Shift+Arrow by 5%, Enter opens the comment form, and Escape cancels. This supplies a non-dragging alternative and visible focus path. [CITED: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html] [CITED: https://www.w3.org/WAI/ARIA/apg/patterns/button/] [ASSUMED]

### Component Responsibilities

| Component | Responsibility | Must Not Do |
|-----------|----------------|-------------|
| Upload Route Handler | Session/admin capability, multipart ceiling, coarse validation, orchestration | Persist before converter success or parse Office/PDF/HTML in-process. [VERIFIED: D-17/D-18] |
| Sandbox adapter | Create isolated instance, write input, execute pinned converter, validate/read output, stop in `finally` | Receive Supabase service keys, SendGrid keys, or arbitrary egress. [CITED: https://vercel.com/docs/sandbox] [ASSUMED] |
| Storage adapter | Generated immutable keys, private downloads, compensating cleanup | Create public URLs, accept user-provided paths, or use upsert. [VERIFIED: D-05] [ASSUMED] |
| Authorization DAL | Admin capability, assigned auth reviewer, active guest recipient | Treat knowledge of UUID as authorization or trust client role claims. [VERIFIED: Next.js data-security guide] |
| Review viewer | Display inert pages/text and accessible pins/comments | Embed original HTML/PDF/DOCX, use required drag, or execute upload content. [VERIFIED: D-04/D-19] |
| State RPCs | Snapshot, lock/reopen, audit, notification ledger | Depend on UI state for authorization or edit locking. [ASSUMED] |
| Mail adapter | Send already-authorized payload and update ledger result | Own review state or persist raw guest tokens. [VERIFIED: existing SendGrid adapter pattern] [ASSUMED] |

### Recommended Data Model

| Table | Required shape and invariants |
|-------|-------------------------------|
| `document_reviews` | Review identity, title, creator/admin profile, timestamps; mutable descriptive metadata only. [ASSUMED] |
| `document_review_versions` | Immutable `(review_id, version_number)`, original metadata/hash/path, artifact manifest path/hash, page count, creator, timestamp; block update/delete. [VERIFIED: D-13/D-14] [ASSUMED] |
| `document_review_recipients` | Version, recipient kind, exactly one authenticated profile or guest token digest/email, expiry/revocation, state, invitation metadata, submission generation. [VERIFIED: D-06/D-07/D-21] [ASSUMED] |
| `document_review_comments` | Recipient, page, normalized coordinates, body, timestamps; author is implied by recipient and editable only in draft/reopened state. [VERIFIED: D-09/D-10] [ASSUMED] |
| `document_review_submissions` | Recipient, submission number, immutable ordered `snapshot_jsonb`, submitted time; unique recipient/submission number. [VERIFIED: D-11] [ASSUMED] |
| `document_review_audit_events` | Append-only actor type/ID, review/version/recipient IDs, event type, safe metadata, timestamp. [VERIFIED: D-16] [ASSUMED] |
| `document_review_notifications` | Dedupe key, kind, recipient/admin email, pending/sent/failed state, attempt metadata, timestamps; no raw guest token after the immediate send attempt. [ASSUMED] |

Index every foreign key and every column used in an RLS predicate or primary listing order, including version/review, recipient/profile, token digest, review state, and `(page_number, y_ratio, x_ratio, created_at)`. [CITED: https://supabase.com/docs/guides/database/postgres/row-level-security] [ASSUMED]

### Anti-Patterns to Avoid

- **Rendering uploaded HTML in an iframe:** sandbox attributes are not the chosen trust boundary and browser mistakes can activate content; render only normalized page images. [VERIFIED: D-04] [ASSUMED]
- **Reusing the report renderer for untrusted input:** its source has a different trust model and `--no-sandbox`; use an ephemeral deny-all microVM. [VERIFIED: workers/report-renderer source]
- **Creating Supabase signed download URLs for reviewer content:** signed URLs stay valid until their own expiry and cannot reflect immediate module revocation; proxy every read through the authorization gate. [VERIFIED: Supabase Storage official docs]
- **Storing guest tokens or query-string tokens:** raw-token persistence/logging breaks D-07 and makes rotation/revocation harder to reason about. [VERIFIED: D-07] [ASSUMED]
- **Using only RLS for guest access:** guest identities are module-owned rather than Supabase Auth users, so guest requests need a server gate and service adapter; do not expose service credentials to the browser. [VERIFIED: D-21 + Supabase official docs]
- **Relying on UI state to lock comments:** concurrent or direct API calls can bypass it; enforce state in the transaction/trigger. [ASSUMED]
- **Storing pixel coordinates:** layout/zoom changes misalign pins; use normalized page ratios. [ASSUMED]
- **Migrating pins to a revised file:** that is explicitly out of scope and risks attaching comments to the wrong content. [VERIFIED: D-14]
- **Sending email inside a database transaction:** external latency/failure can leave unclear outcomes; commit a notification ledger item, then send and record result. [ASSUMED]
- **Broad “staff” authorization:** create an explicit `secure_document_review_admin` capability and use `private.current_user_has_fn`, so unrelated internal users cannot administer reviews. [VERIFIED: existing security-profile pattern] [ASSUMED]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Untrusted parser isolation | In-process child-process sandbox or filename-only safety checks | Vercel Sandbox with pinned image and deny-all network | Parser compromise must not inherit the PSG Hub runtime, filesystem, or secrets. [CITED: https://vercel.com/docs/sandbox] |
| DOCX rendering | Partial OOXML/CSS renderer | LibreOffice headless inside the sandbox | Office layout is a large compatibility surface and not the product's differentiation. [CITED: https://help.libreoffice.org/latest/gu/text/shared/guide/convertfilters.html] |
| PDF rasterization | Custom PDF parser/canvas | Poppler utilities inside the sandbox | Parsing malformed PDFs is security-sensitive and complex. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html] [ASSUMED] |
| Guest cryptography | Homegrown encryption or reversible tokens | Node random bytes + SHA-256 digest | The module needs opaque bearer tokens and digest comparison, not decryptable secrets. [ASSUMED] |
| Session infrastructure | A second auth provider or guest JWT framework | Supabase Auth for users plus scoped module cookie for guests | D-21 fixes both identity models. [VERIFIED: D-21] |
| Storage serving | Public buckets or client-selected object keys | Existing service-role private-download pattern after authorization | The existing report route already demonstrates membership-gated private delivery. [VERIFIED: source inspection] |
| Email transport/retry | New mail client or queue system | Existing `sendEmail` and resilience layer plus a database ledger | The adapter already exists and Phase 19 needs no new messaging infrastructure. [VERIFIED: src/lib/mail/sendgrid.ts] |
| Annotation framework | Canvas/SVG drawing suite | Native buttons over page images | The locked scope is pins plus comments, not shapes/drawing/coauthoring. [VERIFIED: D-09/D-19] |

**Key insight:** the phase's difficult problems are trust boundaries, authorization, immutable workflow state, and accessibility; adopting mature converters and the existing app adapters keeps custom code concentrated on those product-specific rules. [VERIFIED: phase requirements] [ASSUMED]

## Common Pitfalls

### Pitfall 1: Body-limit Failure Before Validation

**What goes wrong:** A nominal “5 MB” file plus multipart overhead exceeds Vercel's 4.5 MB request/response limit, so the application never reaches its own validation response. [CITED: https://vercel.com/docs/functions/limitations]
**Why it happens:** Teams set their product limit equal to or above the platform envelope. [ASSUMED]
**How to avoid:** Set the file ceiling to 4 MiB, reject conservative `Content-Length` values early, and verify actual `File.size`/buffer length. [ASSUMED]
**Warning signs:** 413 responses at the platform edge or failures that have no application log. [CITED: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions]

### Pitfall 2: Filename/MIME Theater

**What goes wrong:** A renamed executable, malformed ZIP, polyglot, encrypted PDF, or archive bomb reaches a parser. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html]
**Why it happens:** `File.type` and filename extension are user-controlled hints. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html]
**How to avoid:** Combine allowlisted extension, leading-byte checks, detected MIME, structure validation, archive expansion limits, page/output limits, timeouts, and isolation. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html] [ASSUMED]
**Warning signs:** Converter hangs, huge temporary output, or a detected type that disagrees with the requested extension. [ASSUMED]

### Pitfall 3: “Sanitized HTML” Still Fetches or Executes

**What goes wrong:** External resources leak request metadata, JavaScript runs before being disabled, or local-file references escape the document directory. [ASSUMED]
**Why it happens:** Sanitization alone does not enforce process or network isolation. [ASSUMED]
**How to avoid:** Disable JS before navigation, intercept/abort requests, add restrictive CSP, use a sandbox deny-all policy, and never serve the HTML itself. [CITED: https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.page.setrequestinterception.md] [CITED: https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox]
**Warning signs:** DNS/HTTP calls in converter telemetry or HTML fixtures whose appearance depends on an external URL. [ASSUMED]

### Pitfall 4: Revocation That Does Not Revoke Objects

**What goes wrong:** A revoked guest can continue using an unexpired Storage signed URL. [VERIFIED: Supabase Storage official docs]
**Why it happens:** Access was delegated to a time-bound object URL instead of checked on each request. [ASSUMED]
**How to avoid:** Keep buckets private, issue no reviewer signed URL, and check recipient state before every server-proxied object read. [VERIFIED: D-05/D-07 + existing report route]
**Warning signs:** Page/image URLs contain Storage signatures or load after the recipient record is revoked. [ASSUMED]

### Pitfall 5: Service-Role IDOR

**What goes wrong:** A route checks that a user is logged in, then uses service role to fetch an arbitrary request-supplied review or object path. [ASSUMED]
**Why it happens:** Service-role access bypasses RLS. [VERIFIED: Supabase official docs]
**How to avoid:** Authorize the exact review/version/recipient first and derive every object path from that row. [VERIFIED: existing report download pattern]
**Warning signs:** Route parameters flow directly into `.from()` or Storage calls before an assignment/capability check. [VERIFIED: repo security pattern]

### Pitfall 6: Snapshot Race

**What goes wrong:** A comment edit lands between the submission read and status update, so the displayed submission does not match the locked comments. [ASSUMED]
**Why it happens:** Snapshot creation and state change are separate client/API operations. [ASSUMED]
**How to avoid:** Perform row lock, ordered snapshot copy, generation increment, state transition, audit, and notification insert in one database transaction. [ASSUMED]
**Warning signs:** Submission logic contains multiple network round trips or no row lock/version check. [ASSUMED]

### Pitfall 7: Coordinate Drift

**What goes wrong:** Pins shift after responsive resize, browser zoom, or a different page aspect ratio. [ASSUMED]
**Why it happens:** Coordinates were captured in viewport pixels or measured against the wrong wrapper. [ASSUMED]
**How to avoid:** Use per-page normalized ratios, immutable artifact dimensions, and test at multiple viewport widths. [ASSUMED]
**Warning signs:** CSS transform-based zoom or scroll offsets appear in persisted values. [ASSUMED]

### Pitfall 8: Pointer-Only Review

**What goes wrong:** Keyboard and mobility users cannot place or discover pins, and focus disappears after comment jumps. [CITED: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html]
**Why it happens:** The interaction is modeled as a canvas click/drag rather than controls and relationships. [ASSUMED]
**How to avoid:** Native buttons, visible focus, keyboard crosshair movement, programmatic labels/descriptions, logical focus order, and bidirectional focus after jumps. [CITED: https://www.w3.org/WAI/ARIA/apg/patterns/button/] [CITED: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html]
**Warning signs:** No tab stop on pins, mouse coordinates required, or comment selection only scrolls without moving focus. [ASSUMED]

### Pitfall 9: Email and State Become One Failure Domain

**What goes wrong:** Assignment/submission succeeds but the route reports failure, or repeated requests send duplicates. [ASSUMED]
**Why it happens:** Mail is sent synchronously without a durable dedupe record. [ASSUMED]
**How to avoid:** Create a unique notification ledger record in the state transaction, send after commit, and update sent/failed status. [ASSUMED]
**Warning signs:** SendGrid is invoked before the review mutation commits or there is no unique dedupe key. [ASSUMED]

### Pitfall 10: Orphaned or Partially Versioned Objects

**What goes wrong:** Some page images exist without a committed version, or retry overwrites history. [ASSUMED]
**Why it happens:** Multi-object Storage writes and Postgres writes are not one transaction. [ASSUMED]
**How to avoid:** Use a fresh UUID prefix and `upsert: false`; publish the DB row last; compensate only that prefix on failure; add an admin-safe orphan reconciliation report later if operations require it. [ASSUMED]
**Warning signs:** Object paths are derived only from review title/version number or uploads use upsert. [ASSUMED]

## Code Examples

Verified API shapes from official sources, adapted to the recommended boundaries:

### Route Handler Upload Envelope

```typescript
// Source: installed Next.js 16 route-handler guide:
// node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const formData = await request.formData()
  const upload = formData.get('file')
  if (!(upload instanceof File)) {
    return Response.json({ error: 'File required' }, { status: 400 })
  }
  // Phase implementation: authorize admin, enforce 4 MiB,
  // copy bytes, validate/convert, then persist.
}
```

`request.formData()` and Route Handler Web `Request`/`Response` usage are documented for installed Next.js 16; the authorization and 4 MiB logic are phase-specific additions. [VERIFIED: installed Next.js 16 route-handler guide] [ASSUMED]

### Deny-All Sandbox Lifecycle

```typescript
// Source: https://vercel.com/docs/sandbox
import { Sandbox } from '@vercel/sandbox'

const sandbox = await Sandbox.create({
  image: process.env.DOCUMENT_CONVERTER_IMAGE_DIGEST!,
  networkPolicy: 'deny-all',
  timeout: 120_000,
})

try {
  await sandbox.writeFiles([{ path: '/work/input', content: sourceBytes }])
  const result = await sandbox.runCommand({
    cmd: '/opt/document-converter/convert',
    args: ['/work/input', '/work/output'],
  })
  if (result.exitCode !== 0) throw new Error('Conversion rejected')
  const manifest = await sandbox.readFileToBuffer('/work/output/manifest.json')
  // Validate manifest and all page outputs before persistence.
} finally {
  await sandbox.stop()
}
```

The exact SDK option/command details must be compiled against `@vercel/sandbox@2.9.0` during Wave 0 because the converter image command is phase-owned. [VERIFIED: Vercel Sandbox docs + package type inspection] [ASSUMED]

### Guest Token Creation

```typescript
// Source: Node.js built-in crypto API; phase-specific record shape.
import { createHash, randomBytes } from 'node:crypto'

export function createGuestToken() {
  const raw = randomBytes(32).toString('base64url')
  const digest = createHash('sha256').update(raw).digest('hex')
  return { raw, digest }
}
```

Only `digest` is stored; `raw` exists long enough to build the first invitation and must never enter audit metadata. [VERIFIED: D-07] [ASSUMED]

### Responsive Coordinate Conversion

```typescript
// Source: phase design derived from DOM bounding-box semantics.
export function pointToRatios(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
) {
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  }
}
```

Unit tests must cover all four corners, clamping, non-square pages, and two rendered sizes producing identical ratios. [ASSUMED]

### Staff Capability Policy

```sql
-- Source: existing PSG Hub private.current_user_has_fn policy pattern.
create policy "document review admins can manage reviews"
on public.document_reviews
for all
to authenticated
using (private.current_user_has_fn('secure_document_review_admin'))
with check (private.current_user_has_fn('secure_document_review_admin'));
```

The migration must use the exact table/function signatures present at implementation time and include RLS in the same local migration. [VERIFIED: existing migrations + Phase 6 migration-safety protocol]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Next.js API Pages conventions | App Router Route Handlers using Web `Request`/`Response`; route params are promises | Installed Next.js 16.2.3 | Plans and examples must follow installed docs, not training-era Pages Router APIs. [VERIFIED: installed Next.js 16 docs] |
| Browser-delivered uploaded HTML/PDF | Server-normalized inert page bundle | Phase 19 locked decision | Active HTML and original document parsers stay out of the reviewer browser. [VERIFIED: D-04] [ASSUMED] |
| Global allow/deny sandbox networking | Per-sandbox `networkPolicy`, including deny-all/custom policy | Vercel announced advanced egress controls before this research date | Converter egress can be denied independently of application networking. [CITED: https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox] |
| WCAG 2.1 pointer assumptions | WCAG 2.2 includes a dragging-movement alternative requirement | WCAG 2.2 | A keyboard/non-drag pin placement path is a first-class requirement, not optional polish. [CITED: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html] |
| OWASP ASVS 4.0.3 taxonomy | OWASP ASVS 5.0.0 is the current stable release | Released 2025-05-30 | Security planning should use the ASVS 5 category names below. [CITED: https://github.com/OWASP/ASVS/releases] |

**Deprecated/outdated:**

- Treat `src/lib/report/download.ts` and `src/lib/email/sendgrid.ts` from the context as literal paths: the current equivalents are the report download Route Handler and `src/lib/mail/sendgrid.ts`; planners should cite the live paths. [VERIFIED: repository inspection]
- Use `--runInBand` with Vitest: Vitest 4.1.7 rejects that Jest flag; use the existing `pnpm test -- <path>` form. [VERIFIED: local command execution]
- Assume a global project configuration removes the need for per-object authorization: Storage and service-role scopes remain separate and must be checked at the module route. [VERIFIED: Supabase official docs + existing report route]
- Treat the old migration apply mechanism as planning authority: Phase 19 only authors/tests locally; any later production apply method is a separate operator-gated procedure. [VERIFIED: D-22 + current .paul/STATE.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The v1 product ceiling should be 4 MiB per file and 100 pages. | Summary / validation ladder | Some real documents may be rejected; increasing it requires a quarantine/TUS design review. |
| A2 | A manifest + PNG + text bundle meets review fidelity better than adding PDF.js in v1. | Summary / architecture | Pixel rendering may not satisfy later text-selection or exact accessibility expectations. |
| A3 | `@vercel/sandbox` can be used from the deployed PSG Hub environment with the required custom image and credentials. | Standard Stack / architecture | The plan needs an alternate isolated worker if tenancy, cost, region, or credential constraints fail. |
| A4 | LibreOffice + Chromium + Poppler produce acceptable fidelity for PSG's representative HTML/DOCX/PDF corpus. | Conversion pattern | Fixture evaluation may require font/image additions or a different renderer. |
| A5 | Seven days is the appropriate default guest expiry. | Guest access | Operational review cycles may require a different default; it remains administrator-configurable. |
| A6 | JSON snapshots are sufficient and preferable to per-comment snapshot rows. | Data model | Reporting/query requirements could favor normalized snapshot rows. |
| A7 | Reopening preserves prior snapshots and creates a new submission generation. | State pattern | Product owners may intend reopen to replace the only submission, which would weaken history. |
| A8 | A database notification ledger plus immediate SendGrid send is enough without a new queue. | Notifications | Transient failures may need a scheduled retry mechanism; reminders are intentionally deferred. |
| A9 | Inline-only HTML assets are an acceptable first-release constraint. | Inert artifact | Some source HTML may rely on remote CSS/fonts/images and render incompletely. |
| A10 | Scanned PDFs can be reviewed as images without OCR in v1. | Deferred scope | Screen-reader access to document content will be limited for image-only pages. |

## Open Questions

1. **Does the 4 MiB / 100-page ladder cover representative PSG review files?**
   - What we know: It fits Vercel's 4.5 MB request envelope and avoids pre-validation persistent upload. [CITED: https://vercel.com/docs/functions/limitations]
   - What's unclear: No representative corpus size/page distribution was present in the repo. [VERIFIED: repository search]
   - Recommendation: Make Wave 0 collect at least one real example of each format and report size, pages, conversion time, and visual variance before UI implementation. [ASSUMED]

2. **Is page-image fidelity acceptable for DOCX and HTML?**
   - What we know: It produces the simplest inert, format-uniform surface and stable coordinates. [ASSUMED]
   - What's unclear: Required font availability and external HTML asset expectations are not specified. [VERIFIED: 19-CONTEXT.md]
   - Recommendation: Approve the converter fixture contact sheet as a planning checkpoint; keep text selection, OCR, and external asset fetching out of v1. [ASSUMED]

3. **Can the app's Vercel account create Sandbox instances and custom images in all required environments?**
   - What we know: Vercel officially exposes the SDK, custom images, and deny-all network policy; the package is not yet installed in this app. [VERIFIED: Vercel docs + package inspection]
   - What's unclear: Account entitlements, cost ceiling, regional availability, and runtime credentials were not mutated or tested during read-only research. [VERIFIED: environment audit]
   - Recommendation: Put a throwaway “create/write/run/read/stop with deny-all” smoke test and pinned-image build at the start of Wave 0; do not build module logic around an unproven remote adapter. [ASSUMED]

4. **Who receives submission notices when the creating administrator changes or leaves?**
   - What we know: D-15 says notify “the administrator,” and the review record can store its owner. [VERIFIED: D-15] [ASSUMED]
   - What's unclear: Whether notifications should target creator, current owner, or a team mailbox. [VERIFIED: 19-CONTEXT.md]
   - Recommendation: Use an explicit `administrator_profile_id` plus snapshotted email; require reassignment before deactivation in a later operations policy. [ASSUMED]

5. **What should happen when an invitation email fails and the raw token is gone?**
   - What we know: D-07 prohibits raw-token storage; a failed send cannot be replayed from the database. [VERIFIED: D-07]
   - What's unclear: Whether automatic retries may keep the token in short-lived process/queue memory. [VERIFIED: 19-CONTEXT.md]
   - Recommendation: Mark the invitation failed and make “Resend invitation” revoke/rotate the token and create a fresh invitation/audit event. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | App/tests | ✓ | 26.4.0 locally | Use the Node version supported by the deployed Next/Vercel runtime. [VERIFIED: local command + installed Next docs] |
| pnpm | Dependency/test commands | ✓ | 9.15.0 | — [VERIFIED: local command] |
| Supabase CLI | Local migrations/types | ✓ | 2.107.0 | — [VERIFIED: local command] |
| Docker CLI | Local Supabase and converter image | CLI ✓; daemon ✗ | 29.5.3 | Start Docker Desktop before local DB/image integration. [VERIFIED: `docker info` + `supabase status`] |
| Vercel CLI | Preview/platform inspection | ✓ | 54.21.1 | SDK route tests can use an injected fake. [VERIFIED: local command] |
| `@vercel/sandbox` | Production conversion adapter | ✗ not installed | Recommended 2.9.0 | Add in Wave 0 after the approved package check. [VERIFIED: pnpm list + npm registry] |
| LibreOffice | DOCX exploratory conversion | ✓ | LibreOfficeDev 26.8 alpha | Production uses pinned converter-image version, not the local alpha. [VERIFIED: local command] |
| Poppler tools | PDF inspect/raster/text | ✓ | Commands available | Production uses pinned converter-image versions. [VERIFIED: local command] |
| Chrome/Chromium executable | HTML exploratory conversion | ✗ system browser not found | Build it into the converter image. [VERIFIED: local command search] |
| Vitest | Fast tests | ✓ | 4.1.7 | — [VERIFIED: pnpm list] |
| Playwright + axe | E2E/accessibility | ✓ packages | 1.60.0 / 4.11.3 | Requires local Supabase/Docker for full existing harness. [VERIFIED: pnpm list + Playwright config] |

**Missing dependencies with no immediate fallback:**

- A running Docker daemon is required to reset/test the local Supabase database and build/exercise the custom converter image; it was not running during research. [VERIFIED: local command execution]
- Vercel Sandbox account/runtime entitlement and deny-all smoke behavior remain unverified; Wave 0 must prove them before implementation depends on the adapter. [ASSUMED]

**Missing dependencies with fallback:**

- System Chromium is missing, but the planned pinned custom converter image provides it; unit tests can use an injected converter fake before image integration is available. [VERIFIED: environment audit] [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 for unit/integration; Supabase SQL tests for RLS/RPC; Playwright 1.60.0 + axe 4.11.3 for workflow/accessibility; converter fixture self-check in its image. [VERIFIED: package/config inspection] |
| Config file | `vitest.config.ts`, `playwright.config.ts`, `e2e/global.setup.ts`; create phase SQL and converter test entrypoints in Wave 0. [VERIFIED: repository inspection] [ASSUMED] |
| Quick run command | `pnpm test -- src/lib/document-review` after Wave 0 creates the directory; current command shape is verified and does not use unsupported `--runInBand`. [VERIFIED: local Vitest execution] |
| Full suite command | `pnpm test`; then local DB reset/SQL tests; then `pnpm test:e2e -- e2e/document-review.spec.ts` with Docker/local Supabase running. [VERIFIED: package scripts + existing test harness] [ASSUMED] |

### Test Pyramid

```text
Few Playwright flows
  - authenticated reviewer
  - guest fragment exchange/revoke
  - admin inspect/reopen/version
  - keyboard-only pins + axe

Focused route/RPC/converter integration
  - exact authorization boundary
  - transactional submit/reopen
  - private object proxy
  - malicious fixture conversion

Many fast unit tests
  - tokens, expiry, cookies
  - coordinate math and ordering
  - schemas, state machine, key derivation
  - email payload/dedupe
```

The pyramid keeps most per-task checks below 30 seconds while reserving real parser/browser/database boundaries for wave and phase gates. [ASSUMED]

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SDR-01 | Capability-gated create and allowlisted upload | Route unit + E2E | `pnpm test -- src/app/api/document-reviews/__tests__/upload.test.ts` | ❌ Wave 0 [ASSUMED] |
| SDR-02 | Pre-persistence validation, private original, inert page bundle | Converter contract + storage route | `pnpm test -- src/lib/document-review/__tests__/upload.test.ts` plus converter fixture command | ❌ Wave 0 [ASSUMED] |
| SDR-03 | Auth assignment and expiring/revocable guest invite | Unit + RLS + E2E | `pnpm test -- src/lib/document-review/__tests__/tokens.test.ts` | ❌ Wave 0 [ASSUMED] |
| SDR-04 | Exact assignment boundary and no object enumeration | Route + SQL RLS + E2E | `pnpm test -- src/lib/document-review/__tests__/auth.test.ts` | ❌ Wave 0 [ASSUMED] |
| SDR-05 | Draft pin create/edit/delete; locked after submit | Unit + RPC integration + E2E | `pnpm test -- src/lib/document-review/__tests__/comments.test.ts` | ❌ Wave 0 [ASSUMED] |
| SDR-06 | Stable alignment at multiple sizes/zoom | Unit + Playwright | `pnpm test -- src/lib/document-review/__tests__/coordinates.test.ts` | ❌ Wave 0 [ASSUMED] |
| SDR-07 | Atomic snapshot lock and deduped admin notice | SQL/RPC + route unit | `pnpm test -- src/lib/document-review/__tests__/submission.test.ts` | ❌ Wave 0 [ASSUMED] |
| SDR-08 | Document-order list and focus jump | Component + Playwright | `pnpm test:e2e -- e2e/document-review.spec.ts` | ❌ Wave 0 [ASSUMED] |
| SDR-09 | Reopen generation and immutable new version/history | SQL/RPC + E2E | Local SQL suite plus `pnpm test:e2e -- e2e/document-review.spec.ts` | ❌ Wave 0 [ASSUMED] |
| SDR-10 | Hash/expiry/revoke/IDOR/malicious files/HTML isolation | Unit + converter security corpus | `pnpm test -- src/lib/document-review` plus converter fixture command | ❌ Wave 0 [ASSUMED] |
| SDR-11 | Keyboard placement, visible focus, relationships, no-pointer flow | Playwright + axe | `pnpm test:e2e -- e2e/document-review-accessibility.spec.ts` | ❌ Wave 0 [ASSUMED] |
| SDR-12 | Local schema/RLS proof and zero production mutation | Migration reset + SQL tests | `supabase db reset --local` followed by project SQL test command | Harness exists; phase tests ❌ Wave 0 [VERIFIED: local Supabase structure] [ASSUMED] |

### Required Security Fixture Corpus

| Fixture | Expected Result |
|---------|-----------------|
| Valid minimal PDF, DOCX, and self-contained HTML | Accepted; deterministic manifest/pages/text generated. [ASSUMED] |
| `.pdf` filename containing HTML or ZIP bytes | Rejected before conversion. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html] |
| Truncated/malformed and encrypted PDF | Rejected with safe generic error. [ASSUMED] |
| DOCX missing required OOXML entries | Rejected. [ASSUMED] |
| DOCX with excessive compressed-entry ratio or expanded bytes | Rejected before LibreOffice. [ASSUMED] |
| HTML with script, event attributes, remote image/font/CSS, fetch/WebSocket, and `file://` reference | Artifact contains no executed behavior and converter records zero successful network access. [CITED: https://github.com/puppeteer/puppeteer/blob/main/docs/api/puppeteer.page.setrequestinterception.md] [CITED: https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox] [ASSUMED] |
| Document producing 101 pages | Rejected without Storage writes. [ASSUMED] |
| Converter timeout/crash/invalid manifest | No persistent objects or DB version row. [ASSUMED] |

### Authorization Matrix

| Actor | Assigned draft | Assigned submitted | Other review | Admin action | Original download |
|-------|----------------|--------------------|--------------|--------------|-------------------|
| Auth recipient | Read/comment/submit | Read snapshot | 404/deny | Deny | Deny [VERIFIED: D-08/D-12] |
| Active guest recipient | Read/comment/submit | Read snapshot | 404/deny | Deny | Deny [VERIFIED: D-07/D-12] |
| Expired/revoked guest | 404/deny | 404/deny | 404/deny | Deny | Deny [VERIFIED: D-07] |
| Capability admin | Read/inspect | Read/inspect/reopen | Assigned module administration | Allow | Attachment only [VERIFIED: D-12] [ASSUMED] |
| Authenticated unrelated user | 404/deny | 404/deny | 404/deny | Deny | Deny [VERIFIED: D-08] |

Every matrix cell needs a route test, and direct PostgREST/Storage access must also be denied where the browser has no need for it. [VERIFIED: Phase 6 RLS checklist] [ASSUMED]

### Sampling Rate

- **Per task commit:** Run the narrowest `pnpm test -- <phase path>` command plus TypeScript/lint for touched files; converter or SQL tasks also run their narrow fixture/test command. [VERIFIED: existing project test convention] [ASSUMED]
- **Per wave merge:** Run `pnpm test`, local migration reset/RLS tests, and the relevant converter fixture set; UI waves also run targeted Playwright. [ASSUMED]
- **Phase gate:** Full Vitest suite, local schema reset/RLS proof, full malicious converter corpus, authenticated and guest E2E, keyboard-only/axe checks, production build, and explicit evidence that project `gylkkzmcmbdftxieyabw` was not mutated. [VERIFIED: SDR-10/11/12] [ASSUMED]

### Wave 0 Gaps

- [ ] `src/lib/document-review/__tests__/tokens.test.ts` — hash, expiry, rotation, cookie, no raw persistence. [ASSUMED]
- [ ] `src/lib/document-review/__tests__/auth.test.ts` — admin/auth-recipient/guest exact-resource matrix. [ASSUMED]
- [ ] `src/lib/document-review/__tests__/coordinates.test.ts` — normalized geometry and order. [ASSUMED]
- [ ] `src/lib/document-review/__tests__/submission.test.ts` — state/snapshot/email dedupe seam. [ASSUMED]
- [ ] `supabase/tests/document_review_rls.sql` — direct-table policies, RPC privileges, immutable version/snapshot/audit, edit-state trigger. [ASSUMED]
- [ ] `workers/document-converter/` with pinned image, deterministic fixture command, and malicious corpus. [ASSUMED]
- [ ] `e2e/document-review.spec.ts` and `e2e/document-review-accessibility.spec.ts`. [ASSUMED]
- [ ] Install `@vercel/sandbox@2.9.0` only after the plan records the package audit and proves create/write/run/read/stop with deny-all policy. [VERIFIED: package audit] [ASSUMED]
- [ ] Start Docker Desktop before any local Supabase or converter-image gate; current daemon state is blocking those checks. [VERIFIED: environment audit]

## Security Domain

OWASP ASVS 5.0.0 is the current stable ASVS release as of this research date. [CITED: https://github.com/OWASP/ASVS/releases]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Encoding and Sanitization | yes | Never deliver active upload content; encode all filenames/comments in HTML/email and render page images. [VERIFIED: D-04] [ASSUMED] |
| V2 Validation and Business Logic | yes | Zod boundaries plus database constraints/state RPCs; reject replay/invalid transitions. [ASSUMED] |
| V3 Web Frontend Security | yes | CSP for guest/reviewer pages, no uploaded HTML execution, no token in browser storage. [ASSUMED] |
| V4 API and Web Service | yes | Server-only DAL, uniform unauthorized responses, request size limits, Origin checks on guest mutations. [VERIFIED: installed Next.js data-security guide] [ASSUMED] |
| V5 File Handling | yes | Extension + signature + structure + size/page/expansion limits; sandbox/CDR-style normalization; private storage. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html] |
| V6 Authentication | yes | Supabase `getUser()` for authenticated users; high-entropy module guest bearer exchange. [VERIFIED: D-21 + installed Next.js auth guide] |
| V7 Session Management | yes | Secure HttpOnly SameSite scoped guest cookie; database expiry/revocation checked every request. [ASSUMED] |
| V8 Authorization | yes | Exact recipient/version gate plus RLS, private capability helper, and service-role-after-authorization only. [VERIFIED: existing app patterns + D-08] |
| V9 Self-contained Tokens | limited | Do not use a self-contained guest JWT; database digest records provide immediate revocation. [VERIFIED: D-07/D-21] [ASSUMED] |
| V11 Cryptography | yes | Node CSPRNG and SHA-256; never hand-roll encryption or store raw guest token. [VERIFIED: D-07] [ASSUMED] |
| V13 Configuration | yes | Pinned converter image, deny-all egress, no secrets, fixed timeouts/resource ceilings, fixed database helper search path. [VERIFIED: Phase 6 protocol + Vercel docs] [ASSUMED] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged/stolen guest link | Spoofing | 256-bit random token, digest-only DB storage, fragment exchange, HttpOnly cookie, expiry, revoke/rotate, no logs. [VERIFIED: D-07] [ASSUMED] |
| Review/version/object IDOR | Spoofing / Information Disclosure | Exact shared authorization gate, derive object key from DB row, uniform deny, direct RLS/Storage denial tests. [VERIFIED: D-08 + existing report route] |
| Comment/status tampering after submit | Tampering | State constraints/triggers and atomic service RPC; immutable snapshot. [VERIFIED: D-11] [ASSUMED] |
| Version/history mutation | Tampering / Repudiation | Block update/delete on versions, snapshots, and audit events; append-only events. [VERIFIED: D-13/D-16] [ASSUMED] |
| Parser escape or HTML network exfiltration | Elevation / Information Disclosure | Ephemeral microVM, deny-all network, no app secrets, disabled JS, aborted requests, inert output only. [VERIFIED: D-18] [CITED: https://vercel.com/docs/sandbox] |
| ZIP bomb/page bomb/converter hang | Denial of Service | 4 MiB input, 100 MiB DOCX expansion, 100 pages, process/sandbox timeouts, output limits. [ASSUMED] |
| Public/signed object leakage | Information Disclosure | Private bucket, no public/reviewer signed URL, server proxy with no-store/nosniff. [VERIFIED: D-05 + Supabase docs] |
| Original file active rendering | Elevation / Information Disclosure | Admin-only `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. [CITED: https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload] [ASSUMED] |
| Duplicate invite/submission messages | Repudiation / Denial of Service | Unique notification dedupe key and durable sent/failed status. [ASSUMED] |
| Cross-site guest mutation | Spoofing / Tampering | SameSite=Strict cookie, POST/PATCH/DELETE only, Origin verification, no permissive CORS. [ASSUMED] |

### Production Boundary

No production migration, bucket creation, RLS change, service-role write, test recipient, or live invitation is authorized by this research. Plans must stop after local proof and create a separately visible operator gate for any later mutation of `gylkkzmcmbdftxieyabw`. [VERIFIED: D-22]

## Deferred from the First Release

- Files larger than 4 MiB and the private quarantine/TUS architecture needed to support them. [ASSUMED]
- OCR for image-only/scanned PDFs. [ASSUMED]
- Browser PDF.js, text selection/search, and semantic document reflow. [ASSUMED]
- External HTML assets; v1 HTML must be self-contained and render offline. [ASSUMED]
- Antivirus vendor integration; v1 relies on strict validation, isolated conversion, inert output, and attachment-only original access, but a later compliance review may require an AV/CDR vendor. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html] [ASSUMED]
- Reminder emails or a new job/queue infrastructure; invitation and submission notifications remain in scope. [VERIFIED: D-15 + discretion]
- Automatic pin migration, visual diffs, drawings/shapes/signatures, realtime presence, public anonymous links, and multi-document packages. [VERIFIED: D-14/D-19 + Deferred Ideas]

## Sources

### Primary (HIGH confidence)

- Installed Next.js 16.2.3 docs: `route-handlers.md`, `authentication.md`, `data-security.md`, `server-and-client-components.md`, `route.md`, and `runtime.md` — current route/auth/runtime conventions. [VERIFIED: local installed documentation]
- Context7 `/vercel/next.js/v16.2.2` — Route Handler, Node runtime, auth/DAL corroboration. [VERIFIED: Context7]
- Context7 `/supabase/supabase` — RLS, private Storage, service-role, and signed-URL behavior. [VERIFIED: Context7]
- Context7 `/supabase/cli` — local reset and local type-generation workflow. [VERIFIED: Context7]
- Context7 `/puppeteer/puppeteer` — disabling JavaScript before navigation and request interception/abort. [VERIFIED: Context7]
- [Vercel Sandbox documentation](https://vercel.com/docs/sandbox) — microVM lifecycle, custom images, filesystem/process SDK. [CITED: https://vercel.com/docs/sandbox]
- [Vercel Sandbox egress controls](https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox) — deny-all/custom network policy. [CITED: https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox]
- [Vercel Functions limitations](https://vercel.com/docs/functions/limitations) — 4.5 MB request/response limit. [CITED: https://vercel.com/docs/functions/limitations]
- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) — TUS guidance for larger uploads. [CITED: https://supabase.com/docs/guides/storage/uploads/resumable-uploads]
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) — defense-in-depth upload controls. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html]
- [OWASP ASVS releases](https://github.com/OWASP/ASVS/releases) — current stable ASVS 5.0.0. [CITED: https://github.com/OWASP/ASVS/releases]
- [LibreOffice command-line parameters](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html) and [conversion filters](https://help.libreoffice.org/latest/gu/text/shared/guide/convertfilters.html) — headless conversion. [CITED: https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html] [CITED: https://help.libreoffice.org/latest/gu/text/shared/guide/convertfilters.html]
- [WCAG 2.2 dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible), [focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html), and [ARIA button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) — pin accessibility. [CITED: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html] [CITED: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible] [CITED: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html] [CITED: https://www.w3.org/WAI/ARIA/apg/patterns/button/]

### Project Sources (HIGH confidence)

- `.paul/phases/19-secure-document-review/19-CONTEXT.md` — locked decisions and requirements. [VERIFIED: local file]
- `.paul/PROJECT.md`, `.paul/ROADMAP.md`, `.paul/STATE.md` — product boundary, sequencing, current phase, shared-production safety. [VERIFIED: local files]
- `.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md` and `CHECKLIST-rls-review.md` — binding schema/RLS conventions. [VERIFIED: local files]
- `src/app/api/reports/[shopId]/[period]/download/route.ts` — current private object delivery pattern. [VERIFIED: source inspection]
- `src/lib/report/storage.ts`, `src/lib/report/render.ts`, `src/lib/report/render-client.ts` — storage dependency injection and existing trusted rendering seam. [VERIFIED: source inspection]
- `workers/report-renderer/` — existing renderer trust-boundary evidence; do not reuse for hostile input. [VERIFIED: source inspection]
- `src/lib/auth/shop-access.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/service.ts` — current auth/service-client patterns. [VERIFIED: source inspection]
- `src/lib/mail/sendgrid.ts` and resilience helpers — current transactional email adapter. [VERIFIED: source inspection]
- Supabase migrations for `app_user_roles`, `security_profiles`, `private.current_user_has_fn`, `monthly_reports`, and private report storage — schema/RLS precedent. [VERIFIED: source inspection]
- `vitest.config.ts`, `playwright.config.ts`, `e2e/global.setup.ts`, package scripts, and representative tests — current validation architecture. [VERIFIED: source inspection + local test execution]

### Secondary (MEDIUM confidence)

- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/) — alternative browser PDF rendering reference; not recommended for v1. [CITED: https://mozilla.github.io/pdf.js/examples/]
- [OWASP Unrestricted File Upload](https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload) — attachment/nosniff defense for retained originals. [CITED: https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload]
- npm registry metadata and slopcheck for `@vercel/sandbox@2.9.0` — package currency/legitimacy corroboration. [VERIFIED: npm registry + slopcheck]

### Tertiary (LOW confidence)

- None; unresolved product/operational choices are explicitly listed as `[ASSUMED]` in the Assumptions Log. [VERIFIED: this research]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — current app/package versions, official Vercel/Supabase/Next docs, correct registry, and package legitimacy were verified. [VERIFIED: package/docs/tool checks]
- Architecture: HIGH for tier boundaries and authorization; MEDIUM for the exact converter image/fidelity until Wave 0 corpus and Sandbox smoke pass. [VERIFIED: locked constraints + repo patterns] [ASSUMED]
- Pitfalls: HIGH for upload limits, active HTML, private-object authorization, and accessibility; MEDIUM for proposed operational ceilings. [VERIFIED: official sources] [ASSUMED]
- Validation: HIGH for framework/command shape; MEDIUM for uncreated phase fixtures and currently unavailable Docker/Sandbox integration. [VERIFIED: local test execution + environment audit] [ASSUMED]

**What might have been missed:** Vercel Sandbox account entitlement/cost/region, representative PSG document fidelity, font licensing/availability inside the image, and the business owner for submission notifications remain explicit Wave 0 questions rather than hidden assumptions. [VERIFIED: Open Questions] [ASSUMED]

**Research date:** 2026-07-28
**Valid until:** 2026-08-04 for Vercel Sandbox/package/platform limits; 2026-08-27 for stable repo/database/accessibility patterns. [ASSUMED]

## RESEARCH COMPLETE

**Phase:** 19 - Secure Document Review
**Confidence:** HIGH overall, with MEDIUM confidence isolated to converter-image fidelity and Vercel Sandbox environment proof. [VERIFIED: research evidence] [ASSUMED]

### Key Findings

- Use a 4 MiB direct upload ceiling and 100-page output ceiling so deep validation can finish before any persistent Storage write. [CITED: https://vercel.com/docs/functions/limitations] [ASSUMED]
- Normalize every format to private inert page images/text; never embed an original HTML, DOCX, or PDF in the reviewer browser. [VERIFIED: D-04/D-05] [ASSUMED]
- Isolate conversion in a pinned, deny-all-network Vercel Sandbox custom image; reuse the existing renderer's adapter seam, not its trust boundary. [VERIFIED: repo inspection] [CITED: https://vercel.com/docs/sandbox]
- Put auth users and guest links behind one exact-resource server authorization gate, with digest-only guest records and a fragment-to-HttpOnly-cookie exchange. [VERIFIED: D-07/D-08/D-21] [ASSUMED]
- Enforce immutable versions, atomic snapshots, reopen generations, edit locks, audit, and notification dedupe in Postgres/RPCs; keep production read-only until a separate operator gate. [VERIFIED: D-11/D-13/D-16/D-22] [ASSUMED]

### File Created

`.paul/phases/19-secure-document-review/19-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Installed versions, official docs, registry, source repo, and slopcheck were verified. [VERIFIED: tool outputs] |
| Architecture | HIGH / MEDIUM | Auth/storage/state boundaries are repo-grounded; converter fidelity and account entitlement need Wave 0 proof. [VERIFIED: repo/docs] [ASSUMED] |
| Pitfalls | HIGH | Platform, OWASP, Supabase, W3C, and current source patterns corroborate the major risks. [VERIFIED: official sources + repository] |

### Open Questions

The planner must front-load proof of the 4 MiB/100-page corpus fit, page-image fidelity, Vercel Sandbox entitlement/custom-image lifecycle, and the administrator notification owner. [ASSUMED]

### Ready for Planning

Research is complete. The planner can create Phase 19 PLAN.md files with Wave 0 converter, schema/RLS, and test seams before product UI work. [VERIFIED: required research sections present] [ASSUMED]
