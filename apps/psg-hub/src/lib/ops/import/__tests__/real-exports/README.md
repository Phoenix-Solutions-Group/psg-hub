# Real pilot-export validation (PSG-51)

This directory feeds the **real pilot-export validation harness**
(`../real-export-validation.test.ts`). It closes the remaining gap on
[PSG-51](/PSG/issues/PSG-51): proving the in-hub import flow ingests **real**
RO/Estimate exports from the pilot shop's estimating system end-to-end — not
just synthetic fixtures.

## How to validate a real export

1. From the pilot shop's estimating system (**CCC ONE / Mitchell / Audatex**),
   export the **RO list** and the **Estimate list** report views and save each
   as **CSV** (XLSX also works). See "If you only have an EMS/BMS export" below.
2. Drop the files here, by kind:
   - RO exports → `ro/`
   - Estimate exports → `estimate/`
   Any of `.csv`, `.txt`, `.tsv`, `.xlsx`, `.xlsm`, `.xlsb`, `.xls`, or
   Excel-2003 SpreadsheetML `.xml` are accepted (binary/spreadsheet decode via
   SheetJS — PSG-186).
3. Run the harness:
   ```bash
   pnpm --filter psg-hub test real-export-validation
   ```
4. For each file the harness prints a readiness report (rows, detected headers,
   auto-mapped fields, valid/invalid counts, sample errors) and **asserts**:
   - the file parses and has ≥1 data row,
   - every **required** field auto-resolves from the headers,
   - the large majority (**≥90%**) of rows are import-ready. Real exports carry
     a few genuinely-dirty rows (misaligned columns, typo'd states, missing
     identity) the wizard is meant to flag — so we don't demand zero hard
     errors, only that a parser/sheet/header regression can't crater the ratio.

Any parser/mapping gap a real export surfaces gets fixed in
`apps/psg-hub/src/lib/ops/import` and covered by a synthetic test in
`../import.test.ts` (so the fix is regression-proof without keeping PII in git).

## ⚠️ Do NOT commit real exports

Real exports contain **customer PII** (names, phones, addresses). Everything in
`ro/` and `estimate/` is `.gitignore`'d except this README. Never `git add -f` a
real export. When the harness has confirmed an export validates, record the
result (system, file, row counts, fixes made) in the PSG-51 thread — not the
file itself.

## If you only have an EMS/BMS export

CCC ONE / Mitchell / Audatex can emit a **CIECA EMS** bundle (a folder of `.EMS`
flat files) or a **CIECA BMS** XML document. Those are estimate-*interchange*
artifacts, not tabular lists — the import wizard rejects them with guidance to
re-export the RO/Estimate **list/report** as CSV. Use that tabular export here.
