# Advantage2.0 importer re-validation — 2026-06-22 sheet revision (PSG-302)

Re-validates the **live** CCI/Advantage2.0 import profile (canonical-38, shipped under
PSG-175 / PSG-176 / PSG-138) against the authoritative **Advantage2.0_FieldNames_and_Mapping**
workbook after the operator's 2026-06-22 edit.

- **Source:** Drive id `1YXNEW8tjmdhHvd3Xqc4ro_B5ucYNeDEU6aNzJ6CPmzQ`, `modifiedTime` `2026-06-22T12:50:03Z`.
- **Compared against:** `docs/import/advantage2.0/field-mapping.csv` (the in-repo verbatim copy) and the
  live profile `apps/psg-hub/src/lib/ops/import/data/advantage2-profile.ts`.
- **Method:** exported the live sheet as CSV and ran a column-level diff against the shipped CSV
  (136 data rows each), plus a code diff of the resolver map and the dedup key.

## TL;DR — PASS, no importer change required

The 2026-06-22 revision is **byte-identical** to the shipped mapping for every import-relevant
column. The `modifiedTime` bump landed only in out-of-scope columns (Survey_Customer / B-Street
text fields), not in the import contract.

## 1. FieldName → MASTER_DisplayName / CCI Import Mapping diff

| Check | Result |
| --- | --- |
| Header row (FieldName, MASTER_DisplayName, FieldType, IsMergeKey, CCI Import Mapping) | identical |
| Data rows compared | 136 live / 136 shipped |
| FieldNames added in revision | **0** |
| FieldNames renamed / dropped | **0** |
| Rows differing in cols [FieldName, MASTER, FieldType, IsMergeKey, CCI] | **0** |
| CCI-mapped (canonical) field count | **37 / 37**, set identical |

All 37 `CCI Import Mapping` rows still resolve exactly as encoded in `ADVANTAGE2_FIELD_MAP`,
including the upstream misspelling `BodyTechician` (preserved verbatim on both sides) and the
overflow fields (`String4` PayType + `String14–20` insurance-agent sub-record) which remain
CCI-unmapped and continue to route to `repair_orders.payload_jsonb` (Recommendation B).

## 2. IsMergeKey vs. importer dedup key

The sheet's `IsMergeKey=1` set is **unchanged** from the shipped CSV:

```
BUName, BusinessKeyPSG, ClaimType, EstimatorName, InsuranceCompany,
OwnerEmail, OwnerFName, OwnerLName, VehicleMake, VehicleModel, VehicleYear
```

The importer's RO dedup natural key (`rules-engine.ts:105–109`) is, by design, a different and
narrower set:

```
(OwnerFName, OwnerLName, OwnerAddress1, OwnerHomePhone)
```

This divergence is **intentional and already documented** (`RECONCILIATION.md` §1, "Dedup key
differs"). The workbook's `IsMergeKey` encodes the legacy FileMaker master-record identity; the
hub uses a person + address + home-phone natural key for RO dedup, and the mail/suppression
**household key is address-only** (PSG-224). No change required — and nothing in this revision
moved the merge-key flags.

> Note: `RECONCILIATION.md` §1 prose lists `RepairOrderID` among the workbook merge keys. The
> authoritative sheet has `RepairOrderID` `IsMergeKey=0` (true in both the shipped CSV and this
> revision) — the doc prose over-counts. Cosmetic; no importer impact (the dedup key never used
> `RepairOrderID`; it is the survey-attribution join serial per PSG-89).

## 3. Data-quality anomalies in the sheet (all out-of-scope for CCI import)

None affect the 37 CCI-mapped canonical fields. The resolver ignores unrecognized headers
(`advantage2-profile.ts` `mapAdvantage2Row` → unknown headers skipped), so these are inert on RO import:

- **Multi-target cells** (one cell → several destinations): `String3` Survey `"S_RC_Company, S_RC_ShopName"`;
  `PSGID` Survey `"S_RC_ShopID, S_MatchField_Customer"`; `String92` Survey `"SQ_Referral_InsRep,SQ_Referral_Agent"`;
  `String61` Survey = a 26-field comma list of `SQ_Selection_*`.
- **Age-bucket cell:** `String68` (Cust_Demo_Age_Group) Survey cell packs four fields in one cell
  (`SQ_Age_16_25` / `_26_40` / `_41_60` / `_61Up`). CCI mapping empty → not imported.
- **Semantically-repurposed legacy FileMaker FieldNames** used as survey carriers:
  `CorrectionalFacility`→`SQ_Dis_Rea_Other`, `AssistedLivingAndNursingHomes`→`SQ_Ease_Reason`,
  `MedianYearsInSchool`→`SQ_Customer_Yrs`, `RegistrationTypeCode`→`SQ_Neg_Sat_Reason`. Provenance
  hazard only; all `IsMergeKey=0`, CCI-unmapped.
- **Duplicate MASTER_DisplayName** `SQ_Shop_Selection` (rows `String61` and `number53`). Survey-only.
- **Inconsistent casing** of survey numeric FieldNames (`Number3..7` vs `number11..57`). The resolver
  normalizes case, so cosmetic.

## Disposition

Live importer re-validated against the 2026-06-22 revision: **PASS, zero code changes.** The
canonical-38 profile remains a complete and byte-accurate encoding of the workbook's CCI import
contract. Not a blocker on PSG-98.
