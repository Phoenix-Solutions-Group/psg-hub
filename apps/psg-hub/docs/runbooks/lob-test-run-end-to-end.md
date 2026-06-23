# Runbook: Lob production test run, end-to-end (PSG-333)

**Owner:** Nora (Software Engineer — Ops Builder)
**Issue:** PSG-333 ("LOB TEST RUN")
**Status:** Ready — runnable once the demo tenant is seeded (PSG-334 / `192135da`, Ravi)
**Date:** 2026-06-23

---

## 0. Why this exists

Nick **rejected the single-piece Lob proof** ("seed test") and asked to exercise the
*whole* production pipeline — **generate a real batch → print it** — against a **fake
business**, all the way up to production, with the **real live Lob send deferred** (that
stays behind board gate **G4**).

This runbook is the **mail/production slice** of the board demo. It is distinct from:

- **PSG-334 demo *script*** (`docs/demos/bsm-board-demo-script.md`, Lee) — the talk track.
  Its on-screen letters render via the **Proof** action (`/ops/production/templates`),
  which fills every field from `SAMPLE_MERGE_DATA`, so proofs always look clean.
- **`192135da` — Seed runnable BSM demo environment** (Ravi) — seeds the demo tenant
  data (shop "Riverside Collision", customers, reviews, CCC connections, logins).

What this runbook adds: the **actual batch path** (`POST /api/production/generate` →
`POST /api/production/batches/[id]/print`) that a real shop's mail goes through. That path
builds its merge data from live DB rows, **not** `SAMPLE_MERGE_DATA` — so it is the only
way to prove the really-mailed piece is correct before a customer ever receives one.

> **Hard safety:** this is a **test-mode** run. `LOB_API_KEY` **must** be a `test_*` key.
> The batch *print* route submits to whatever key is configured; in Lob test mode Lob
> processes the piece for free and **never physically mails it**. A live `live_*` send is
> board-gated (G4) and out of scope here. Never run the print step in an environment with a
> `live_*` key unless G4 has been approved.

---

## 1. Preconditions (verify before starting)

| # | Item | How to verify |
|---|------|---------------|
| 1 | Demo tenant seeded (Riverside Collision company + ≥1 repair customer with a **stored address**) — owned by `192135da` | `companies` + `repair_customers` rows exist; `repair_customers.address` has `line1/city/state/postal_code` |
| 2 | `thank_you` **and** `service_recovery` templates have a **released** approval at the **current** content hash | `/ops/production/templates` shows each as released; gate uses `(template_key, content_hash)` |
| 3 | `LOB_API_KEY` is a **`test_*`** key | seed-test route returns `403 LiveLobKeyError` for `live_*`; a `test_*` key is required for any real submit |
| 4 | `LOB_WEBHOOK_SECRET` set (so status events flow back) | `/api/webhooks/lob` returns `500` if the secret is unset (fail-closed) — set it |
| 5 | Operator has `manage_production` capability | `/api/production/generate` returns `403` otherwise |

If (2) fails for `service_recovery` after PSG-331 (warranty-term tokenization changed its
bytes), re-proof → approve → release the new hash before generating that template's batch.

---

## 2. Run the batch end-to-end

All calls are authenticated as a `manage_production` operator.

1. **Generate the batch** (renders one piece per customer; no vendor spend yet):

   ```
   POST /api/production/generate
   {
     "name": "DEMO Riverside thank-you (test run)",
     "company_id": "<Riverside Collision company id>",
     "product": "thank_you",
     "product_id": "<company_programs.product_id for this program>",
     "repair_customer_ids": ["<one or two demo customer ids>"]   // omit = every customer
   }
   ```

   - `201` → `{ batch, documents, vendor, missing }`.
   - **Inspect `missing`** (per-customer unresolved tokens). After PSG-333 the inside-address
     block (`customer.addressLine1/city/state/zip`) and `customer.letterDate` resolve from
     the stored row + batch date. See §3 for tokens that are *expected* to remain blank.

2. **Print the batch in Lob test mode** (submits each document to Lob):

   ```
   POST /api/production/batches/<batch id>/print
   ```

   - `200` → documents move `rendered → mailed`/etc.; each gets a Lob `external_id`
     (`ltr_*`) and a `proof_url`. Batch moves `queued → printing → historical`.
   - In **Lob's test dashboard** you can open each `proof_url` and confirm the rendered
     letter reads correctly (real merge data, not `{{tokens}}`).

3. **Confirm webhook status advance** (optional, if a webhook endpoint is wired):

   - Lob test events POST to `/api/webhooks/lob` (HMAC-verified). They upsert
     `mail_vendor_jobs` (unique `(external_id, status)` → idempotent) and advance
     `production_documents.status`.

---

## 3. Expected vs. defect — residual unresolved tokens

PSG-333 maps everything the live batch path *has data for*. These tokens are **expected to
remain blank** on a test run until their data source is wired, and are **not** a defect:

| Token | Why blank | Follow-up |
|-------|-----------|-----------|
| `customer.vehicle`, `customer.vehicleShort`, `customer.serviceDate` | Live on the **repair order**, not `repair_customers`; the generate route doesn't join the latest RO | Needs an RO join in `generate` (Ada, v1.3 production critical path `d302f80e`) |
| `customer.surveySecurityCode`, `customer.surveyId` | Per-customer ACRB survey identity not generated at batch time | Survey-integration feature (separate) |
| `company.websiteUrl` | `companies` has no website column (it lives on `clients`/`shops`) | Map from the linked shop, or add to the program skin |

If you see **`customer.addressLine1`/`city`/`state`/`zip` or `customer.letterDate`** in
`missing` for a customer that *has* a stored address, **that is a regression** — file it.

---

## 4. Teardown

The demo tenant is owned by `192135da`; follow its teardown for the seeded rows. For this
run specifically, the only artifacts created are a `production_batches` row + its
`production_documents` (and any `mail_vendor_jobs` from test webhooks). Delete the demo
batch by id if you want a clean slate:

```sql
delete from public.production_documents where batch_id = '<batch id>';
delete from public.production_batches  where id = '<batch id>';
```

(Agents have no shared-prod DB access in-sandbox — this is the operator step.)

---

## 5. Going live (later — NOT part of this run)

The real `live_*` Lob send is board-gated (**G4**). When approved: set a `live_*`
`LOB_API_KEY` in the production env, confirm released approvals at current hashes, and run
§2 against **real** repair customers (not the demo tenant). Until then, every run here is
test-mode and mails nothing.
