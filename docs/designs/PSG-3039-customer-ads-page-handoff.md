# PSG-3039 — Customer Ads page design handoff

Private design draft. Not approved for customers.

## Bottom line

The Ads page answers four owner questions in order: what did I spend, what did I get, is anything wrong, and how do I ask PSG to change something? The primary customer action is a reviewed request; it never edits Google Ads or changes spending.

Review prototype: `docs/designs/PSG-3039-customer-ads-page.html`

## Existing patterns reused

- Dashboard shell and Ads navigation.
- PSG brand metric cards, status badges, hairline-bordered cards, single-column form fields, and reviewed-report download.
- Existing data groupings: 30-day metrics, campaigns, recent requests, and published reports.
- PSG tokens: paper `#FAFAFA`, midnight `#1E3A52`, ember `#B8483E`, 6px radius, 4px spacing base, Gotham headings, Didact Gothic body, restrained borders and shadows.

## Page hierarchy and behavior

1. Page purpose and last-update time.
2. A persistent 30-day/settling notice before the numbers.
3. Five plain-language metric cards. Spend explicitly excludes PSG fees; “Times shown” says visibility is not customers.
4. Campaign list with customer-language status, purpose, leads, spend, budget, and service area. Mobile keeps name, purpose, and status first; details may expand rather than becoming a squeezed table.
5. One high-contrast request band. This is the only primary call to action on the page.
6. Request history makes “waiting for PSG” and “nothing changed yet” explicit.
7. Reviewed reports remain secondary.

## Request flow

- Step 1: choose one of the eight approved request types; show only fields needed for that type. Single-column fields and inline validation.
- Step 2: show the mandatory confirmation summary from the approved requirements. Submit remains disabled until the acknowledgement is checked.
- Success: return to the page and place the new item first with “Request received — waiting for PSG” and “Nothing changed in Google Ads.”
- Pending review: customer may withdraw while submitted or while PSG needs more information. Once PSG starts work, replace withdrawal with a discussion route.

## Required page states

The prototype's “Page-state review” control demonstrates: loading, never connected, connected/no numbers, tracking unconfirmed, customer-disconnected, Google access removed, sync error, partial data, plan required, submitted, and pending review. Engineering must replace the main content—not merely add a toast—so empty/error states never resemble zero performance.

## Design rationale

- **Inverted Pyramid + Selective Attention:** business results precede campaign mechanics and reports.
- **Hick's Law + Progressive Disclosure:** one “Request a change” action opens request types; eight competing page buttons do not.
- **Recognition over Recall + Mental Models:** labels explain what each advertising number means to a shop owner.
- **Von Restorff + clear primary CTA:** ember is reserved for the single request action and modal progress.
- **Nielsen visibility of system status + Norman feedback:** last-updated time, connection state, confirmation, and review status are always visible.
- **Error prevention + constraints:** submit stays disabled until the customer reviews the exact saved values and acknowledges PSG review.
- **Fitts's Law + mobile thumb zones:** primary actions are at least 44px and become full-width in the mobile modal.
- **WCAG POUR:** semantic headings and dialog labels, color-independent status text, visible focus treatment required, 44px targets, and no required motion.

## Engineering acceptance criteria

- Build with existing Card, Badge, Button, form, dialog, skeleton, and dashboard-shell components before adding a new component.
- Desktop target: 1440×900. Mobile target: 390×844. Content-driven breakpoint around 720px; campaign rows must not horizontally scroll.
- All focus rings remain visible; keyboard focus is trapped/restored for the dialog; Escape closes before submission.
- Field errors appear inline and identify a remedy. Preserve entered values after an error.
- Summary values and stored request values come from the same state object.
- No request call invokes a Google Ads mutation. Customer-facing status is “Waiting for PSG review,” never a raw database value.
- Never expose raw Google error text, other-shop account identifiers, search terms, or consumer personal information.
- Loading feedback begins within about 100ms; use skeletons that match final card geometry. Respect reduced motion.
- PSG-authored campaign purpose, service area, and lead definition require a durable source; if absent, show a deliberate “PSG is preparing this detail” state, not invented copy.

## Deliberate system change

Add one reusable `ReviewedRequestFlow` pattern for any customer request that could affect spend or a live channel: structured details → exact confirmation summary → acknowledgement → staff-review status. This should later serve Ads, website edits, and other governed marketing changes.

## Settled product decisions incorporated

Section 8 of the approved requirements is now binding. The prototype and this handoff incorporate all ten decisions:

- Show one PSG-designated primary account; non-primary spend raises an internal account-manager flag and must never be silently omitted.
- Remove account linking and disconnection from the customer page; those controls move to PSG-only Settings.
- Route increases over 25% or $500 per month, whichever threshold is crossed first, to two named approvers. Every smaller increase still records one named approver.
- Route decreases above zero through one-approver, same-business-day handling. Treat a decrease to zero as a stop and hand it to the account manager.
- Publish exactly: “We'll confirm we've got your request within one business day, and give you an answer within two.” Also state that the clock counts business days only.
- Lead campaign budgets with the approximate monthly figure; show daily as supporting detail with Google's variable-daily-spend explanation.
- Keep every paid-for campaign visible. When its approved purpose is missing, show “Description coming — ask your account manager.”
- When the shop has no approved lead definition, show “not set up yet” for leads and cost per lead everywhere; never show an undefendable number.
- Print the real 30-day date range in words and visibly identify the most recent three days as still filling in.
- Keep a visible “Talk to us about a new campaign” path to the account manager.

Design rationale: **Nielsen visibility of system status** supports explicit dates and honest unavailable-data states; **Mental Models** supports monthly-first budgeting; **Recognition over Recall** supports plain campaign purposes and fallbacks; **Hick's Law** keeps “Request a change” as the dominant page action while the new-campaign conversation remains visible but secondary.

## Residual risk

The live-mutation security defect and cross-client account number found in PSG-3043 must be fixed and independently verified before Nick or any customer reviews this experience.
