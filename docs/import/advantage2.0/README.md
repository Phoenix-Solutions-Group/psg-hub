# Advantage2.0 → BSM canonical field mapping (capture)

In-repo capture of the board-supplied workbook **Advantage2.0_FieldNames_and_Mapping**
([Google Sheet](https://docs.google.com/spreadsheets/d/1YXNEW8tjmdhHvd3Xqc4ro_B5ucYNeDEU6aNzJ6CPmzQ/edit)),
posted by Nick on PSG-98 and re-scoped to the data-import lineage under **PSG-175**.

Advantage2.0 is the legacy PSG **FileMaker** system (the CCI import path). This workbook is the
authoritative field dictionary that ties each legacy FileMaker source field to:
1. the **canonical** display name (`MASTER_DisplayName`),
2. the **CCI Import Mapping** = our **canonical-38** vocabulary
   (`apps/psg-hub/src/lib/ops/import/filemaker/canonical-fields.ts`),
3. the legacy **Repair Customer** (`RC_*`) and **Survey Customer** (`S_*` / `SQ_*`) import columns,
4. the **B Street Survey** text fields.

## Files (verbatim captures of each workbook tab)

| File | Source tab | Shape |
| --- | --- | --- |
| `field-mapping.csv` | **Field Mapping** | master dictionary — 136 source fields × 8 attribute columns |
| `repair_customer.csv` | **Repair_Customer** | 30 `RC_*` import fields + data-presence flag |
| `survey_customer.csv` | **Survey_Customer** | 105 `S_*`/`SQ_*` survey-import fields + data-presence flag |
| `shop.csv` | **Shop** | ~430 `M_*` shop-master / marketing-config fields |
| `RECONCILIATION.md` | — | field-by-field reconciliation vs the canonical model + recommendation |

> The "~870 source fields × ~45 columns" estimate in PSG-175 was high: the Field Mapping master
> has **136 data rows** and **8 populated attribute columns** (the sheet is padded with empty
> trailing columns). A handful of rows carry an unlabelled overflow value in column 9 — those are
> the survey "NOT FOUND" inventory items and are preserved verbatim in `field-mapping.csv`.

## How this was captured / how to refresh

Pulled from the authenticated Google session via the gviz CSV endpoint, then parsed (quoted
newlines collapsed to `; `, trailing empty columns trimmed). To refresh after the board edits the
sheet, re-export each tab:

```
https://docs.google.com/spreadsheets/d/1YXNEW8tjmdhHvd3Xqc4ro_B5ucYNeDEU6aNzJ6CPmzQ/gviz/tq?tqx=out:csv&sheet=<TabName>
```

Tab names: `Field Mapping`, `Repair_Customer`, `Survey_Customer`, `Shop`.

Captured 2026-06-22 (PSG-175).
