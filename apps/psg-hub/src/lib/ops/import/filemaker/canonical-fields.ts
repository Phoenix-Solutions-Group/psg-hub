// PSG-133 — Canonical-38 schema + canonical → Import Flush v5 mapping.
//
// Net-new IP harvested verbatim from Phoenix-Solutions-Group/import @ main
// (src/lib/mappings/canonical-fields.ts) ahead of decommission (PSG-50).
//
// This is "Layer 2" of the import repo's two-layer pipeline:
//   Layer 1: source headers -> canonical-38   (the import direction; already
//            ported into psg-hub by PSG-38 under ../fields.ts + ../template.ts,
//            using a DIFFERENT canonical vocabulary — see bridge.ts)
//   Layer 2: canonical-38 -> Import Flush v5   (this file + expand-to-fm.ts)
//
// The "map_export_fm.json" named in PSG-133 is, in the source repo, an external
// n8n artifact (n8n/Document Mappings/map_export_fm.json) describing the 38-field
// canonical schema; the in-code source of truth is CANONICAL_FIELDS below. The
// import repo README calls this "38 canonical fields".
//
// ⚠️ DISCREPANCIES (surfaced for PSG-44 confirmation), preserved verbatim:
//   - README says "38 canonical fields"; CANONICAL_FIELDS has 37 entries.
//   - CANONICAL_TO_FM_MAP maps `OwnerCompanyName` -> "R_Customer_Company", but
//     `OwnerCompanyName` is NOT a member of CANONICAL_FIELDS. (Adding it would
//     make the count 38.) Ported as-is; expand-to-fm.ts tolerates extra source
//     keys, so this is harmless but should be reconciled before cutover.

export const CANONICAL_FIELDS = [
  "RODataPreparationID",
  "RepairOrderID",
  "CustomerProgramID",
  "RONumber",
  "SourceFeed",
  "OwnerFName",
  "OwnerLName",
  "OwnerAddress1",
  "OwnerAddress2",
  "OwnerCity",
  "OwnerStateProvince",
  "OwnerPostalZip",
  "OwnerCountryCode",
  "OwnerHomePhone",
  "OwnerWorkPhone",
  "OwnerCellPhone",
  "OwnerOtherPhone",
  "OwnerDayPhone",
  "OwnerNightPhone",
  "OwnerEmail",
  "VehicleYear",
  "VehicleMake",
  "VehicleModel",
  "InsuranceCompany",
  "ReferralSourceName",
  "EstimatorName",
  "InsuranceAgentName",
  "BUName",
  "BusinessKeyPSG",
  "TotalLaborHrs",
  "GrossAmount",
  "ClaimType",
  "VehicleArrivedDate",
  "RepairStartedDate",
  "DeliveredDate",
  "PaintTechFullName",
  "BodyTechFullName",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/**
 * Canonical field name -> Import Flush v5 (FM) field name. Verbatim from source.
 * Note `OwnerCompanyName` is present here but absent from CANONICAL_FIELDS above
 * (see discrepancy note). Fields not listed here flush to empty strings.
 */
export const CANONICAL_TO_FM_MAP: Record<string, string> = {
  RONumber: "R_RONumber",
  OwnerFName: "R_Customer_First",
  OwnerLName: "R_Customer_Last",
  OwnerCompanyName: "R_Customer_Company",
  OwnerAddress1: "R_Address",
  OwnerAddress2: "R_AddressB",
  OwnerCity: "R_Customer_City",
  OwnerStateProvince: "R_Customer_State",
  OwnerPostalZip: "R_Customer_Zip",
  OwnerEmail: "R_EmailAdress",
  OwnerCellPhone: "R_Phone_Home",
  OwnerWorkPhone: "R_Phone_Work",
  OwnerHomePhone: "R_Phone_Home2",
  OwnerOtherPhone: "R_Phone_Other",
  OwnerDayPhone: "R_Phone_Day",
  VehicleYear: "R_Vehicle_Year",
  VehicleMake: "R_Vehicle_Make",
  VehicleModel: "R_Vehicle_Model",
  InsuranceCompany: "R_InsuranceCompany",
  ReferralSourceName: "R_ReferedBy",
  EstimatorName: "R_Employee_Estimator",
  InsuranceAgentName: "R_Agent_Name",
  BUName: "R_Shop_Name",
  BusinessKeyPSG: "R_ShopID",
  GrossAmount: "R_RepairTotal",
  ClaimType: "R_PaymentType",
  VehicleArrivedDate: "R_Repair_In",
  DeliveredDate: "R_Repair_Out",
  BodyTechFullName: "R_Employee_Body",
  PaintTechFullName: "R_Employee_Paint",
};
