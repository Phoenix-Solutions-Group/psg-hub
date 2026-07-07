# ADR — PSG-776: Web-surface delivery / assembly step

**Status:** Accepted (Ada, CTO) — 2026-07-07
**Context tickets:** PSG-776 (this), PSG-773 (C2 gate wiring), PSG-765 (C2 switch-on = Option A), PSG-746/PSG-752 (content-quality standard + encode), PSG-208 (Phase-0 go-live: content-system-of-record only)

## Problem

A finished shop page is written and saved to `content_items` (status `published`) as the
system-of-record. There is **no step that turns that record into a live web page** — a real
URL a shop's customers can open, with a working tap-to-call button and a "get a free estimate"
action. Until that step exists, the automatic "Call + Estimate" quality rule (C2) has nowhere
to switch on.

## Decision

**Delivery target: server-rendered Next.js pages served from the existing `psg-hub` app on the
current Vercel production pipeline.** Not an external CMS push.

Rationale (evidence over opinion):
- It is already proven end-to-end. The Tedesco launch serves a live page + working estimate
  form on `hub.psgweb.me` through this exact app + Vercel + SendGrid lead delivery.
- Reuses the whole existing spine: Supabase + RLS for tenancy, the publish gate, the lead
  endpoint pattern, and automatic redeploy on merge to `main`.
- An external CMS push adds a second system, sync lag, and a second place for a page to drift
  out of honesty compliance — with no upside at our scale.

## Architecture (three seams, one contract)

The contract lives in `apps/psg-hub/src/lib/web-surface/` (pure, node-testable, no I/O):

1. **Assembler** — `assembleServicePage({ item, shop, facts }) → WebSurfaceArtifact`
   (PSG-776, Ravi). Renders a published `service_page` into the live artifact. MUST:
   place a real `tel:` action in the hero (first screen), include an estimate action wired to
   a live per-shop lead endpoint, repeat the primary CTA (`primaryCtaOccurrences >= 2`), and
   surface only facts present in the verified-facts record. Derived from the Tedesco staged
   reference (`apps/psg-hub/staging/tedesco-home/index.html`).

2. **Public route + lead endpoint** — `app/(site)/s/[shopSlug]/[pageSlug]` server component
   + generalized `/api/leads/[shopSlug]` (PSG-776, Nora). Loads the **published** row for
   shop+slug (404 otherwise), calls the assembler, serves it. The estimate form POSTs to the
   per-shop lead endpoint (generalizing the hard-coded `tedesco-estimate` route + inbox env).

3. **C2 gate** — `checkConversionStructure(conversion) → Violation[]` (PSG-773). Runs inside
   the assembly step for `service_page` only; a non-empty result REJECTS before serving, so no
   live page ships missing a phone button. A correct reference implementation is seeded in
   `web-surface/index.ts`; PSG-773 wires it into the pipeline and expands adversarial coverage.

`WebSurfaceArtifact.conversion` is the machine-checkable proof of the Call+Estimate structure,
so the gate never has to re-parse final HTML.

## Consequences

- One place produces every live page ⇒ one place enforces C2 and honesty.
- The hard-coded Tedesco endpoint/inbox is superseded by the per-shop generalization (kept
  live until the generalized path is QA-passed, then cut over — no regression to the shipped
  Tedesco page).
- Release discipline unchanged: nothing merges to `main` without Tess's QA pass; a major
  milestone is promoted to Vercel prod (`main`) and confirmed green.
