const PACKAGE_PRODUCT_NAME = "Legacy Advantage Program Package";

const LEGACY_PACKAGE_FLAGS = [
  ["M_Mrk_ThankYou_ACRB", "thank_you_standard", "Thank-you standard"],
  ["M_Mrk_ThankYou_NoSur", "thank_you_no_survey", "Thank-you, no survey"],
  ["M_Mrk_ThankYou_NoWar", "thank_you_no_warranty", "Thank-you, no warranty"],
  [
    "M_Mrk_ThankYou_NoSurWar",
    "thank_you_no_survey_no_warranty",
    "Thank-you, no survey or warranty",
  ],
  ["M_Mrk_Warranty_ACRB", "warranty", "Warranty"],
  ["M_Mrk_Survey", "survey", "Survey"],
  ["M_Mrk_3Month", "three_month", "3-month follow-up"],
  ["M_Mrk_1Year", "one_year", "1-year follow-up"],
  ["M_Mrk_18Month", "eighteen_month", "18-month follow-up"],
  ["M_Mrk_2Year", "two_year", "2-year follow-up"],
  ["M_Mrk_Birthday", "birthday", "Birthday"],
  ["M_Mrk_Drivers", "drivers", "Driver's license renewal"],
  ["M_Mrk_ReportCard", "report_card", "Agent report card"],
  ["M_Mrk_Holiday", "holiday", "Holiday"],
] as const;

const ESTIMATE_FOLLOW_UP_FLAGS = [
  ["M_Mrk_EstFU_Flag_Bill", "bill", "Bill"],
  ["M_Mrk_EstFU_Flag_Custom", "custom", "Custom"],
  ["M_Mrk_EstFU_Flag_Direction", "direction", "Direction"],
  ["M_Mrk_EstFU_Flag_Maze", "maze", "Maze"],
  ["M_Mrk_EstFU_Flag_NoCoupon", "no_coupon", "No coupon"],
  ["M_Mrk_EstFU_Flag_Search", "search", "Search"],
] as const;

export type LegacyPackageExportRow = Record<
  string,
  string | number | boolean | null | undefined
>;

export type LegacyPackageItem = {
  key: string;
  label: string;
  legacyField: string;
};

export type LegacyEstimateFollowUpOption = LegacyPackageItem & {
  discountPercent: number | null;
};

export type LegacyPackageMapping = {
  legacySerialNumber: string;
  shopName: string;
  product: {
    name: typeof PACKAGE_PRODUCT_NAME;
    description: string;
    selling_price_cents: number;
    items_jsonb: LegacyPackageItem[];
  };
  companyProgram: {
    quantity: 1;
    unit_price_cents: number;
    customizations_jsonb: {
      source: "legacy_advantage_package_export";
      legacySerialNumber: string;
      shopName: string;
      packageItems: LegacyPackageItem[];
      estimateFollowUp: {
        discountPercent: number | null;
        options: LegacyEstimateFollowUpOption[];
      };
      totalSelectedItems: number;
    };
  };
};

export type LegacyPackageProgramUpsert = {
  company_id: string;
  product_id: string;
  quantity: 1;
  unit_price_cents: number;
  customizations_jsonb: LegacyPackageMapping["companyProgram"]["customizations_jsonb"];
};

export type LegacyProductMapping = {
  legacyRecordId: string | null;
  name: string;
  legacyCode: string | null;
  family: string | null;
  currency: string | null;
  active: boolean | null;
  product: {
    name: string;
    description: string | null;
    selling_price_cents: number;
    total_cost_cents: 0;
    items_jsonb: {
      source: "legacy_product_catalog";
      legacyRecordId: string | null;
      legacyCode: string | null;
      family: string | null;
      currency: string | null;
      active: boolean | null;
    };
  };
};

export function mapLegacyPackagePricingRow(
  row: LegacyPackageExportRow
): LegacyPackageMapping | null {
  const legacySerialNumber = text(row.M_SerialNumber);
  const shopName = text(row.M_Shop_Name);
  const unitPriceCents = moneyToCents(row.M_Mrk_Cost_Standard);
  if (!legacySerialNumber || !shopName || unitPriceCents === null) return null;

  const packageItems = LEGACY_PACKAGE_FLAGS.flatMap(([legacyField, key, label]) =>
    isSelected(row[legacyField]) ? [{ key, label, legacyField }] : []
  );
  const discountPercent = percent(row.M_Mrk_EstFU_Discount);
  const estimateFollowUpOptions = ESTIMATE_FOLLOW_UP_FLAGS.flatMap(
    ([legacyField, key, label]) =>
      isSelected(row[legacyField])
        ? [{ key, label, legacyField, discountPercent }]
        : []
  );
  const selectedItems = packageItems.length + estimateFollowUpOptions.length;

  return {
    legacySerialNumber,
    shopName,
    product: {
      name: PACKAGE_PRODUCT_NAME,
      description:
        "Imported from PSG's legacy Advantage package export; per-shop selected pieces live on company_programs.customizations_jsonb.",
      selling_price_cents: unitPriceCents,
      items_jsonb: packageItems,
    },
    companyProgram: {
      quantity: 1,
      unit_price_cents: unitPriceCents,
      customizations_jsonb: {
        source: "legacy_advantage_package_export",
        legacySerialNumber,
        shopName,
        packageItems,
        estimateFollowUp: {
          discountPercent,
          options: estimateFollowUpOptions,
        },
        totalSelectedItems: selectedItems,
      },
    },
  };
}

export function mapLegacyPackagePricingRows(
  rows: readonly LegacyPackageExportRow[]
): LegacyPackageMapping[] {
  return rows.flatMap((row) => {
    const mapped = mapLegacyPackagePricingRow(row);
    return mapped ? [mapped] : [];
  });
}

export function buildLegacyPackageProgramUpsert({
  companyId,
  productId,
  mapping,
}: {
  companyId: string;
  productId: string;
  mapping: LegacyPackageMapping;
}): LegacyPackageProgramUpsert {
  return {
    company_id: companyId,
    product_id: productId,
    ...mapping.companyProgram,
  };
}

export function mapLegacyProductPricingRow(
  row: LegacyPackageExportRow
): LegacyProductMapping | null {
  const name = firstText(row, ["Product Name", "Name"]);
  const price = moneyToCents(firstValue(row, ["Standard Price", "Price (USD)", "Price"]));
  if (!name || price === null) return null;

  const legacyRecordId = firstText(row, ["Record ID", "\ufeffRecord ID", "\ufeffID", "ID"]) || null;
  const legacyCode = firstText(row, ["Product Code", "Product code"]) || null;
  const family = firstText(row, ["Product Family", "Category"]) || null;
  const currency = firstText(row, ["Currency"]) || null;
  const description = firstText(row, ["Description", "Product Description"]) || null;
  const active = boolish(firstValue(row, ["Active"]));

  return {
    legacyRecordId,
    name,
    legacyCode,
    family,
    currency,
    active,
    product: {
      name,
      description,
      selling_price_cents: price,
      total_cost_cents: 0,
      items_jsonb: {
        source: "legacy_product_catalog",
        legacyRecordId,
        legacyCode,
        family,
        currency,
        active,
      },
    },
  };
}

export function mapLegacyProductPricingRows(
  rows: readonly LegacyPackageExportRow[]
): LegacyProductMapping[] {
  return rows.flatMap((row) => {
    const mapped = mapLegacyProductPricingRow(row);
    return mapped ? [mapped] : [];
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstValue(row: LegacyPackageExportRow, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return null;
}

function firstText(row: LegacyPackageExportRow, keys: readonly string[]): string {
  const value = firstValue(row, keys);
  return text(value);
}

function isSelected(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "yes" ||
    normalized === "y" ||
    normalized === "true" ||
    normalized === "1"
  );
}

function moneyToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100);
}

function percent(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[%\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function boolish(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "n" || normalized === "0") {
    return false;
  }
  return null;
}
