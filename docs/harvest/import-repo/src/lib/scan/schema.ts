export type FormFieldType =
  | "string"
  | "phone"
  | "zip"
  | "state"
  | "vin"
  | "date"
  | "number"
  | "email";

export interface FormFieldSpec {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  confidenceFloor?: number;
}

export interface FormCheckboxSpec {
  key: string;
  label: string;
  /**
   * Optional group for mutually exclusive checkbox sets.
   * Checkboxes in the same group collapse to a single canonical field
   * (see merge-pages.ts GROUP_COLLAPSE_MAP).
   */
  group?: string;
}

export interface FormSchema {
  version: 1;
  name: string;
  fields: FormFieldSpec[];
  checkboxes: FormCheckboxSpec[];
}

/**
 * Generic collision-repair customer form schema.
 *
 * Field keys match the canonical schema in src/lib/mappings/canonical-fields.ts
 * so merged rows flow into the existing 8-stage pipeline unchanged.
 *
 * Scope decisions (see docs/SPEC-handwritten-form-parsing.md §2):
 * - VIN omitted — no canonical slot in v1 (tracked as deferred).
 * - Form date mapped to VehicleArrivedDate (closest canonical analog).
 * - PayType checkboxes collapse to ClaimType in merge-pages.
 * - RepeatCustomer omitted — no canonical slot; surface in Scan Review notes (v2).
 */
export const GENERIC_COLLISION_V1: FormSchema = {
  version: 1,
  name: "generic-collision-v1",
  fields: [
    { key: "BusinessKeyPSG", label: "Shop ID", type: "string", required: false },
    { key: "VehicleArrivedDate", label: "Form Date", type: "date", required: true },
    { key: "OwnerFName", label: "First Name", type: "string", required: true },
    { key: "OwnerLName", label: "Last Name", type: "string", required: true },
    { key: "OwnerAddress1", label: "Address", type: "string", required: true },
    { key: "OwnerAddress2", label: "Apt/Suite", type: "string", required: false },
    { key: "OwnerCity", label: "City", type: "string", required: true },
    { key: "OwnerStateProvince", label: "State", type: "state", required: true },
    { key: "OwnerPostalZip", label: "Zip", type: "zip", required: true },
    { key: "OwnerHomePhone", label: "Home Phone", type: "phone", required: false },
    { key: "OwnerCellPhone", label: "Cell Phone", type: "phone", required: false },
    { key: "OwnerEmail", label: "Email", type: "email", required: false },
    { key: "VehicleYear", label: "Year", type: "number", required: false },
    { key: "VehicleMake", label: "Make", type: "string", required: false },
    { key: "VehicleModel", label: "Model", type: "string", required: false },
    { key: "EstimatorName", label: "Estimator", type: "string", required: false },
    { key: "GrossAmount", label: "Repair Total", type: "number", required: false },
  ],
  checkboxes: [
    { key: "PayType_CustomerPay", label: "Customer Pay", group: "payType" },
    { key: "PayType_Claimant", label: "Claimant", group: "payType" },
    { key: "PayType_CustomerInsurance", label: "Customer Insurance", group: "payType" },
  ],
};
