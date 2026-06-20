/**
 * Region map for America's Auto Body — Customer Information Form (ACRB CIF).
 * Coordinates are fractions of page width/height (0..1), resolution-independent.
 * Refined empirically against docs/americas-cif-forms-scan.pdf.
 */

export interface FieldRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FieldSectionGroup {
  id: "customer" | "referral" | "insurance" | "repair";
  label: string;
  fieldKeys: string[];
  checkboxKeys: string[];
}

export interface FormTemplate {
  name: string;
  regions: Record<string, FieldRegion>;
  sections: FieldSectionGroup[];
}

/**
 * ACRB Customer Information Form region map.
 * Field keys match GENERIC_COLLISION_V1 schema (src/lib/scan/schema.ts).
 */
export const ACRB_CIF_TEMPLATE: FormTemplate = {
  name: "acrb-cif-v1",
  regions: {
    BusinessKeyPSG: { x: 0.09, y: 0.135, w: 0.14, h: 0.038 },

    OwnerFName: { x: 0.075, y: 0.195, w: 0.30, h: 0.038 },
    OwnerLName: { x: 0.515, y: 0.195, w: 0.45, h: 0.038 },

    OwnerAddress1: { x: 0.05, y: 0.275, w: 0.93, h: 0.038 },
    OwnerAddress2: { x: 0.05, y: 0.275, w: 0.93, h: 0.038 },

    OwnerCity: { x: 0.05, y: 0.32, w: 0.27, h: 0.038 },
    OwnerStateProvince: { x: 0.33, y: 0.32, w: 0.21, h: 0.038 },
    OwnerPostalZip: { x: 0.555, y: 0.32, w: 0.42, h: 0.038 },

    OwnerHomePhone: { x: 0.05, y: 0.365, w: 0.46, h: 0.038 },
    OwnerCellPhone: { x: 0.50, y: 0.365, w: 0.47, h: 0.038 },

    OwnerEmail: { x: 0.05, y: 0.41, w: 0.93, h: 0.038 },

    PayType_CustomerInsurance: { x: 0.50, y: 0.155, w: 0.18, h: 0.025 },
    PayType_Claimant: { x: 0.68, y: 0.155, w: 0.13, h: 0.025 },
    PayType_CustomerPay: { x: 0.81, y: 0.155, w: 0.17, h: 0.025 },

    VehicleArrivedDate: { x: 0.05, y: 0.665, w: 0.21, h: 0.04 },

    GrossAmount: { x: 0.74, y: 0.66, w: 0.24, h: 0.05 },

    VehicleYear: { x: 0.05, y: 0.755, w: 0.21, h: 0.04 },
    VehicleMake: { x: 0.28, y: 0.755, w: 0.30, h: 0.04 },
    VehicleModel: { x: 0.60, y: 0.755, w: 0.38, h: 0.04 },

    EstimatorName: { x: 0.27, y: 0.805, w: 0.32, h: 0.04 },
  },
  sections: [
    {
      id: "customer",
      label: "Customer Information",
      fieldKeys: [
        "BusinessKeyPSG",
        "OwnerFName",
        "OwnerLName",
        "OwnerAddress1",
        "OwnerAddress2",
        "OwnerCity",
        "OwnerStateProvince",
        "OwnerPostalZip",
        "OwnerHomePhone",
        "OwnerCellPhone",
        "OwnerEmail",
      ],
      checkboxKeys: [
        "PayType_CustomerPay",
        "PayType_Claimant",
        "PayType_CustomerInsurance",
      ],
    },
    {
      id: "repair",
      label: "Repair Information",
      fieldKeys: [
        "VehicleArrivedDate",
        "GrossAmount",
        "VehicleYear",
        "VehicleMake",
        "VehicleModel",
        "EstimatorName",
      ],
      checkboxKeys: [],
    },
  ],
};

export function getRegionFor(fieldKey: string): FieldRegion | null {
  return ACRB_CIF_TEMPLATE.regions[fieldKey] ?? null;
}
