# Send-history importer — source mapping & reconciliation (PSG-223 / W0)

Spec: `docs/specs/002-mail-send-history-w0/spec.md` §3.1. Code:
`apps/psg-hub/src/lib/ops/mail/` (`parse-production-batch.ts`,
`send-history-import.ts`). Migration:
`apps/psg-hub/supabase/migrations/20260623140000_mail_send_history_w0.sql`.

## What the importer reads

The per-recipient **send record** for a mailing is the production-center batch:
`docs/psg/production-center/production-files-sample/<YYYY-MM-DD>/`, one markdown
file per `(piece, component)` — e.g. `07-envelope-09-07.md`. Only the **envelope**
component is an addressed send record (one addressed recipient per block); the
letter / warranty / survey components are content and are skipped so a send is
counted once.

Each recipient block is delimited by the **PSGID** (shop code, e.g. `PS760`),
printed as a leading marker and a form-feed (`\f`) page footer. Two real layouts
are handled:

| Layout | Pieces (2021-09-07) | Name location |
|--------|---------------------|---------------|
| col-0 | `t`, `10`, `12`, `13`, `14`, `15`, `16`, `10b` | name + address at column 0 |
| left-column marketing prefix | `07`, `04b` (warranty) | a marketing line (e.g. `Your Repair Warranty Enclosed`) fills the left column; the name + address align in the right column |

The name is recovered by slicing the name row at the **address column** (the
indent of the first address line), so a marketing prefix is dropped, never hashed.

## Field mapping → `public.mail_send_history`

| Source | Column | Notes |
|--------|--------|-------|
| PSGID token (`PS###`) | `shop_name` | resolved to friendly shop at live-wire time (`lib/ops/import/shops`) |
| filename piece code | `piece_code` | `t`,`04b`,`07`,`10`,`10b`,`12`–`16` |
| filename component | `piece_variant` | always `envelope` for imported rows |
| batch date | `sent_date`, `batch_ref` | |
| name + address (raw) | `recipient_hash`, `household_key` | **salted hashes only — raw PII never persisted (AC4)** |
| — | `send_ref` | `'<shop>:<recipient_hash>:<piece_code>:<sent_date>'`, UNIQUE → idempotent upsert |
| — | `ro_number`, `repair_order_id` | null at import; resolved to the spine later |

## Hashing contract (shared with suppression)

The importer **never defines its own hashing**. It takes a `MailHasher`
(`{ householdKey(address), recipientHash(name, address) }`) — exactly the shape of
`src/lib/ops/mail/household.ts` (PSG-221). Production wires **that one module**, so
`mail_send_history.household_key` equals the key `mail_suppression` derives — which
is what makes the "already_mailed (piece, household)" suppression join work
(spec §3.1/§3.2). Tests inject a deterministic stand-in that reproduces
household.ts's USPS-normalization semantics.

## Reconciliation (AC1)

`importSendBatch()` returns a `ReconciliationReport`: **source rows in =
persisted + deduplicated + rejected**, with per-reason and per-file breakdowns and
PII-safe rejection detail. `formatReconciliationReport()` renders it for logs/QA.

Proof against the **real** 2021-09-07 batch (10 envelope files), production
hasher (`household.ts`, PSG-221) bound:

```
source rows in: 1779
persisted:      1767
deduplicated:   12   (same recipient+piece collapsed by send_ref — idempotency)
rejected:       0
```

(The in-repo unit test's stand-in hasher also strips honorifics and so reports
`1766 / 13`; `household_key` is address-only so suppression is identical either way.)

## Status / not yet wired

Additive and **unwired** (like the RO importer, PSG-132/139): the migration +
pure importer + reconciliation ship now; the service-client upsert
(`ON CONFLICT (send_ref)`) and the `household.ts` binding are a later, G4-gated
live-wire step. The 2021-09-07 batch is the only production batch in the repo; the
full 30-year per-recipient send log is still pending from the operator (tracked on
PSG-216). When it lands, it drops into the same importer.
