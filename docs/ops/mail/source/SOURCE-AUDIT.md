# PSG-216 W0 — Send-History Source Audit (definitive)

**Author:** Steve · **Date:** 2026-06-23 · **Issue:** PSG-216 (W0 Foundation)
**Question resolved:** Ada's escalation — "provide the FileMaker per-recipient send-history export, OR confirm the production-center dated batches *are* the send record (and supply the full set)."

This is the empirical-source audit behind AC1 (counts reconciled vs source) and AC3 (mining priors). It records exactly what exists, where, and what is/ isn't reachable through the existing Google-Drive read-bridge (same bridge as PSG-129/132/133).

---

## 1. The two send-history representations

| Representation | What it is | Reconciliation/priors role |
|---|---|---|
| **Per-recipient batch** (`Production Files`) | Concatenated print-merge output — one recipient block (name, address, "Dear Mr. X", vehicle) per person mailed a given numbered piece on a given date. Files named `{piece}-{type}-{date}.md`. | The row-level send log AC1/AC3 ideally want (enables household dedup + per-recipient survey/RO/referral joins). |
| **Aggregate ledger** (`Production Counts`) | Per **Mailed Date** × **numbered piece**, the count mailed. Spreadsheet ("Production Counts_PSG + The Mail House"). | The AC1 **reconciliation truth-source** (exact counts per piece per date) and a real **aggregate priors** input for PSG-224 (volume by piece/period). |

**CONFIRMED:** the production-center dated batches **are** the per-recipient send record. Verified by inspection (each `07-letter-09-07.md` etc. is a multi-recipient print merge) and by PSG-223, which already extracts recipient×piece×date from the `2021-09-07` batch (1779→1766 after dedup, 0 rejects).

---

## 2. What is reachable on the Drive bridge (and what is NOT)

Drive folder **`Production Center`** (`parentId 1J7Kpukl004jGPpmCJXsxAZ602DeEJkTW`) contains:

- **`Production Files (Sample)`** (`1FkDnZbR5O8FpqdsPg4vny8DHDOH2RaLx`) → exactly **one** dated batch: **`2021-09-07`** (already harvested into the repo at `docs/psg/production-center/production-files-sample/2021-09-07/`). **No other per-recipient batch is present.**
- **`Production Counts (Sample)`** (`1BX6XnICbaZhTOCYG0LbHnZ7YV7G02U-G`) — empty of files in listing.
- **`Production Counts_PSG (Sample)`** sheet (`1Dk0lGWQKzImEZMnqkXoqnoA17wz0kh17z1Dt9DDjK2c`) — Aug-2021 only (8 runs), per-piece detail.

**Full-scale aggregate ledger (NOT in a Sample folder, accessible):**
- **`Production Counts_PSG + The Mail House`** — fileId **`1EuJRRGX34AybuZCsSTN4Hi9k7-74k3medvL8TMAbOrk`**, 413 KB, created 2021-08, **modified 2026-06-18** (live, actively maintained). Span **08/10/2021 → 04/30/2024**, **295 distinct mailing dates** (~1,421 data rows in flat render).
- Sibling: **`Production Counts_PSG - FM 21 TEST`** (`1oT7g8c04vvR4moJyP91igoa_6sCSy7e3t0uEVnNQgI0`, 121 KB, 2025) — a FileMaker-21 export of the same ledger (confirms FM can emit this structurally).

**Conclusion on scope:** the structured electronic send-ledger that actually exists is the **Mail-House era, ~2.7 years (Aug-2021→Apr-2024)** — not 30 years. The "~30-year" framing in the issue is aspirational; no structured pre-2021 send record is reachable on the bridge.

---

## 3. Files committed here (drop-in source for PSG-223 / PSG-224)

- **`production-counts-ledger.raw.md`** — full flat-text render of the master ledger (132 KB, PII-free counts only). The canonical checked-in source-of-record; lets the importer build/test/reconcile offline.
- **`production-counts-ledger.csv`** — clean extract of the **rich 41-column per-piece detail slice** that the flat render exposes (59 mailings, **08/10/2021→02/24/2022**). Column taxonomy matches the numbered letter library (PSG-222): `01 Survey, 03 TY-Survey, 04 TY+Warranty, 05 Warranty, 06 TY, 07 TY+Warranty+Survey, 10 3-Month, 11 Birthday, 12 Drivers, 13 6-Month, 14 1-Year, 15 18-Month, 16 2-Year, T Total-Loss, E Estimate-Follow-Up, A Agent-Report-Card, S Special-Mailing`.

### Schema-drift note for the importer (PSG-223/224)
The Drive **flat-text** render of the workbook only exposes the rich per-piece 41-col schema for the **first 59 mailings**. The remaining 2022–2024 rows render under collapsed summary schemas (col-count distribution of date rows: `41→59, 12→412, 9→827, 7→109, 4→14`) because the workbook's **yearly tabs** flatten differently. **The full per-piece detail for 2022–2024 exists in the native spreadsheet tabs** — a complete extract should download the **`.xlsx`/FM-21 export** (fileIds above) and parse **per tab**, not the flat render. The CSV here is a correct, reconcilable starting slice; it is not the full per-piece history.

### Header quirk
In the flat render col0 is mislabeled `22` but holds the **Production Date**; columns 1–4 are `Printed Date / Printed Date / Mailed Date / Mailed Date` (a date + an adjacent numeric flag each). The CSV relabels col0 to `Production Date` and preserves all 41 columns verbatim — map precisely against the header row, do not assume positional alignment beyond col0.

---

## 4. Remaining gap → board (Nick)

What is **still missing** for full-scale row-level work (per-recipient suppression history + per-recipient outcome joins across the whole program, not just the one `2021-09-07` batch):

> **The full per-recipient `Production Files` archive** (every dated batch), **or** a **FileMaker per-recipient send-history table export** (recipient, piece, mailed-date, opt-out flag).

This is **board-gated** — only Nick can produce it from the live production system / FileMaker. Decision posed to Nick separately (see PSG-216 thread). W0 can proceed now on: full aggregate ledger (here) + the `2021-09-07` per-recipient sample (in repo). **No live-mail spend at any step (G4 unaffected).**

---

## 5. Addendum (PSG-249, Ravi · 2026-06-23) — full per-piece ledger ingested

The §3 schema-drift caveat ("the flat render only exposes rich per-piece detail
for the first 59 mailings; 2022–2024 lives in the workbook's yearly tabs") was a
limitation of the **flat-text render**, not of the source. Exporting the live
Google Sheet's first tab to CSV (Drive fileId
`1EuJRRGX34AybuZCsSTN4Hi9k7-74k3medvL8TMAbOrk`) yields the **full 41-column
per-piece schema for the entire series** — no per-tab assembly needed. Committed
verbatim (counts only, PII-free) as
[`production-counts-ledger.full.csv`](./production-counts-ledger.full.csv):
**476 mailings, 2021-08-10 → 2026-06-18, 715,177 pieces.**

Notes for consumers:
- **Production Date is the canonical key** (always present). The Printed/Mailed
  Date columns stopped being populated ~04/2022 while per-piece counts continued,
  so they are informational only. (Confirms the §3 col0=`22`=Production-Date quirk.)
- Per-piece **count = max over that piece's component columns** (letter/envelope/
  warranty/survey are equal per recipient).
- The ledger folds the `b` A/B alternates into their base column; a per-recipient
  reconciliation must fold `04b→04`, `10b→10`, etc.

Ingested by `apps/psg-hub/src/lib/ops/mail/production-counts-ledger.ts`
(parse + aggregate volume priors + reconcile, pure). **AC1** is satisfied by
reconciling the `2021-09-07` per-recipient batch against its ledger row: 8 pieces
match exactly; piece `04` is short by 1 because its envelope artifact is absent
from the sample batch (letter-only recipient) — 1779 parsed + 1 = the ledger's
1780; the importer dedups to 1766. **AC3-aggregate** volume priors are written to
[`../priors/aggregate-volumes.md`](../priors/aggregate-volumes.md).
