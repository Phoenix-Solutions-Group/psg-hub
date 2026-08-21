---
phase: 19
slug: secure-document-review
status: draft
shadcn_initialized: true
preset: b2fA
created: 2026-07-28
---

# Phase 19 — Secure Document Review UI Design Contract

> Visual and interaction source of truth for the Secure Document Review module. This phase extends PSG Hub; it does not introduce a separate product identity or document-editing surface.

---

## Contract Basis

| Source | Locked consequence |
|--------|--------------------|
| `19-CONTEXT.md` | Secure Document Review is a PSG Hub module; both authenticated and guest reviewers are required; comments are page pins only; submission locks edits; versions and submissions are immutable. |
| `19-RESEARCH.md` | Display inert page images with extracted page text; store normalized page coordinates; use fragment-to-cookie guest entry; order submitted comments by page/Y/X; current provisional limits are 4 MiB, 100 pages, and 7 days. |
| `PROJECT.md` | Reuse the existing Next.js 16, Tailwind 4, shadcn/Base UI, PSG brand, RBAC, and responsive dashboard shell. |
| `BRAND-CONFORMANCE-v0.2.md` | All colors, radii, and type flow through existing semantic tokens; no raw hex values or competing visual identity in implementation. |
| `BRAND-VISUAL-v0.2.md` | Preserve paper surface, midnight sidebar, single ember accent, PSG logo treatment, and the current mobile navigation below `lg`. |
| Existing `src/app` and `src/components` | Reuse the `space-y-6` page rhythm, 24px shell padding, Card/Table/Button/Input/Label/Badge primitives, native form controls, branded loading/error/empty states, and existing modal focus behavior. |

The 4 MiB upload ceiling, 100-page ceiling, and 7-day guest expiry are research defaults pending Wave 0 proof. UI copy must use the proven values from one shared server-owned configuration before release. A Wave 0 change to any value changes the copy below; it does not change the layout contract.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn |
| Preset | `b2fA` (`base-nova`, neutral, RSC, Tailwind 4) |
| Component library | Base UI through the existing shadcn primitives |
| Installed primitives to reuse | `Button`, `Card`, `Input`, `Label`, `Table`, `Badge` |
| Native elements to reuse | `input[type=file]`, `select`, `textarea`, `button`, `progress` only when progress is measurable |
| Modal pattern | Existing PSG Hub modal contract: labelled `role="dialog"`, `aria-modal`, initial focus, contained Tab order, Escape close where cancellation is safe, and focus return |
| Icon library | Lucide; icons are supplementary and never replace text labels |
| Body font | Didact Gothic through `font-sans` |
| Heading/control font | Gotham through `font-heading` |
| Radius | Existing `--radius: 0.375rem` / 6px family |
| Theme | Existing light PSG Hub theme; do not create a module theme or document-editor chrome |

No new design-system package, annotation library, canvas library, editor framework, or third-party component registry is permitted for this phase.

---

## Spacing Scale

Declared values are the existing 4px-based rhythm:

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Pin number inset, icon-to-label gap, compact metadata gap |
| sm | 8px | Control groups, table-cell content, inline actions |
| md | 16px | Card internal groups, form-field stacks, modal mobile padding |
| lg | 24px | Existing page section gap, desktop modal padding, viewer gutters |
| xl | 32px | Major form groups and review-detail sections |
| 2xl | 48px | Empty-state vertical padding and large screen separation |
| 3xl | 64px | Reserved for page-level breathing room; not used inside dense review tools |

Exceptions:

- Every pointer target in the review viewer is at least 44px by 44px, including pin buttons, zoom controls, page controls, and mobile toolbar actions.
- A pin may render as a 28px numbered circle inside a transparent 44px hit target.
- Existing PSG Hub shell dimensions remain unchanged: 60rem sidebar width utility (`w-60`), 64px header, and 24px main padding.

Do not add 6px, 10px, 14px, 20px, or other one-off layout spacing. Existing component-internal styles are not overridden.

---

## Typography

Phase-authored text uses exactly four sizes and two weights:

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Metadata | 12px | 400 | 1.5 | Page count, version, timestamps, reviewer state, keyboard hints |
| Label | 14px | 700 | 1.4 | Field labels, table headers, buttons, pin labels |
| Body | 16px | 400 | 1.5 | Instructions, comments, errors, empty-state copy |
| Heading | 24px | 700 | 1.2 | Screen title; nested section headings use the same weight at the existing component size |

Rules:

- Use Didact Gothic for body and metadata; use Gotham for headings, labels, and controls.
- Preserve the existing uppercase tracked eyebrow only when the screen needs product context above the H1. Do not add an eyebrow to every card.
- Comment text is never smaller than 16px in the composer or locked review.
- Long filenames, emails, titles, and comments wrap; they must not be truncated when the full value is needed to make a decision.
- UI status is expressed in text, not only by font weight or color.

---

## Color

| Role | Existing token/value | Usage |
|------|----------------------|-------|
| Dominant (60%) | `--background` / paper `#FAFAFA` | App and reviewer canvas background |
| Secondary (30%) | `--card` / white `#FFFFFF`; inherited `--sidebar` / midnight `#1E3A52` | Cards, forms, comment rail, page surround, and the existing PSG shell |
| Accent (10%) | `--ember` / `#B8483E` | Current pin, current comment indicator, visible focus ring, and the single final “Submit review” emphasis |
| Primary action | `--primary` / midnight `#1E3A52` | Create, save, invite, retry, add-comment, and navigation actions |
| Success | `--success` / sage `#526B51` | Submitted status and completed upload state, always with text |
| Warning | `--warning` / amber `#C28E3A` | Expiring-soon invitation and accessibility/conversion warnings, always with text |
| Destructive | `--destructive` / ember `#B8483E` | Revoke access and delete draft comment only |
| Muted | `--muted`, `--muted-foreground` / `#707070` | Secondary surfaces and supporting copy |

Accent is reserved for:

- The active pin and its matching selected comment.
- The existing visible focus ring.
- The final “Submit review” action when the review is ready.
- Destructive semantics in their existing tinted treatment.

Do not use ember for every button, link, badge, toolbar control, or page number. Inactive pins use midnight with a high-contrast number. Status badges always include the status word and must not rely on hue.

---

## Copywriting Contract

### Core Copy

| Element | Exact copy |
|---------|------------|
| Module navigation label | Document Reviews |
| Admin list H1 | Document reviews |
| Admin list description | Upload documents, invite reviewers, and collect submitted feedback. |
| Admin primary CTA | Create review |
| Reviewer list H1 | Reviews assigned to you |
| Create H1 | Create document review |
| Upload helper | One PDF, DOCX, or self-contained HTML file. Up to 4 MiB and 100 pages. External HTML assets will not load. |
| Create submit CTA | Create and invite |
| Admin empty heading | No document reviews yet |
| Admin empty body | Create a review to upload a document and invite reviewers. |
| Reviewer empty heading | No reviews assigned |
| Reviewer empty body | Reviews assigned to your PSG Hub account will appear here. |
| Add pin CTA | Add comment on this page |
| Empty comments heading | No comments yet |
| Empty comments body | Add a pin to the document when you want to leave feedback. |
| Draft save CTA | Save comment |
| Final reviewer CTA | Submit review |
| Generic load error heading | This review could not be loaded |
| Generic load error body | Try again. If the problem continues, ask the review administrator for help. |
| Guest unavailable heading | This review link is no longer available |
| Guest unavailable body | The invitation may have expired or been revoked. Ask the sender for a new invitation. |
| Locked heading | Review submitted |
| Locked body | Your comments are locked. The review administrator can reopen the review if changes are needed. |

The upload helper values are provisional until Wave 0 passes. “Self-contained HTML” must remain in the helper even if the numerical limits change.

### Confirmation Copy

| Action | Dialog title | Body | Confirm | Cancel |
|--------|--------------|------|---------|--------|
| Submit review | Submit review? | You’ll no longer be able to edit these {count} comments. PSG can reopen the review if changes are needed. | Submit review | Keep reviewing |
| Delete draft comment | Delete this comment? | This removes the pin and its draft comment. | Delete comment | Keep comment |
| Revoke guest/auth reviewer | Revoke access for {recipient}? | This reviewer will immediately lose access to this document version. Submitted feedback stays in the review history. | Revoke access | Keep access |
| Resend guest invitation | Send a new invitation? | The previous guest link will stop working and a new 7-day invitation will be emailed. | Send new invitation | Cancel |
| Reopen submitted review | Reopen review for {recipient}? | The submitted snapshot stays in history. The reviewer can edit comments and submit a new snapshot. | Reopen review | Cancel |
| Upload new version | Create version {N}? | Comments and submissions stay attached to version {N-1}. They will not move to the new version. | Upload new version | Cancel |

Never put a raw guest token, storage path, object identifier, parser error, or stack detail in user-facing copy.

---

## Navigation and Shell Contract

### Authenticated PSG Hub

- Add one conditional dashboard navigation item labelled “Document Reviews.” Do not rename or reuse the existing “Reviews” item, which is customer reputation management.
- Show the item to a user who has the Secure Document Review admin capability or at least one assigned document review.
- Reuse the existing desktop navy sidebar at `lg` and the existing mobile navigation below `lg`.
- Reuse the shell header, logo, shop switcher behavior, sign-out action, background, and 24px main padding without modification.
- The module is not scoped by the active shop switcher unless the eventual data model explicitly associates a review with a shop. Review access comes from the review assignment/admin capability, not a visually selected shop.
- An admin sees created/managed reviews. A non-admin reviewer sees only “Reviews assigned to you.” A dual-role user sees both sections on the same list screen, with no separate application mode switch.

### Guest

- Guest entry and workspace use a minimal PSG-branded shell: primary logo on paper, document title, recipient-safe status, and a help sentence.
- Do not render the dashboard sidebar, shop switcher, unrelated PSG Hub navigation, account creation prompt, or sign-out action.
- Do not display recipient lists, administrator email addresses, other reviewer activity, audit history, or version history.

---

## Screen Inventory

Route names are design-contract defaults and may be adjusted by the planner only if the information architecture and authorization behavior remain identical.

| Screen | Default route | Actor | Required content | Primary action |
|--------|---------------|-------|------------------|----------------|
| Document review list | `/dashboard/document-reviews` | Admin and/or authenticated reviewer | Role-appropriate sections, status, current version, reviewer progress, updated time | Create review (admin) or Open review (reviewer) |
| Create review | `/dashboard/document-reviews/new` | Admin | Title, one file, recipient rows, limit/helper copy, honest processing state | Create and invite |
| Admin review detail | `/dashboard/document-reviews/[reviewId]` | Admin | Current version summary, versions, recipients, invitation state, submissions, audit-safe actions | Add reviewer or Upload new version |
| Add/invite reviewers | On admin detail, inline section or existing modal pattern | Admin | Auth/guest type, exact email, expiry display, per-recipient validation | Send invitation |
| Upload new version | `/dashboard/document-reviews/[reviewId]/versions/new` | Admin | File input, immutable-history warning, prior recipients available for explicit re-invite | Upload new version |
| Submission inspection | `/dashboard/document-reviews/[reviewId]/submissions/[submissionId]` | Admin | Inert viewer, ordered locked comments, recipient/submission metadata, original download | Jump through comments |
| Authenticated reviewer workspace | `/dashboard/document-reviews/[reviewId]/review` | Assigned auth reviewer | Inert page viewer, pins, draft comments, submit control, locked state | Add comment / Submit review |
| Guest token entry | `/review/guest#token` | Invited guest | Logo and a single secure-opening state | Automatic exchange only |
| Guest reviewer workspace | `/review/guest/[recipientId]` or equivalent cookie-scoped route | Active guest | Same review interaction as authenticated reviewer in guest shell | Add comment / Submit review |
| Guest unavailable | Same guest route | Expired, revoked, invalid, or missing token | Generic unavailable copy | None; ask sender for a new invitation |

No separate dashboard, editor, annotation palette, activity feed, or public review directory is included.

---

## Staff Review List Contract

### Layout

- Use the existing `space-y-6` page stack.
- Header contains H1, one-sentence description, and “Create review.” At narrow widths the action wraps below the description at full width.
- If the user is both an admin and a reviewer, show “Managed by you” first and “Assigned to you” second. Each section has its own empty state.
- Use the existing `Table` primitive for desktop and its horizontal overflow behavior at narrow widths.

### Managed Review Columns

1. Document — review title with original filename as muted secondary text.
2. Version — `v{N}` and page count.
3. Reviewers — submitted count over total, for example `2 of 4 submitted`.
4. Status — text badge: Preparing, Open, Complete, or Needs attention.
5. Updated — localized date/time.
6. Action — “Open review.”

### Assigned Review Columns

1. Document.
2. Version.
3. Administrator — display name only when already available to the recipient.
4. Due/access — guest expiry is not applicable to authenticated reviewers; show invitation or submitted date.
5. Status — Not started, In progress, Submitted, or Reopened.
6. Action — “Start review,” “Continue review,” or “View submission.”

### List States

- Loading: use fixed-height skeleton rows under a real heading and `role="status"` with “Loading document reviews.”
- Empty: use a bordered or dashed empty card with the exact copy above; admin empty state contains “Create review.”
- Error: use the branded recoverable error card with “Try again”; do not replace the whole dashboard shell.
- More than one screen of records: server pagination is allowed, but infinite scroll is not. Pagination is not required until the data volume proves it necessary.

---

## Create, Upload, and Version Contract

### Create Form

Use a full page, not a modal. The smallest coherent form has:

1. Review title — required text input.
2. Document — required native file input accepting `.pdf,.docx,.html`.
3. Reviewer rows — at least one required.
4. Per row: reviewer type (`PSG Hub account` or `Guest`), exact email, and optional display name for a guest.
5. “Add another reviewer” — outline button.
6. Limit/helper copy and HTML offline warning.
7. “Create and invite” — single submission action.

Authenticated reviewer rows use an exact PSG Hub account email and server validation. Do not add a custom combobox or directory-search component in Phase 19. A guest row uses an email address and the displayed default “Access expires 7 days after invitation.”

### Validation

- Validate required fields on blur and submit.
- Associate every error with its field using `aria-describedby`; set `aria-invalid`.
- If an account email is not found, say “No PSG Hub account matches this email. Choose Guest or check the address.”
- If the same email appears twice, prevent submission and identify both duplicate rows.
- Unsupported extension: “Choose a PDF, DOCX, or HTML file.”
- Too large: “This file is larger than {limit}. Choose a smaller file.”
- Too many pages: “This document has more than {pageLimit} pages. Choose a shorter document.”
- Unsafe or unreadable input: “This file could not be prepared safely. Check the file and try again.”
- A failed upload/conversion preserves the title and reviewer inputs. The file control may require re-selection.

### Processing

- After submit, disable duplicate submission and show “Preparing your document…” with supporting copy “We’re validating the file and creating secure review pages. This may take up to two minutes.”
- Use an indeterminate status, not a fabricated percentage, unless the implementation has measured server progress.
- Announce start, failure, and completion through a polite live region.
- Do not invite recipients until the version is fully prepared.
- On success, navigate to the admin review detail and focus its H1. Show a dismissible success status: “Version 1 is ready and invitations were sent.”

### New Version

- Use the same file contract and processing state.
- Show the prior version, its page count, submissions, and the immutable-history warning before the file input.
- Offer prior recipients as prefilled rows, but require the admin to explicitly retain/remove each recipient before submission.
- The confirm action creates a new immutable version and new recipient assignments. It never edits the prior artifact or moves pins.

---

## Admin Review Detail Contract

Use one vertically stacked page rather than tabs.

### Header

- Eyebrow: `Document review`.
- H1: review title.
- Metadata line: current version, original filename, page count, created date.
- Status badge with text.
- Actions: “Upload new version” and admin-only “Download original.” The original always downloads as an attachment and is never previewed inline.

### Version Summary

- A Card lists versions newest first.
- Each version row contains version number, filename, page count, created date, recipient/submission counts, and “Open.”
- Prior versions are visibly “Historical” and remain inspectable.
- No edit, replace, or delete action exists for a version.

### Recipient Section

Each recipient row shows:

- Name/email.
- Type: PSG Hub account or Guest.
- Version.
- Invitation state: Invited, Opened, In progress, Submitted, Expired, Revoked, or Invitation failed.
- Sent/opened/submitted timestamps when present.
- Guest expiry date when active.
- Explicit actions appropriate to state: Resend invitation, Revoke access, Reopen review, or View submission.

“Invitation failed” provides “Send new invitation,” which rotates the guest token. The raw token is never shown or copyable. “Revoke access” always uses the confirmation contract.

### Submission Section

- Show one row per immutable submission generation, newest generation first at the recipient level.
- Each row shows recipient, version, submission number, submitted time, and comment count.
- “Inspect submission” opens the submission inspection viewer.
- Reopening never removes or labels an old submission as draft.

### Audit Summary

An exhaustive audit-log UI is not required. The detail page may show a concise chronological “Recent activity” list for the six in-scope auditable events only if the data is already part of the phase implementation. It must not delay the required recipient and submission UI.

---

## Guest Fragment-to-Cookie Entry Contract

1. The invitation opens `/review/guest#<raw-token>`.
2. The initial page renders only the guest shell and “Opening secure review…” status.
3. Client code reads the fragment once, sends it in the POST body, and immediately removes it with `history.replaceState`.
4. The raw token is never rendered, announced, copied, logged, placed in a query string, or stored in browser storage.
5. On successful exchange, navigate with `replace` to the cookie-scoped guest workspace so Back does not reveal the fragment-entry state.
6. On missing, invalid, expired, or revoked access, render the same “This review link is no longer available” terminal state. Do not disclose which check failed.
7. A later revocation while the workspace is open replaces the workspace with the same terminal state on the next data or mutation request. Unsaved comment text may be lost because access is no longer authorized.

The entry state has no token input field and no “try another token” UI.

---

## Reviewer Workspace Layout

### Shared Authenticated/Guest Workspace

Both reviewer modes use the same viewer and comment components. Only the outer shell and authorization source differ.

### Desktop (`lg` and wider)

- Sticky workspace toolbar beneath the app/guest header.
- Two-column grid: document canvas `minmax(0, 1fr)` and a 352px comment rail.
- Comment rail is sticky below the toolbar and independently scrollable only when needed.
- Document pages are centered on the paper canvas with 24px vertical gaps.
- The selected comment and selected pin remain synchronized.

### Tablet and Mobile (below `lg`)

- One-column viewer.
- Toolbar wraps into document controls and review actions without horizontal clipping.
- “Comments ({count})” opens a full-height modal panel using the existing labelled modal/focus contract.
- Pin placement opens the comment composer in that panel after the position is confirmed.
- Closing the panel returns focus to the originating pin or “Comments” button.
- Default view is Fit width. Horizontal document scrolling appears only when the reviewer explicitly zooms beyond Fit width.

### Workspace Toolbar

Required controls:

- Document title and `Version {N}`.
- Page position, for example `Page 3 of 12`.
- Zoom out, zoom value, zoom in, and Fit width.
- Comments count.
- Review state.
- “Submit review” when editable and at least one saved comment exists.

Zoom controls use text or text plus icons and have explicit accessible names. Disable zoom out/in at the supported range and communicate the disabled state natively. The initial zoom is Fit width; supported explicit steps are 75%, 100%, 125%, and 150%.

---

## Inert Page Viewer Contract

### Page Structure

Each page is a semantic section containing:

- A programmatic heading: “Page {N} of {total}.”
- A fixed aspect-ratio wrapper derived from the artifact manifest, reserving space before the image loads.
- One private, server-proxied page image with `alt=""` because the extracted page text supplies the text equivalent.
- Extracted page text associated with the page section and available to assistive technology in reading order.
- The page’s pin buttons in a positioned overlay.
- An “Add comment on this page” button outside the image hit area.

If a page has no extracted text, expose “No text could be extracted from this page” to assistive technology and show an admin/reviewer warning. OCR is not part of Phase 19; the UI must not imply that a scanned page is fully screen-reader accessible.

### Loading and Failure

- Lazy-load offscreen page images while preserving manifest aspect ratio.
- A loading page has a muted skeleton and hidden duplicate animation under reduced-motion preferences.
- A failed page shows “Page {N} could not be loaded” and a “Try again” button inside the reserved page frame.
- Failure of one page does not blank already loaded pages.
- The comment rail remains available when a page image retry is pending.

### No Active Content

- Never place uploaded HTML in the DOM.
- Never use an iframe, object/embed element, browser PDF renderer, Office viewer, or document-originated script/style.
- The visual page is an image produced by the trusted normalization result; document text is plain text.
- Original files are never opened inline from this viewer.

---

## Pin Placement Contract

### Pin Representation

- Persist `page_number`, `x_ratio`, and `y_ratio` in `[0,1]`; never persist viewport or image pixels.
- Render a native button at percentage `left` and `top` relative to the immutable page wrapper.
- The 28px visible circle is centered on the stored coordinate and sits inside a 44px target.
- Inactive pin: midnight circle with paper number.
- Active pin: ember circle plus a non-color indicator such as a 2px outer ring.
- Accessible name: `Comment {number} on page {page}: {first meaningful comment text}`.
- Associate the pin and comment card with stable IDs and `aria-describedby` or equivalent.

Pin numbering is stable within a submission/draft display and follows document order, not creation order alone.

### Pointer Placement

1. Reviewer activates “Add comment on this page.”
2. The page enters placement mode and shows instruction: “Select a point on page {N}. Press Escape to cancel.”
3. A click/tap inside the actual image bounds sets a proposed normalized coordinate.
4. The proposed pin appears and the comment composer receives focus.
5. Saving creates the pin/comment. Cancelling removes the proposed pin.

The page does not accept incidental clicks as annotations when placement mode is off. Dragging is never required.

### Keyboard Placement

1. Reviewer focuses and activates “Add comment on this page.”
2. A visible crosshair button starts at the page center, or the last proposed point if returning from the composer.
3. Arrow keys move the crosshair by 1% of page width/height.
4. Shift+Arrow moves by 5%.
5. Enter confirms the point and moves focus to the comment composer.
6. Escape cancels and returns focus to “Add comment on this page.”
7. A polite live region announces coarse position changes no more frequently than needed, for example “50 percent from left, 40 percent from top.”

Do not require a keyboard user to tab through a grid of every possible position.

---

## Comment Drafting Contract

### Composer

- Heading: `Comment on page {N}`.
- Visible location summary and “Change pin location” action.
- Labelled textarea, 16px text, current character count, and server-owned maximum.
- “Save comment” primary action and “Cancel” secondary action.
- Preserve entered text after a recoverable save error.
- Saving state uses “Saving…” and disables duplicate submission.
- On success, announce “Comment saved,” close the composer on mobile, and focus the saved pin.

### Existing Draft Comment

- Selecting a pin selects and scrolls its comment card into view.
- Comment card shows pin/page label, full text, updated timestamp, “Edit,” and “Delete.”
- “Edit” focuses the textarea containing the current text.
- “Delete” uses the destructive confirmation and returns focus to the nearest surviving pin, or the page’s add-comment button if no pins remain.
- Only the current reviewer’s editable draft comments expose edit/delete controls.

### Empty Comment Rail

Use the exact empty heading/body copy. Keep “Add comment on this page” near each page; do not put a single ambiguous add button only in the empty rail.

### Save Conflict or Lock

If the review became submitted, revoked, or otherwise locked during an edit:

- Do not overwrite the server state.
- Replace the editor with the correct locked/unavailable state.
- For submission lock, retain the attempted text in a visible read-only recovery box until the user leaves the page, with copy “This review was submitted before this change could be saved.”
- For revocation, show only the terminal unavailable state; do not retain protected document/comment content.

---

## Zoom, Resize, and Position Stability

- Scale page wrappers by changing their rendered width; do not use CSS transforms for document zoom.
- Pin placement and rendering always calculate from the displayed page content box, excluding borders, shadows, page labels, and scroll offsets.
- Re-render pin positions from normalized ratios after viewport resize, orientation change, browser zoom, comment-rail open/close, and explicit viewer zoom.
- Preserve the active page and approximate center point when changing zoom so the reviewer does not jump to a different page.
- Opening the desktop comment rail or mobile comment panel must not change stored coordinates.
- At Fit width, the page never exceeds the viewer column.
- At explicit zoom above the available width, scroll the document canvas, not the entire application page.
- A pin at each page corner must remain attached to that corner at every supported viewport and zoom step.

---

## Submission and Locked-State Contract

### Before Submission

- “Submit review” is disabled with explanatory text when there are no saved comments.
- Unsaved composer text blocks submission. Move focus to the composer and say “Save or cancel your comment before submitting.”
- The confirmation dialog includes the exact saved comment count.
- Escape/cancel returns focus to “Submit review.”

### Submitting

- Confirm button becomes “Submitting…” and prevents duplicate submission.
- Announce completion or failure.
- A failure keeps the review editable and says “Your review was not submitted. Your comments are still saved. Try again.”

### Submitted

- Replace placement/edit/delete controls with a persistent success banner using the locked copy.
- Show submitted timestamp and comment count.
- Pins and comments remain selectable and linked.
- “Submit review” is removed, not merely disabled.
- The reviewer cannot see other recipients’ comments or submissions.

### Reopened

- Show a warning banner: “This review was reopened. You can edit comments and submit a new review.”
- Prior submission generations are not shown to the reviewer unless product requirements later call for reviewer history; the current draft is authoritative for editing.
- The next submit action creates a new immutable submission generation.

---

## Admin Submission Inspection Contract

### Layout

Use the same inert page viewer. Replace the reviewer composer with a locked comment rail and admin metadata header.

Header contains:

- Review title and version.
- Recipient name/email and reviewer type.
- `Submission {N}`.
- Submitted timestamp and comment count.
- “Download original” attachment action.
- “Reopen review” when allowed.

### Comment Order

Comments are ordered by:

1. Page number ascending.
2. Vertical normalized coordinate ascending.
3. Horizontal normalized coordinate ascending.
4. Creation time ascending as a deterministic tie-breaker.

Display `Page {N} · Pin {number}` on every comment.

### Bidirectional Jump and Focus

- “Go to pin” on a comment scrolls the page into view, centers the pin where practical, focuses the pin button, and marks both pin and card active.
- Activating a pin scrolls its comment card into view and moves focus to the card heading or its “Back to pin” control.
- “Back to comment” and “Back to pin” controls are text-labelled; focus never disappears into the document canvas.
- A programmatic jump uses immediate or reduced motion when `prefers-reduced-motion` is set.
- Changing active comments does not reorder the list.

---

## State Matrix

| Surface | State | Required presentation | Available actions |
|---------|-------|-----------------------|-------------------|
| Review list | Loading | Branded skeleton rows with status label | None |
| Review list | Empty | Role-specific empty card | Create review for admin |
| Review list | Error | Recoverable error card | Try again |
| Create/upload | Idle | Complete labelled form and provisional limits | Create and invite |
| Create/upload | Invalid | Field-level errors plus summary focused on submit | Correct fields |
| Create/upload | Preparing | Honest indeterminate status | None; prevent duplicate |
| Create/upload | Failed | Safe actionable message; other form values retained | Choose file / Try again |
| Admin detail | Invitation failed | Warning badge and safe failure copy | Send new invitation |
| Guest entry | Validating | “Opening secure review…” status | None |
| Guest entry | Missing/invalid/expired/revoked | Generic terminal unavailable card | None |
| Viewer | Page loading | Aspect-ratio skeleton | Continue on loaded pages |
| Viewer | Page failed | In-frame error | Try again |
| Editable review | No comments | Empty comment rail | Add comment on a page |
| Editable review | Unsaved composer | Composer with dirty state | Save or Cancel |
| Editable review | Saving failed | Inline error; text retained | Try again |
| Submission | Pending | Confirm disabled; “Submitting…” | None |
| Submission | Failed | Error; saved comments remain editable | Try again |
| Submission | Complete | Locked success banner and read-only comments | Select pins/comments |
| Reopened review | Editable again | Reopened warning banner | Edit, add, delete, submit |
| Admin inspection | No comments in snapshot | “This submission contains no comments” | Return to detail |

Do not use a success toast as the only record of upload, invitation, revoke, save, submit, or reopen state.

---

## Responsive Rules

### Small: below 640px

- Preserve the existing dashboard shell’s 24px content padding.
- Headers and action groups stack; primary action becomes full width when needed.
- Review/admin tables remain in the existing horizontal scroll container with a visible action column; do not clip actions.
- Reviewer toolbar wraps to two rows.
- Viewer is Fit width by default.
- Comment rail becomes a full-height modal panel.
- All pin, zoom, close, submit, and comment actions are at least 44px high/wide.
- Confirmation dialogs use 16px padding and fit within the viewport without horizontal scroll.

### Medium: 640px through 1023px

- Keep one viewer column.
- Forms may use two columns only for short paired fields; title, file, email, errors, and actions span the full width.
- Comment panel remains modal to avoid compressing the page image.
- Admin table horizontal scrolling remains acceptable.

### Large: 1024px and wider

- Existing sidebar is visible.
- Reviewer workspace uses document plus 352px comment rail.
- Admin inspection uses the same two-column structure.
- Admin detail remains a readable stacked page; do not turn it into a dense three-column control center.

### Reflow Acceptance

- At 320 CSS px and 400% zoom, all controls and copy remain reachable without two-dimensional page scrolling.
- The document canvas may scroll horizontally only after the user explicitly chooses a zoom wider than Fit width.
- No sticky toolbar, modal, or comment panel may cover the focused control.

---

## Accessibility Contract — WCAG 2.2 AA

### Semantics and Structure

- One H1 per screen; heading levels do not skip.
- Use `main`, `nav`, `header`, `section`, `table`, form labels, and native buttons before ARIA.
- Every viewer page has a unique heading and extracted-text relationship.
- Every pin and comment card has a stable accessible relationship and a unique name.
- Table header associations remain intact; action buttons name the affected review/recipient where repeated.

### Keyboard

- Every workflow is completable without a pointer: create, upload, invite, revoke, open, place pin, draft, edit, delete, submit, inspect, jump, and reopen.
- Tab order follows visible order.
- Pin placement supports Arrow, Shift+Arrow, Enter, and Escape exactly as specified.
- No drag gesture is required.
- Modal focus is placed, contained, and returned.
- Sticky regions never trap focus.

### Focus

- Preserve the existing ember focus ring and at least 3px visible ring treatment.
- Focus is never indicated by color change alone.
- Jumping between comment and pin moves actual programmatic focus, not only scroll position.
- After route navigation caused by a successful create/exchange, focus moves to the destination H1.
- Destructive cancellation returns focus to the triggering control.

### Target Size and Pointer

- All review controls satisfy a 44px by 44px minimum target.
- Adjacent pin hit areas must not overlap in a way that makes one pin unreachable; when pins are extremely close, keyboard list navigation remains an equivalent path.
- Page placement is active only after an explicit add-comment action.

### Contrast and Color

- Normal text meets 4.5:1; large text and non-text UI meet 3:1.
- Use the accepted `--muted-foreground: #707070`, not the superseded lower-contrast mist value.
- Status, selection, errors, warnings, and success include text or shape in addition to color.
- Uploaded page images do not determine the contrast of overlaid pins; pins retain a contrasting outline against light and dark page content.

### Forms and Errors

- Labels remain visible; placeholders are examples only.
- Required state is conveyed in text and markup.
- Errors identify the field and corrective action.
- On failed submit, focus the error summary, then provide links or programmatic movement to invalid fields.
- Pending controls communicate `disabled`/`aria-disabled` correctly and expose status in a live region.

### Live Regions

- Use polite announcements for upload processing, save success, page position, zoom value, invitation state, and submission success.
- Use assertive alerts only when an action fails or access becomes unavailable.
- Do not announce every pixel/percentage change while an arrow key is held; throttle coarse position updates.

### Motion

- Respect `prefers-reduced-motion`.
- Disable pulsing skeleton animation and smooth-scroll jumps for reduced motion.
- No essential meaning depends on animation.

### Uploaded Document Accessibility Boundary

- Extracted page text is the accessible equivalent for normalized page images.
- Image-only/scanned pages with no extracted text are explicitly identified; Phase 19 does not include OCR.
- The PSG Hub workflow and controls must meet WCAG 2.2 AA even when the uploaded source document itself is not accessible.

### Automated and Manual Acceptance

- Axe reports zero serious or critical violations on admin list, create, admin detail, auth reviewer, guest reviewer, submitted, and unavailable states.
- Playwright keyboard-only flows cover pointer-free pin placement, edit/delete, submit confirmation, comment-to-pin jump, pin-to-comment jump, modal focus return, and guest entry.
- Test at 375px and 1280px, 200% browser zoom, and one resize while a pin is selected.
- Verify all four page-corner pins at Fit width, 75%, 100%, 125%, and 150%.

---

## Component Inventory and Ownership

| Component | Contract | Reuse/source |
|-----------|----------|--------------|
| Module page header | H1, description, actions, wrap on narrow screens | Existing dashboard page pattern |
| Review status badge | Text plus inherited semantic variant | Existing `Badge` |
| Review/version/recipient lists | Semantic table and horizontal overflow | Existing `Table` |
| Form fields | Visible label, helper, inline error | Existing `Input`, `Label`, native controls |
| Actions | Existing variants; midnight primary, outline secondary, tinted destructive | Existing `Button` |
| Cards/empty/error states | 6px radius, border, paper/white, existing padding rhythm | Existing `Card` |
| Confirmation/composer modal | Labelled modal, focus trap, Escape policy, focus return | Existing dashboard modal pattern |
| Page viewer | Aspect-ratio image section plus plain extracted text | New phase component; no editor library |
| Pin button | Native positioned button with normalized coordinates | New phase component |
| Comment rail/card | Ordered semantic list with focus/jump controls | New phase component composed from existing primitives |
| Guest shell | Existing logo and paper background; no dashboard nav | Existing auth/notice visual pattern |
| Loading | Reserved-dimension skeleton and status label | Existing analytics loading pattern |
| Error | Branded recoverable card | Existing analytics error pattern |

Keep page viewer, pin, comment composer/list, and toolbar boundaries small enough to test separately. Do not create a generic annotation framework.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | Existing `badge`, `button`, `card`, `input`, `label`, `table` only | Existing installed source inspected; no new registry fetch required |
| Third-party | None | `components.json` has `registries: {}`; verified 2026-07-28 |

No third-party block may be added without a separate `shadcn view` source review and an updated UI contract.

---

## Explicit Non-Goals

Phase 19 UI does not include:

- Inline editing of HTML, DOCX, or PDF content.
- Rich-text editing inside the document.
- Text-selection highlighting or range comments.
- Freehand drawing, rectangles, arrows, shapes, stamps, signatures, or an annotation toolbar.
- Drag-required pin placement.
- Browser rendering of uploaded HTML, DOCX, or PDF.
- Realtime cursors, presence, coauthoring, chat, or live comment updates.
- Public anonymous links or reusable shared links.
- Reviewer enumeration of reviews, storage objects, recipients, or other reviewers’ comments.
- Automatic anchor migration, visual diffing, or pin copying between versions.
- Multi-document review packages.
- OCR for scanned/image-only pages.
- Reminder-email scheduling or a new notification center.
- Deleting or replacing immutable versions or submitted snapshots.
- A separate Secure Document Review brand, navigation shell, token set, or component registry.

---

## Wave 0 UI Proof Gates

Before implementation treats the provisional copy as final, Wave 0 must provide:

1. Representative PDF, DOCX, and self-contained HTML results confirming the page-image viewer is readable.
2. Proven upload and page ceilings; update the helper/error/confirmation copy if 4 MiB or 100 pages changes.
3. Proven guest expiry policy; update invitation and resend copy if 7 days changes.
4. At least one page with extracted text and one image-only page to verify the accessibility boundary.
5. A geometry fixture proving normalized pins remain aligned at all declared widths and zoom steps.

These gates may change values and warnings. They must not expand the phase into document editing, OCR, public sharing, or general annotation tools.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS
- [ ] Keyboard pin placement and focus/jump contract: PASS
- [ ] Responsive reviewer workspace: PASS
- [ ] Authenticated and guest states: PASS

**Approval:** pending

## UI-SPEC COMPLETE
