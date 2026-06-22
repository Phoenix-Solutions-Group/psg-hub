# Advantage2.0 → BSM canonical reconciliation (PSG-175)

Reconciles the board's **Advantage2.0_FieldNames_and_Mapping** workbook against the existing BSM
canonical model:

- **canonical-38** — `apps/psg-hub/src/lib/ops/import/filemaker/canonical-fields.ts` (37 `CANONICAL_FIELDS`)
- **FileMaker Import Flush v5** — `apps/psg-hub/src/lib/ops/import/filemaker/fm-field-order.ts` (165-col export, `CANONICAL_TO_FM_MAP`)
- **header aliases** — `apps/psg-hub/src/lib/ops/import/data/header-mappings.ts` (`MASTER_HEADER_MAPPINGS`)
- **hub RO/Estimate import** — `apps/psg-hub/src/lib/ops/import/fields.ts` + `bridge.ts`
- **shop registry** — `apps/psg-hub/src/lib/ops/import/shops/` (PSG-139)
- **survey model** — `survey_responses` / `repair_order_employees` / `survey_dispatches` (PSG-89)

## TL;DR

1. **The workbook's `CCI Import Mapping` column IS a ready-made, deterministic
   Advantage2.0(FileMaker)→canonical-38 map.** All **37/37** canonical-38 fields have an
   Advantage2.0 source. There are **no gaps in canonical-38 coverage** — the vocabulary we already
   ship is correct and complete against the legacy system.
2. **The real blocker for pilot import (PSG-51) is a field-name layer mismatch, not a missing model.**
   Our `header-mappings.ts` only recognizes human labels ("First Name", "Shop ID"). A real
   Advantage2.0/CCI export arrives in **FileMaker field names** (`String3`, `FirstName`, `Address1`,
   `String24`) and/or **MASTER_DisplayName** (`Shop_Name`, `Cust_Address_Line_1`) — neither is in our
   alias table. Encoding this workbook as an import profile closes that gap.
3. **Two fields are captured by the legacy RC/Survey import but have no canonical-38 home:**
   customer **Pay Type** and the structured **insurance-agent sub-record** (agent address + first/last).
   Recommend capturing both in `repair_orders.payload_jsonb` — **no schema change needed**.

---

## 1. canonical-38 ↔ Advantage2.0 — MATCHED (37/37)

`canonical field  ←  Advantage2.0 FieldName  (MASTER_DisplayName)` — from the `CCI Import Mapping` column.

| canonical-38 | ← Advantage2.0 FieldName | MASTER_DisplayName | merge key |
| --- | --- | --- | :-: |
| RODataPreparationID | RODataPreparationID | RODataPreparationID | |
| RepairOrderID | RepairOrderID | RepairOrderID | ✓ |
| CustomerProgramID | CustomerProgramID | Cust_Program_ID | |
| RONumber | RepairOrderNumber | RO_Number | |
| SourceFeed | String100 | SourceFeed | |
| OwnerFName | FirstName | Cust_Name_First | ✓ |
| OwnerLName | LastName | Cust_Name_Last | ✓ |
| OwnerAddress1 | Address1 | Cust_Address_Line_1 | |
| OwnerAddress2 | Address2 | Cust_Address_Line_2 | |
| OwnerCity | City | Cust_Address_City | |
| OwnerStateProvince | State | Cust_State | |
| OwnerPostalZip | PostalZip | Cust_Zip_Code | |
| OwnerCountryCode | Country | Cust_Address_Country | |
| OwnerHomePhone | Phone | Cust_Phone_Home | |
| OwnerWorkPhone | WorkPhone | Cust_Work_Phone | |
| OwnerCellPhone | MobilePhone | Cust_Phone_Mobile | |
| OwnerOtherPhone | OtherPhone | Cust_Phone_Other | |
| OwnerDayPhone | DayPhone | Cust_Phone_Day | |
| OwnerNightPhone | NightPhone | Cust_Phone_Night | |
| OwnerEmail | Email | Cust_Address_Email | ✓ |
| VehicleYear | String24 | Cust_Vehicle_Year | ✓ |
| VehicleMake | String25 | Cust_Vehicle_Make | ✓ |
| VehicleModel | String26 | Cust_Vehicle_Model | ✓ |
| InsuranceCompany | String13 | Cust_Ins_Company | ✓ |
| ReferralSourceName | String98 | Cust_Referral_Source_Name | |
| EstimatorName | String28 | Shop_Estimator_Name | ✓ |
| InsuranceAgentName | InsuranceAgentName | Ins_Agent_Full_Name | |
| BUName | String3 | Shop_Name | ✓ |
| BusinessKeyPSG | PSGID | PSGID | ✓ |
| TotalLaborHrs | TotalLaborHours | Repair_Labor_Hours | |
| GrossAmount | GrossAmount | Repair_Total | |
| ClaimType | String27 | Cust_Demo_Claim_Type | ✓ |
| VehicleArrivedDate | VehicleArrivedDate | Repair_Vehicle_Arrived_Date | |
| RepairStartedDate | RepairStartedDate | Repair_Start_Date | |
| DeliveredDate | DeliveredDate | Repair_Delivered_Date | |
| PaintTechFullName | PaintTechnician | Shop_Paint_Tech_Full_Name | |
| BodyTechFullName | BodyTechician | Shop_Body_Tech_Full_Name | |

**Result: 37/37 matched.** No canonical add/rename required for the core RO import vocabulary.

### Conflicts / modeling notes inside the matched set

- **`OwnerCompanyName` has no Advantage2.0 source.** It exists in our `CANONICAL_TO_FM_MAP`
  (→ `R_Customer_Company`) but not in `CANONICAL_FIELDS`. The only "Company" field in the workbook
  is `S_RC_Company`, which maps to **`Shop_Name`** (the shop, not the customer). → Treat
  `OwnerCompanyName` as an empty-flush FM target only; it is not a real inbound field. (cosmetic)
- **Two RO identifiers — join-key caution for survey attribution (PSG-89).**
  `RepairOrderID` (Number, internal FileMaker serial) is the dedup/merge key and is what the Survey
  tab's **`S_RC_RONumber` maps to**. `RONumber` (String, the shop's printed RO#) maps from
  `RepairOrderNumber`. So legacy survey↔RO matching keys on the **internal serial**, not the printed
  RO#. Our `repair_orders.ro_number` stores the printed string. **PSG-89 survey attribution must join
  on the serial (`RepairOrderID`), not the display RO#** — flag for whoever owns survey wiring.
- **Dedup key differs.** Our `rules-engine.ts` natural key = (FName, LName, Address1, HomePhone).
  The workbook flags `IsMergeKey=1` on FName, LName, Email, PSGID, Vehicle Make/Model/Year, ClaimType,
  Shop_Name, RepairOrderID and several agent fields. Ours is a reasonable subset; no change required,
  but note the workbook treats **Email + PSGID** as identity too.

---

## 2. NEW — in Advantage2.0 + used by legacy RC/Survey import, but NOT in canonical-38

These flow through the legacy CCI repair-customer / survey import but have no canonical-38 slot.

| Advantage2.0 FieldName (MASTER_DisplayName) | RC column | Survey column | Disposition |
| --- | --- | --- | --- |
| String4 (Cust_Demo_Pay_Type) | RC_PayType | S_RC_PayType | **GAP** — distinct from `ClaimType`. → `payload_jsonb` |
| String16/17/18 (Ins_Agent_Address_1/2/City) | RC_Agent_Address(2)/City | S_RC_Agent_* | **GAP** — agent address. → `payload_jsonb` |
| String14/15 (Ins_Agent_Name_First/Last) | RC_Agent_First/Last | S_RC_Agent_First/Last | **GAP** — structured agent name (canonical has full-name only). → `payload_jsonb` |
| String19/20 (Ins_Agent_State/Zip) | RC_Agent_State/Zip | S_RC_Agent_State/Zip | → `payload_jsonb` |
| String8 (Cust_Repeat_Customer) | RC_Repeat_Yes_No | S_RC_Repeat | repeat-customer flag → `payload_jsonb` |
| String9/10/11 (Cust_Referral / _Type / _From) | RC_Referral_* | S_RC_Referral(_From) | referral detail → `payload_jsonb` (canonical has `ReferralSourceName` only) |
| DateEnrolled (Cust_System_Import_Date) | RC_CreationDate | — | import timestamp (provenance) |
| Birth_Date / Gender / String68 (Age_Group) | — | — | demographics (B Street survey) |
| String12 (Cust_DL_Exp_Date) | — | — | not used in import |
| String60 (Cust_Last_Time_Used_Shop), ChangedTime (Cust_Last_Updated), String72 (Demo_Rental_Car_Company), String64 (InternetResearchforShop) | — | — | metadata; not import-critical |
| ~80 `SQ_*` fields | — | (survey instrument) | belong to the **survey model (PSG-89)**, not RO import — see §3 |

**No canonical-38 schema change is recommended.** `repair_orders.payload_jsonb` already exists for
exactly this overflow; capture PayType / agent sub-record / referral / repeat flags there.

> Note: `header-mappings.ts` already declares canonical keys beyond the 37 —
> `RepeatCustomer`, `DateOfBirth`, `DriversLicenseExpiration`, `OwnerCompanyName` — i.e. the alias
> table is already half-prepared for some of this overflow (`Cust_Repeat_Customer`,
> `Cust_Demo_Birth_Date`, `Cust_DL_Exp_Date`). `Cust_Demo_Pay_Type` is the one with no slot at all.

---

## 3. Survey_Customer tab (S_/SQ_) ↔ survey model (PSG-89)

- The `S_RC_*` block (customer/vehicle/agent/dates) mirrors the RC fields and resolves to the same
  canonical-38 RO fields (see §1) — the survey extract carries a denormalized copy of the RO.
- The `SQ_*` block is the **survey instrument** (~80 questions/scores). Mapping to PSG-89:
  - `SQ_Scale_Work` / `SQ_Scale_Clean` / `SQ_Scale_Comm` / `SQ_Scale_Courteous` line up with our
    `survey_responses.q05_01..q05_04` (Quality / Cleanliness / Communication / Courtesy).
  - `SQ_Would Recom_Shop_NP` → `survey_responses.would_recommend`.
  - `SQ_Scale_EMI_pct` / `SQ_Scale_CSI_logic_pct` / `SQ_Scale_CSI_Emotion_pct` correspond to our
    EMI/CSI scoring (`scale_emi_pct`, CSI = EMI×100). **Note: these three are `NOT FOUND`** in the
    workbook's data-presence column — i.e. not populated in the current extract.
- **Data-presence signal:** of 105 Survey_Customer fields, the `NOT FOUND` rows tell us which survey
  attributes are absent from the current export (e.g. all `SQ_Selection_*` shop-selection drivers,
  age bands, rental scales, `S_RC_ShopID`, `S_RC_Cust_Zip`). This is a **content gap in the sample
  extract**, not a model gap — relevant when validating a real survey import.

---

## 4. Shop tab (M_) ↔ shop registry (PSG-139)

The Shop tab is the full PSG **shop/member master** from FileMaker (~430 fields) — far richer than
our import-side shop registry (`InvoicedShop`: name, psgId, invoicedId, city, state, + pricing meta).

- **Identity subset relevant to import** (maps cleanly to PSG-139 registry + `companies`):
  `M_Shop_Name`, `M_ShopName_Letters`, `M_Shop_Address(2)`, `M_Shop_City/State/Zip`,
  `M_Shop_Phone_1`, `M_Shop_Fax`, `M_WebAddress`, `M_Shop_Owner_First/Last/Title`,
  `M_Member_Status`, `M_Shop_Type`, `M_SerialNumber_MSO`, `M_Shop_Name_MSO`. Shop resolution key is
  **PSGID** (= `BusinessKeyPSG`, aligns with registry `psgId`).
- **Out of scope for RO import:** the bulk of the tab is marketing/automation config —
  `M_DPM_*` (digital/print product lines), `M_Mrk_*` (Master Follow-Up letter program + pricing),
  `M_Report_Email *` (report routing), `M_Sort_*`, `M_Coupon_*`, `M_Warranty_*`, `M_RedFlag_*`,
  `MP_*` (member profile). These are **material for the direct-mail / Master Follow-Up digitization
  (PSG-115)**, not for RO/Estimate/Survey import validation.

---

## 5. Recommendation / next-step change set

**A. Wire the mapping into import (unblocks PSG-51).** Encode the `CCI Import Mapping` column as an
Advantage2.0/CCI **import profile** — an alias layer keyed on, in priority order:
   1. raw FileMaker `FieldName` (`String3`, `FirstName`, `Address1`, …),
   2. `MASTER_DisplayName` (`Shop_Name`, `Cust_Address_Line_1`, …),
   3. legacy `RC_*` column name (`RC_Cust_First`, …),
   all resolving to canonical-38. Source of truth = `field-mapping.csv` in this folder. Add to
   `lib/ops/import/data/header-mappings.ts` (extend `MASTER_HEADER_MAPPINGS`) or a sibling
   `advantage2-profile.ts` selected when `SourceFeed`/profile = Advantage2.0. **Delegated as a child
   issue of PSG-175** (engineer-owned, parallelizable).

**B. Capture the 2 canonical gaps in `payload_jsonb`** (PayType + structured insurance-agent
sub-record + referral/repeat flags). No migration, no canonical-38 change.

**C. Survey attribution join key (PSG-89):** join survey↔RO on `RepairOrderID` (internal serial),
because `S_RC_RONumber` = `RepairOrderID`, not the printed `RONumber`.

**D. Cosmetic:** mark `OwnerCompanyName` as FM-flush-only (no inbound source).

### Questions back to the board (non-blocking)

1. **Export format for the pilot:** will real Advantage2.0/CCI exports arrive with column headers as
   the raw FileMaker `FieldName`, the `MASTER_DisplayName`, or the `RC_*` names? This sets which
   alias layer (A) we prioritize. (Defaulting to support all three.)
2. The `SQ_Scale_EMI_pct` / `SQ_Scale_CSI_*_pct` survey scores are `NOT FOUND` in the sample —
   confirm whether the production survey extract will include the computed EMI/CSI percentages, or
   whether BSM should compute them from the component scales.

**Link:** this reconciliation is the real-mapping material PSG-51 (pilot RO/Estimate import
validation) and the PSG-44 FileMaker cutover have been waiting on.
