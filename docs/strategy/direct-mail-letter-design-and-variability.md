# BSM Direct Mail — Letter Design & Variability Strategy

**Owner:** Ada (Chief Developer) · **Issue:** PSG-115 · **Date:** 2026-06-23
**Status:** For board review (Steve)

## Purpose of this document

Steve asked a direct question: *"How are we designing the letters that go through Lob,
and how are we creating variability? I need to see a much more thorough strategy and
plan for the direct-mail component."*

This document answers all three: (1) how a letter is **designed and built**, (2) how we
generate **variability** so mailings never feel like form letters, and (3) the concrete
**execution plan** — phases, owners, and the build tickets already in flight.

The governing principle: **we are not inventing a direct-mail program. PSG already has
one.** The 20-year Master Follow-Up Program and ~30 years of FileMaker send history are
the real asset. BSM's job is to **digitize, automate, and upgrade** that program onto a
modern, metered, auditable pipeline (Lob), not to reinvent it from a blank page.

---

## 1. How we design the letters

### 1.1 Source of truth: the Master Follow-Up Program

The legacy program (`docs/psg/master-follow-up-program`, plus the triggered-letter tree
under `acrb/`, `advocate-program/`, `holiday-*`, and the numbered FileMaker letter
library) is already a mature, results-tested system. Its sample collateral documents the
design intent we are inheriting:

- A tiered **letter sequence** — from the 3-letter Referral Set up to the 5-letter Master
  Follow-Up Program — where each letter can also stand alone.
- **152 mailing options**, each tied to repair conditions (e.g. trigger only when the
  repair total exceeds $750 or $1,000; survey-only; thank-you-only; warranty-only; CRM
  with no survey).
- A library of **triggered letters** keyed off survey outcomes and life events:
  Recommend-an-Agent, Agent Customer Acknowledgement, Call-Your-Agent, Perfect-Score
  thank-you, Totaled-Vehicle empathy, Estimate Follow-Up, birthday and seasonal greetings.
- An explicit variability requirement, stated verbatim in the legacy material:
  *"varied text and appearance for repeat customers to ensure mailings are perceived as
  fresh and appropriate."* Freshness was a design goal 20 years ago — it stays a design
  goal now.

We treat this corpus as the canonical content brief. Every BSM template traces back to a
specific legacy letter so we preserve what already works (empathy framing, agent-community
engagement, EMI experience-management voice) while upgrading production.

### 1.2 Template architecture (how a letter is actually built)

Each letter is a **structured template**, not a one-off document. A template has:

1. **Layout** — a print-ready HTML/PDF artifact sized for Lob (US Letter or postcard),
   with PSG/shop branding, bleed and safe margins per Lob's spec. Authored once per
   letter family by the designer (Lee) in the BSM design system (PSG-219).
2. **Merge slots** — typed fields (`{{shop.name}}`, `{{customer.first_name}}`,
   `{{vehicle.year_make_model}}`, `{{repair.total}}`, `{{agent.name}}`, `{{cta.url}}`)
   resolved at send time from the import data model (the same canonical-38 schema the
   RO-import pipeline already produces).
3. **Copy blocks** — the body text, owned by copy/segment rules (PSG-220). Copy blocks are
   the unit of variability (see §2).
4. **Trigger rule** — the condition that selects this letter for a given customer
   (survey score, repair dollar threshold, days-since-repair, totaled flag, etc.). Owned by
   the EMI trigger/suppression engine (PSG-218).
5. **Metadata** — letter family, sequence position, version, A/B variant id, and the
   suppression class (so we never double-mail or mail an opted-out / undeliverable record).

A letter "design" is therefore the tuple **(layout × copy blocks × merge data × trigger ×
variant)** — and that product is exactly what produces variability without hand-authoring
thousands of documents.

### 1.3 Rendering & production pipeline

```
Import (RO data, canonical-38)        Master Follow-Up content (digitized)
            │                                       │
            ▼                                       ▼
   EMI Trigger + Suppression  ──────────────►  Template + Variant selection
            │  (PSG-218)                            │  (PSG-219/220)
            ▼                                       ▼
              Merge engine (slots → HTML/PDF, deterministic)
                              │
                              ▼
                 Proof gate (operator preview)  ── PSG-217
                              │ approved
                              ▼
              Lob API  →  mail_vendor_jobs  →  audit log
                              │
                              ▼
              Delivery + return/NCOA feedback → suppression updates
```

This reuses infrastructure that already exists or is funded: the v1.3 mail module
(`mail_vendor_jobs`, RLS on, applied in prod), the import/standardize stack, and the
metered/audited execution pattern we built for the ads-mutation pipeline (dry-run → proof
gate → approval → audited execute). Direct mail gets the **same governance spine**: nothing
goes to Lob without an operator proof and an append-only audit row.

---

## 2. How we create variability

Variability is engineered along **five independent axes**. Because they combine
multiplicatively, a handful of authored assets yields a very large space of distinct,
on-brand pieces — and, critically, the *same* recipient never sees the same letter twice.

| # | Axis | Source | What it varies |
|---|------|--------|----------------|
| 1 | **Trigger / letter family** | survey outcome, repair $, totaled flag, days-since, life event | *Which* letter is sent (Perfect-Score vs Recommend-Agent vs Totaled-Vehicle vs Estimate Follow-Up vs seasonal) |
| 2 | **Merge data** | canonical-38 RO record | Name, vehicle, repair detail, agent, shop, dynamic CTA/QR per shop |
| 3 | **Copy-block rotation** | copy/segment rules (PSG-220) | Interchangeable headline / body / closing variants per letter, so repeat customers get *"varied text and appearance"* — the legacy freshness rule, now automated |
| 4 | **Segment voice** | EMI segment (new vs repeat vs referral vs fleet vs lapsed) | Tone and offer keyed to relationship stage; EMI (experience-management) framing over plain CSI |
| 5 | **A/B / experiment variant** | experiment registry (PSG-217 proof-gate + tracking) | Controlled variants measured against the 30-yr send-history baseline; winners promoted, losers retired |

**Anti-repetition guarantee.** Axis 3 + axis 5 are governed by a per-recipient send-history
check (axis 0, the suppression engine): when we select a copy variant we exclude any variant
that recipient already received, and we honor sequence position so a customer progresses
through the program rather than looping. The 30-year FileMaker history seeds this — it is
both our **suppression list** and our **empirical A/B prior** (we start variants from what
already converted, not from zero).

**Determinism.** Variant selection is seeded (recipient id + campaign id), so a given run is
reproducible and auditable — the proof an operator approves is exactly what Lob prints.

---

## 3. Execution plan

PSG-115 is the umbrella. Work is decomposed into build tickets (all **build-only**; nothing
mails until the G4 spend approval and a live Lob key — that gate is unchanged):

### Phase W0 — Foundation (in flight)
- **PSG-216 (Ada)** — Import the FileMaker letter library + 30-yr send history into the
  canonical model. Produces the content corpus, the suppression seed, and the A/B priors.
- **PSG-217 (Ravi)** — Proof gate: operator preview + approval before any Lob submit;
  experiment/variant registry; audit row per send. The governance spine.

### Phase W1 — Engine (in flight)
- **PSG-218 (Nora)** — EMI trigger + suppression engine: trigger rules (survey/$/totaled/
  days), per-recipient anti-repeat, NCOA/return + opt-out suppression.
- **PSG-219 (Lee)** — Design system + print-ready letter/postcard templates (layout +
  merge slots), Lob-spec correct.
- **PSG-220 (Lee)** — Copy blocks + segment rules: the rotating variants that drive
  axis-3 and axis-4 variability.

### Phase W2 — Triggered-letter matrix (next, after W0/W1 land)
Wire the full triggered-letter tree (Perfect-Score, Recommend-Agent, Call-Your-Agent,
Totaled-Vehicle, Estimate Follow-Up, birthday/seasonal) onto the engine, each with its
trigger rule, template, and ≥2 copy variants. End-to-end **dry-run** through the proof gate
against real (de-identified) import data — zero live spend.

### Phase W3 — Specials, A/B, advocacy
Community-expansion postcard promotions, the Advocate program, holiday cards, and the
A/B framework measuring lift against the 30-yr baseline. Winners auto-promote.

### Go-live gate (unchanged, board-owned)
Live mailing requires: (a) G4 direct-mail spend approval, (b) a production Lob key wired the
same dual-key way we handled Supabase rotation, and (c) one green proof-gated dry-run signed
off by QA (Tess). Until all three, the pipeline runs in dry-run/proof mode only.

---

## 4. What I need from the board

This document answers "how are we designing letters and creating variability." Two
decisions are yours, not engineering's:

1. **Approve this strategy** as the direction for the direct-mail component (or redirect).
2. **Confirm the go-live gate** above is the right sequence — specifically that live mail
   waits on G4 spend approval rather than shipping ahead of it.

On approval I keep W0/W1 driving and stand up W2 as soon as the foundation lands. No live
mail, no spend, until the gate clears.
