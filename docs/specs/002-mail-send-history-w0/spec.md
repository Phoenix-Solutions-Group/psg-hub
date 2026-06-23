---
title: "BSM Direct-Mail W0 Foundation — Send-History, Suppression, Priors & Letter Library"
status: draft
version: "1.0"
issue: "PSG-216 (parent PSG-115, Wave W0)"
owner: "Ada (Chief Developer)"
---

# W0 Foundation: import + mine the 30-year FileMaker send history

This spec is the architecture for PSG-216. It turns PSG's legacy direct-mail
operation into the empirical engine the BSM program runs on. It is **foundational
but parallel to W1** — it does not block W1, and it touches **no live-mail spend**
(G4 unaffected). It rides the existing FileMaker import porting
(PSG-129 / PSG-132 / PSG-133 / PSG-51) rather than re-inventing decoders/mappers.

## 1. Objective

Produce four first-class, queryable artifacts the direct-mail engine can call:

1. **Send-history table** — who was mailed which numbered piece, when, by which shop.
2. **Suppression / dedup list** — never re-mail the same piece; honor historical
   opt-outs; household-level dedup. Callable by the engine.
3. **Trigger priors + A/B priors** — evidence mined from send-history × outcomes
   (survey / referral / repeat / RO), segmented.
4. **Numbered-letter-library catalog** — the real template set (`t`, `04`, `04b`,
   `07`, `10`, `10b`, `12`, `13`, `14`, `15`, `16`, + `b`) PSG-115a productizes.

## 2. Source inventory (what is actually in the repo today)

Grounded by an audit of `docs/` on `main` (2026-06-23):

| Need | Source present? | Location |
|------|-----------------|----------|
| Repair/customer outcomes (repeat, referral, RO $, dates) | ✅ 2018–2022 | `docs/psg/filemaker/exports/repair-customer-export-*.md` (cols `RC_*`) |
| Survey outcomes (CSI/EMI, scores) | ✅ 2018–2022 | `docs/psg/filemaker/exports/survey-export-*.md`, `2022/` |
| Numbered-letter templates (the pieces) | ✅ one batch | `docs/psg/production-center/production-files-sample/2021-09-07/` (25 files: letter/envelope/warranty/survey per piece) |
| Program definition (which piece, which trigger) | ✅ | `docs/psg/master-follow-up-program/`, ACRB, triggered-letter tree |
| Per-recipient **send log** (recipient × piece × date) | ❌ **MISSING** | only the single 2021-09-07 production batch is present |

**Critical gap (first-class blocker):** the raw 30-year per-recipient send log —
the rows that say "customer X was mailed piece `07` on date D" — is **not in the
repo**. Only one production batch (2021-09-07) and the program definition exist.
The outcome side is present; the send side is not. Deliverables #1 (import +
reconcile counts) and #3 (mining) cannot be completed without it. Resolved via the
same operator read-bridge used for PSG-129/132/133: Steve provides the FileMaker
send-history export (or confirms the production-center dated batches **are** the
send record and supplies the full set). Tracked on PSG-216 → blocks PSG-216a/PSG-216d.

Deliverables #2 (suppression artifact) and #4 (letter catalog) and **all schema**
are buildable now and are not blocked by the gap.

## 3. Data model (additive, forward-only, RLS-on — follows `survey_dispatches` convention)

Three new tables under `apps/psg-hub/supabase/migrations/`. All carry `company_id`,
RLS, and a deterministic idempotency key for upsert-safe re-import (the
`dispatch_ref` pattern proven in `survey_dispatches`).

### 3.1 `mail_send_history`
One row per (recipient, piece, send-date). The empirical spine.

```
id              uuid pk default gen_random_uuid()
company_id      uuid references companies(id)
shop_name       text not null
repair_order_id uuid references repair_orders(id) on delete set null   -- linked when matchable
ro_number       text
piece_code      text not null      -- 't','04','04b','07','10','10b','12'..'16','b'
piece_variant   text               -- 'letter'|'envelope'|'warranty'|'survey'  (nullable)
sent_date       date not null
recipient_hash  text not null      -- salted hash of normalized name+address (PII-min; household key derived from this)
household_key   text not null      -- normalized address-based dedup key
batch_ref       text               -- production-center batch id when known
send_ref        text not null      -- idempotency: '<shop>:<recipient_hash>:<piece_code>:<sent_date>'
source          text not null default 'filemaker'
created_at/updated_at timestamptz
unique (send_ref)
```
PII handling: raw name/address are **not** stored here; only salted
`recipient_hash` + `household_key`, per the PSG-129/132/133 import controls. Raw
PII stays in the import staging path and is dropped after match, exactly as the
RO importer does.

### 3.2 `mail_suppression`
First-class, queryable do-not-mail / dedup artifact. The engine calls this before
any send.

```
id             uuid pk
company_id     uuid
scope          text not null check (scope in ('household','recipient','piece'))
household_key  text
recipient_hash text
piece_code     text                 -- when scope='piece' (never re-mail this piece to this household)
reason         text not null check (reason in ('opt_out','already_mailed','bad_address','deceased','manual'))
effective_from date not null
source         text not null
suppression_ref text not null       -- idempotency key
unique (suppression_ref)
```
Query interface (engine-facing): `isSuppressed({ householdKey, recipientHash,
pieceCode, asOf })` → boolean + reason. Built in `src/lib/ops/mail/suppression.ts`.
Seeded from (a) opt-outs/bad-address flags in the exports and (b) derived
"already-mailed (piece,household)" rows from `mail_send_history`.

### 3.3 `mail_send_priors`
Documented output location for mined priors (read-mostly; regenerated by the miner).

```
id           uuid pk
segment_key  text not null     -- e.g. 'paytype=Ins|repeat=Y|region=LA'
piece_code   text not null
trigger      text              -- the program trigger this prior informs
n_sent       int not null
n_outcome    int not null      -- positive outcomes (survey返/referral/repeat/RO)
outcome_rate numeric           -- n_outcome / n_sent
ab_variant   text              -- when the prior is an A/B comparison arm
computed_at  timestamptz
method_ref   text              -- pointer to the miner run / doc that produced it
unique (segment_key, piece_code, coalesce(ab_variant,''))
```
Priors are also written to a **documented doc location**
`docs/ops/mail/priors/` (human-readable summary) so the artifact is reviewable
outside the DB, per acceptance.

## 4. Numbered-letter-library catalog (#4)

A committed catalog at `docs/ops/mail/letter-library.md` (machine-readable
companion `letter-library.json`) cataloging each piece from the real
production-center batch + Master Follow-Up Program:

- `piece_code`, human name, the **trigger** it serves (e.g. `t` = total-loss
  thank-you; `07` = survey follow-up w/ warranty; `04`/`04b` = warranty letters;
  `12`–`16` = follow-up sequence; `b` = birthday/seasonal), available variants
  (letter/envelope/warranty/survey), and a pointer to the sample source file.
- Cross-referenced to PSG-115a (which productizes the template set) and to the
  ACRB / triggered-letter tree (Perfect-Score / Recommend-Agent / Totaled-Vehicle
  / Estimate-Followup).

This is buildable now from `production-files-sample/2021-09-07/` +
`docs/psg/master-follow-up-program/`.

## 5. Mining → priors (#3)

Join `mail_send_history` (send side) to the repair-customer + survey exports
(outcome side) on `(ro_number | recipient_hash | household_key, date window)`.
For each segment compute outcome rate per piece and per A/B variant; write rows to
`mail_send_priors` + the doc summary. **Blocked on the send-log source (§2).**

## 6. Acceptance (mirrors the issue)

- AC1 Send-history rows imported + validated; **counts reconciled vs source**
  (importer emits a reconciliation report: source rows in vs rows persisted vs
  rejected-with-reason). *(needs §2 source)*
- AC2 Suppression list callable by the engine (`isSuppressed(...)`); opt-outs honored;
  household dedup proven by test.
- AC3 Priors written to `mail_send_priors` + `docs/ops/mail/priors/`; numbered-library
  catalog produced at `docs/ops/mail/letter-library.{md,json}`.
- AC4 PII handled per PSG-129/132/133 controls (no raw PII in `mail_send_history`;
  salted hash + household key only).

## 7. Build decomposition (child issues of PSG-216)

| Child | Deliverable | Owner | Blocked by |
|-------|-------------|-------|-----------|
| PSG-216a | §3 schema migration + send-history importer + reconciliation report | Ravi | §2 send-log source (Steve) |
| PSG-216b | §3.2 suppression/dedup table + `isSuppressed()` engine interface + tests | Nora | — |
| PSG-216c | §4 numbered-letter-library catalog (md+json) | Nora | — |
| PSG-216d | §5 mining → trigger/A-B priors → `mail_send_priors` + doc | Ravi | PSG-216a |
| QA | test plan + verification for each | Tess | each child |

W0 is parallel to W1: 216b and 216c start immediately; 216a/216d gate on the
send-log source. No live-mail spend at any step.
