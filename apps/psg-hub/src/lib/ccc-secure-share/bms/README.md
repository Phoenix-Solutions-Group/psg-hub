# CCC Secure Share — BMS estimate domain core (PSG-261, Phase 1B)

Pure parser + mapper for **CIECA BMS** estimate XML, plus the adapters that let
the ops import backbone treat a BMS document as a `ccc_estimate` import. No I/O.

Modelled around the **public CIECA BMS data dictionary**, not CCC idiosyncrasies,
so Mitchell/Audatex are incremental later. The thin CCC vendor stubs in
`docs/psg/vendors/ccc/` are not authoritative — the BMS spec is.

## Modules

| File | Role |
|------|------|
| `xml.ts` | Minimal, dependency-free XML reader → `XmlNode` tree + navigation helpers. |
| `parser.ts` | `parseBmsEstimateXml(xml)` → validated tree (asserts it is a BMS estimate). |
| `mapper.ts` | `mapBmsEstimate(tree)` → `CccCanonicalEstimate` + dotted-path overflow. |
| `types.ts` | Canonical estimate / line-item / supplement / totals types. |
| `index.ts` | Public surface + `ccc_estimate` import-pipeline adapters. |

`bmsXmlToCanonical(xml)` is the one-shot parse+map convenience.

### Why a hand-rolled XML reader

The import backbone only ships a *spreadsheet* decoder (SheetJS, for
SpreadsheetML) — there is no general XML capability to reuse, and the parent
issue's guiding principle is **no external dependency** for the BMS domain core.
`xml.ts` is therefore a small, auditable, side-effect-free recursive-descent
reader scoped to a BMS document (elements, attributes, text, CDATA, comments,
PIs, DOCTYPE, entity decoding). It strips namespace prefixes to local names and
does not do DTD validation or namespace resolution — none of which the BMS
mapping needs.

## `payload_jsonb` overflow namespace

Every BMS field **without a canonical column** lands in `payload_jsonb` under a
stable, greppable dotted path (same spirit as the FileMaker `payload_jsonb`
overflow in `ops/import/filemaker/`). Top-level namespace prefix: **`bms.`**

`estimates.payload_jsonb` (via `bmsEstimatePayloadJsonb`):

| Dotted key | Source |
|------------|--------|
| `source` | constant `"ccc_secure_share_bms"` |
| `bms.estimate.number` / `bms.estimate.status` | `EstimateInfo/EstimateID` · `EstimateStatus` |
| `bms.ro.number` | `EstimateInfo/RepairOrderNumber` |
| `bms.claim.number` | `ClaimInfo/ClaimNumber` |
| `bms.facility.id` / `bms.facility.name` | `RepairFacility/FacilityID` · `BusinessName` |
| `bms.vehicle.vin` / `.year` / `.make` / `.model` | `VehicleInfo/*` |
| `bms.totals.parts` / `.labor` / `.paint` / `.tax` / `.grandTotal` | `RepairTotalsInfo/SummaryTotalsInfo/*` |
| `bms.lineItems` | array of `{lineNumber, kind, operation, description, quantity, hours, unitPrice, extendedPrice, partNumber, extra}` |
| `bms.supplements` | array of `{number, sequence, date, extra}` |
| `bms.vehicle.bodyStyle` / `.exteriorColor` / `.odometer` / `.licensePlate` / `.engine` / `.trim` | non-canonical `VehicleInfo/*` |
| `bms.claim.policyNumber` / `.lossType` / `.deductible` / `.insuranceCompany` | non-canonical `ClaimInfo/*` |
| `bms.facility.city` / `.state` | `RepairFacility/Address/*` |
| `bms.document.id` / `.type` / `.version` / `.createDateTime` | `DocumentInfo/*` |

Per-line and per-supplement BMS attributes with no canonical slot (e.g.
`PartType`, `LaborType`, `SupplementReason`) are collected verbatim into that
record's `extra` map.

`repair_orders.payload_jsonb` (via `bmsRepairOrderPayloadJsonb`) is a focused
subset linking the RO to its estimate/claim plus the headline grand total.

## `ccc_estimate` import kind

A BMS estimate is one rich document, not a tabular list, but the import pipeline
is row-oriented. So `canonicalToRawTable` projects the estimate onto a **single
row** whose headers are canonical field keys (identity / vehicle / owner /
totals), and stashes the full canonical estimate as JSON in one reserved carry
column, `CCC_BMS_PAYLOAD_FIELD` (`ccc_bms_payload`). That carry column survives
`validate` and is decoded by `toCommitRecord("ccc_estimate", row)` to build the
`estimates` + `repair_orders` insert payloads with the `payload_jsonb` overflow
above. The only kind-aware step is the parse (`parseImportTable`); suggest /
validate / normalize / commit are shared with `ro`/`estimate`.

Shop/facility → PSGID uses the existing resolver in `ops/import/shops/`
(`facilityId` is carried canonically for that lookup at commit time); no new
resolver is introduced here.

## Fixture caveat

`__fixtures__/sample-estimate.bms.xml` is **hand-authored to the public BMS data
dictionary**, not exported from a live CCC Secure Share account. Real CCC sample
XML arrives in Phase 0/2 — the element-name aliases in `mapper.ts` and this
fixture must be **re-validated against a real CCC export in Phase 2**.
