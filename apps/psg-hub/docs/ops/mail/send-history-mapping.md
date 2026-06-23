# Send-history column mapping — W0 (PSG-223 / PSG-115e)

Maps the legacy FileMaker / production-center **send record** onto
`public.mail_send_history` (migration `20260623140000_mail_send_history_w0.sql`,
spec [`002-mail-send-history-w0/spec.md`](../../specs/002-mail-send-history-w0/spec.md) §3.1).

Importer: `src/lib/ops/import` decoders are reused for address normalization;
mail-specific code lives in `src/lib/ops/mail/`.

## 1. Source-of-record for the send side

The dated production-center batch is the per-recipient send record for one
mailing:

```
docs/psg/production-center/production-files-sample/<YYYY-MM-DD>/<piece>-<component>-MM-DD.md
```

For each numbered piece there are up to four **components** —
`letter` / `envelope` / `warranty` / `survey`. The **`envelope` component is the
addressed artifact**: it lists every recipient the piece was mailed to. The other
components are content (a subset of, or identical to, the envelope recipients), so
the importer reads **only `*-envelope-*.md`** to avoid double-counting a send.

> This file set is **gitignored** (it carries raw customer PII), exactly like the
> RO `real-exports/` fixtures (PSG-51/183). It is never committed. The importer is
> proven against it on-disk locally / in QA; CI runs the committed synthetic
> fixture `src/lib/ops/mail/__tests__/fixtures/99-envelope-09-07.md`.

### Recipient block shape (form-feed / page-break delimited)

```
PS218                         ← PSGID (shop key); after the first, prefixed by \f + indent

Mr. Stephen Moore             ← name
2930 North Swan Road          ← street line(s), 0..2 (unit on its own line)
Tucson, Arizona 85712         ← City, State ZIP   (state spelled out; ZIP 5 or ZIP+4)
```

## 2. Column mapping → `mail_send_history`

| Target column     | Source                                   | Transform |
|-------------------|------------------------------------------|-----------|
| `shop_name`       | `PS####` token on the piece              | Used verbatim as the stable shop key. Resolved to the friendly shop name through the shop directory (`lib/ops/import/shops`) at live-wire time. |
| `piece_code`      | filename prefix (`04b-envelope-…` → `04b`) | lowercased |
| `piece_variant`   | filename component (`…-envelope-…`)      | `'envelope'` (the addressed component the row was read from) |
| `sent_date`       | batch directory date (`2021-09-07`)      | ISO `YYYY-MM-DD`. The filename's `MM-DD` echoes it; the **year** comes from the dir. |
| `batch_ref`       | batch directory name                     | e.g. `'2021-09-07'` |
| `recipient_hash`  | name + normalized address                | salted SHA-256 (PII-min) — raw name/address never persisted |
| `household_key`   | normalized address only                  | salted SHA-256 — household-level dedup / suppression seed |
| `ro_number`       | — (legacy send log has no RO column)     | `null`; resolved to `repair_order_id` later in mining (PSG-216d) |
| `repair_order_id` | —                                        | `null` at import |
| `send_ref`        | `<shop>:<recipient_hash>:<piece_code>:<sent_date>` | deterministic idempotency key (UNIQUE) |
| `source`          | constant                                 | `'filemaker'` |

### Address normalization (reused from the RO importer)

`recipient-hash.ts` runs the parsed street/city/state/zip through the shared
`src/lib/ops/import/address.ts` helpers (`normalizeStreet`, `normalizeState`,
`normalizeZip`) before hashing, so `123 Main St` and `123 Main Street` collapse to
the same household/recipient. Names are lowercased with honorifics (Mr./Ms./…)
dropped.

### DDR cross-reference

The FileMaker DDR (`docs/Filemaker Exports/Filemaker DDR/2025-05-14/`) describes
the Advantage/Survey schema; the production-center envelope is the rendered output
of the mail-merge those tables drive. When Steve delivers the **structured**
30-year send export (a tabular FileMaker dump rather than rendered envelopes — see
§4), its columns map onto the same targets:

| Likely DDR/export column | Target |
|--------------------------|--------|
| `PSGID` / `R_ShopID`     | `shop_name` |
| customer name fields     | `recipient_hash` (then dropped) |
| `Address` / `City` / `State` / `Zip` | `household_key` + `recipient_hash` (then dropped) |
| letter/piece number      | `piece_code` |
| mail/send date           | `sent_date` |
| `RONumber`               | `ro_number` → `repair_order_id` |

## 3. Reconciliation report (AC1)

`importSendBatch()` emits a `ReconciliationReport`:
**source-rows-in = persisted + deduplicated + rejected** (invariant asserted in
tests). Rejects are classified (`missing_psgid` / `missing_name` /
`missing_street` / `unparseable_city_state_zip`) with PII-safe detail.

Proven against the real **2021-09-07** batch, with the **production** hasher
(`household.ts`, PSG-221) bound:

```
source rows in: 1779
persisted:      1767
deduplicated:   12     ← same (shop, recipient, piece, date) mailed twice → idempotent collapse
rejected:       0
```

Per-file: 04b=149, 07=244, 10=388, 10b=68, 12=10, 13=2, 14=527, 15=314, 16=64, t=1
(accepted). The 12 dedups are recipients printed more than once in a single
envelope run; `send_ref` collapses them so a re-import never double-counts.

> Note: the in-repo unit test injects a deterministic stand-in hasher that
> *additionally* strips honorifics, so it reports `1766 / 13` — one same-address
> pair differing only by an honorific ("Mr. Stephen Moore" vs "Stephen Moore")
> collapses under the stand-in but is kept as two distinct rows under production.
> `household_key` is address-only, so honorific variants share it regardless and
> still suppress together on the `already_mailed (piece, household)` join; the ±1
> is one extra send-history row, immaterial to suppression and priors.

## 4. Gated on operator data (full 30-year history)

Only the single 2021-09-07 batch is in the repo. The full per-recipient
send log is provided by the operator via the same read-bridge as
PSG-129/132/133. When it lands, run the importer over it and reconcile persisted
counts vs the source row count; the same report drives the AC1 sign-off. Tracked
on the parent (PSG-216).
