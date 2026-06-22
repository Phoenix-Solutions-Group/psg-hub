# PSG-51 — Review of RO upload options against real pilot exports

Scope note (per Nick, 2026-06-22): **PSG ingests customer *RO* data only — not
estimate data.** The estimate import path is therefore out of scope for the
pilot; this review covers RO uploads.

Source material: real exports the shop provided under
`docs/Filemaker Exports/Customer Names/Customer Names/` (customer PII — **not
committed**; `.gitignore`'d in the harness drop folder). Three distinct RO
schemas appear in the real data, plus several file formats.

## 1. The three real RO schemas (all customer RO data)

| File | Schema | Header style | Example headers |
|------|--------|--------------|-----------------|
| `csv1.csv` | Raw shop export (Advantage-style) | spaced Title Case | `RO, First Name, Last Name, Address 1, City, State, zip, Make, In Date, Out Date` |
| `csv2.csv` | PSG canonical | concatenated `Owner*` | `OwnerFName, OwnerLName, OwnerStateProvince, RONumber, Total_Loss` |
| `csv3.csv` | CCC ONE full export | concatenated, ID-prefixed | `RODataPreparationID, CustomerProgramID, RONumber, OwnerStateProvince, …` |

All three map to the canonical RO model and are the universal CSV path every
estimating system can emit. `import_process_v1.json` (the legacy n8n
normalizer) and `Document Mappings/*.json` define the same 37-column canonical
target — this in-hub importer is the live replacement for that flow.

## 2. Format coverage (what each upload option does today)

The real folder contains: `csv ×3`, `xlsx ×5`, `xls ×2`, `xlsb ×1`, `xml ×1`,
`pdf ×7`.

| Format | In real data | Status today | Notes |
|--------|:---:|---|---|
| **CSV / TXT / TSV** | ✅ ×3 | **Works, dependency-free** | The guaranteed shipping path. All 3 real RO schemas validate end-to-end (see §3). |
| **XLSX / XLSM** | ✅ ×5 | **Coded, but blocked** | Parser routes to SheetJS via optional dynamic import. **`xlsx` is not installed** anywhere in the workspace → fails at runtime with a clear "install the decoder" error. |
| **XLSB** | ✅ ×1 | **Coded, but blocked** | Same as XLSX — needs `xlsx`. |
| **XLS (legacy BIFF)** | ✅ ×2 | **Not accepted** | `detectFormat` doesn't recognize `.xls`; SheetJS *can* read it. Gap: add `.xls` → spreadsheet path. Still needs `xlsx` installed. |
| **XML (Excel 2003 SpreadsheetML)** | ✅ ×1 | **Mis-rejected** | `xml1.xml` is `progid="Excel.Sheet"` SpreadsheetML — a spreadsheet, **not** a CIECA BMS interchange doc. Current parser rejects all `.xml` as CIECA BMS. Gap: detect the SpreadsheetML markers and route to the spreadsheet path (vs. true `<BMS>`). Needs `xlsx`. |
| **PDF** | ✅ ×7 | **Not supported** | Scanned/printed RO forms. The legacy n8n flow used OCR (AWS Textract / Google Vision). In-hub has no OCR. Larger, separate capability. |
| **CIECA EMS / BMS** | — | **Rejected with guidance** | Correct: interchange bundles, not tabular lists. Operator told to re-export the RO list as CSV. |

**Bottom line:** today only **CSV/TXT/TSV** actually ingest. Every binary/
spreadsheet format the shop uses (xlsx/xlsb/xls/xml) is gated on installing the
`xlsx` dependency (a workspace lockfile change — governance/dependency
decision, see §4). PDF needs a separate OCR capability.

## 3. CSV path: validated end-to-end against real exports (this issue's core)

Ran the in-hub pipeline (`parse → suggestMapping → validate`) against the real
files via `real-export-validation.test.ts`:

| File | Rows | Required mapped | Valid / invalid |
|------|---:|:---:|:---:|
| `csv1.csv` (raw) | 70 | yes | **70 / 0** |
| `csv2.csv` (canonical) | 66 | yes | **66 / 0** |
| `csv3.csv` (CCC ONE) | 3 | yes | **3 / 0** |

### Parser/mapping gaps the real data surfaced — all fixed + regression-tested

1. **Loose-substring auto-mapping false positives** (root cause). The old
   resolver did raw `header.includes(alias)` and took the first hit in column
   order. On CCC ONE this mapped `address_state ← CustomerProgramID`
   ("cu·**st**·omer", value `"1"`) and `ro_number ← RODataPreparationID`
   ("**RO**Data…"); on the canonical schema `ro_number ← OwnerOtherPhone`
   ("own·**ero**·therPhone") → empty → 61 false "RO required" errors.
   **Fix:** replaced with a tokenizing, scored resolver (exact > phrase > whole
   token > guarded prefix > length-guarded substring) assigned globally
   best-first. Short aliases (`ro`, `st`, `tl`) now only match a whole word.
2. **`total_loss` grabbing a dollar `Total` / `TotalLaborHrs` column** via a
   prefix rule (`"totaled".startsWith("total")`). **Fix:** prefix tier now only
   allows a header token that *extends* the alias; total-loss stays unmapped
   when there's no real total-loss column.
3. **Commercial / fleet ROs rejected.** ~6% of real rows (CARMAX, OMAHA GLASS
   CO, DRA CONSTRUCTION, ARMOREDKNIGHTS) carry the business name in the
   last-name field with a **blank first name**. The model hard-required first
   name. **Fix:** `customer_first_name` is now optional; `customer_last_name`
   (which holds the company name for businesses) is the required identity anchor.

Canonical `Owner*` / `Vehicle*` header names were also added as first-class
aliases so canonical and CCC ONE exports resolve deterministically.

Verification: `apps/psg-hub` import suite **115/115**, `tsc` 0, `eslint` 0.

## 4. Recommendations / follow-ups

- **Install `xlsx`** (workspace dep) to light up XLSX/XLSB/XLS/SpreadsheetML —
  these are formats the shop actually exports. This is a lockfile change →
  CTO/governance call. Once in, add `.xls` to `detectFormat` and split
  SpreadsheetML-XML from true CIECA BMS in `parse.ts`. *(Tracked as a
  follow-up.)*
- **PDF OCR** (Textract / Vision, as the legacy n8n flow did) is a separate
  capability — most real RO documents arrive as PDFs. Recommend a dedicated
  ticket; do not block the CSV pilot on it.
- **Drop the estimate import** from pilot scope (PSG doesn't receive estimate
  data). Keep the code (cheap, additive) but don't gate the pilot on it.
- The full **end-to-end-in-hub wizard run in production** still depends on
  prod/pilot activation (PSG-23). The parser/mapping validation gap — the part
  that doesn't need prod — is now closed.
