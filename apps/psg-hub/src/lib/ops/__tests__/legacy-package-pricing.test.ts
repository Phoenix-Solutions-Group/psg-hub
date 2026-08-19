import { describe, expect, it } from "vitest";
import {
  buildLegacyPackageProgramUpsert,
  mapLegacyPackagePricingRow,
  mapLegacyPackagePricingRows,
  mapLegacyProductPricingRow,
  mapLegacyProductPricingRows,
} from "../pricing/legacy-package-pricing";

describe("legacy Advantage package pricing mapping", () => {
  it("maps a legacy package row into BSM product and company-program fields", () => {
    const mapped = mapLegacyPackagePricingRow({
      M_SerialNumber: "PS624",
      M_Shop_Name: "Alexander Collision Center",
      M_Mrk_ThankYou_ACRB: "Yes",
      M_Mrk_Warranty_ACRB: "Yes",
      M_Mrk_Survey: "Yes",
      M_Mrk_3Month: "Yes",
      M_Mrk_1Year: "Yes",
      M_Mrk_18Month: "Yes",
      M_Mrk_ReportCard: "Yes",
      M_Mrk_EstFU_Discount: "50",
      M_Mrk_EstFU_Flag_Bill: "Yes",
      M_Mrk_EstFU_Flag_Maze: "Yes",
      M_Mrk_Cost_Standard: "10.25",
    });

    expect(mapped).toMatchObject({
      legacySerialNumber: "PS624",
      shopName: "Alexander Collision Center",
      product: {
        name: "Legacy Advantage Program Package",
        selling_price_cents: 1025,
      },
      companyProgram: {
        quantity: 1,
        unit_price_cents: 1025,
      },
    });
    expect(mapped?.companyProgram.customizations_jsonb.packageItems.map((i) => i.key)).toEqual([
      "thank_you_standard",
      "warranty",
      "survey",
      "three_month",
      "one_year",
      "eighteen_month",
      "report_card",
    ]);
    expect(mapped?.companyProgram.customizations_jsonb.estimateFollowUp).toEqual({
      discountPercent: 50,
      options: [
        {
          key: "bill",
          label: "Bill",
          legacyField: "M_Mrk_EstFU_Flag_Bill",
          discountPercent: 50,
        },
        {
          key: "maze",
          label: "Maze",
          legacyField: "M_Mrk_EstFU_Flag_Maze",
          discountPercent: 50,
        },
      ],
    });
    expect(mapped?.companyProgram.customizations_jsonb.totalSelectedItems).toBe(9);
  });

  it("normalizes money fields to cents from numbers and currency strings", () => {
    expect(
      mapLegacyPackagePricingRow({
        M_SerialNumber: "PS105",
        M_Shop_Name: "America's Auto Body",
        M_Mrk_Cost_Standard: 19.5,
      })?.companyProgram.unit_price_cents
    ).toBe(1950);

    expect(
      mapLegacyPackagePricingRow({
        M_SerialNumber: "PS151",
        M_Shop_Name: "Jerry's Collision Center",
        M_Mrk_Cost_Standard: "$1,234.56",
      })?.companyProgram.unit_price_cents
    ).toBe(123456);
  });

  it("drops incomplete or zero-price legacy rows instead of creating unusable program rows", () => {
    const mapped = mapLegacyPackagePricingRows([
      {
        M_SerialNumber: "PS230",
        M_Shop_Name: "Phoenix Solutions Group",
        M_Mrk_Cost_Standard: "",
      },
      {
        M_SerialNumber: "",
        M_Shop_Name: "Missing serial",
        M_Mrk_Cost_Standard: "5.35",
      },
      {
        M_SerialNumber: "PS773",
        M_Shop_Name: "Tedesco Auto Body, Inc.",
        M_Mrk_Cost_Standard: "5.35",
      },
    ]);

    expect(mapped).toHaveLength(1);
    expect(mapped[0].legacySerialNumber).toBe("PS773");
    expect(mapped[0].companyProgram.unit_price_cents).toBe(535);
  });

  it("builds the idempotent company_programs upsert payload", () => {
    const mapping = mapLegacyPackagePricingRow({
      M_SerialNumber: "PS773",
      M_Shop_Name: "Tedesco Auto Body, Inc.",
      M_Mrk_ThankYou_ACRB: "Yes",
      M_Mrk_Cost_Standard: "5.35",
    });
    expect(mapping).not.toBeNull();

    const upsert = buildLegacyPackageProgramUpsert({
      companyId: "company-1",
      productId: "product-1",
      mapping: mapping!,
    });

    expect(upsert).toMatchObject({
      company_id: "company-1",
      product_id: "product-1",
      quantity: 1,
      unit_price_cents: 535,
    });
    expect(upsert.customizations_jsonb.source).toBe("legacy_advantage_package_export");
    expect(upsert.customizations_jsonb.legacySerialNumber).toBe("PS773");
  });

  it("maps legacy product and letter-cost rows into BSM products", () => {
    const mapped = mapLegacyProductPricingRow({
      "\ufeffID": "92",
      Name: "Post Repair Follow Up Letter",
      "Product code": "PSG_P_007",
      Category: "Advantage",
      "Price (USD)": "1.25",
      Currency: "USD",
      Active: "Yes",
      Description:
        "A shop branded personalized post repair letter printed in color and mailed using first-class postage",
    });

    expect(mapped).toMatchObject({
      legacyRecordId: "92",
      name: "Post Repair Follow Up Letter",
      legacyCode: "PSG_P_007",
      family: "Advantage",
      currency: "USD",
      active: true,
      product: {
        name: "Post Repair Follow Up Letter",
        description:
          "A shop branded personalized post repair letter printed in color and mailed using first-class postage",
        selling_price_cents: 125,
        total_cost_cents: 0,
      },
    });
    expect(mapped?.product.items_jsonb).toEqual({
      source: "legacy_product_catalog",
      legacyRecordId: "92",
      legacyCode: "PSG_P_007",
      family: "Advantage",
      currency: "USD",
      active: true,
    });
  });

  it("maps QBO-style Advantage package products and skips products without a usable price", () => {
    const mapped = mapLegacyProductPricingRows([
      {
        "Record ID": "155284",
        "Product Name": "Advantage - Basic + 3",
        "Product Family": "Advantage",
        Currency: "USD",
        "Standard Price": "10.25",
        Description:
          "Thank You Letter + Warranty; Customer Research Survey; (3) Additional Post Repair Follow Up Letters",
        Active: "TRUE",
      },
      {
        "Record ID": "155286",
        "Product Name": "Total Loss Letter",
        "Product Family": "Advantage",
        Currency: "USD",
        "Standard Price": 2.2,
        Active: "TRUE",
      },
      {
        "Record ID": "155000",
        "Product Name": "Missing Price",
        "Product Family": "Advantage",
        Currency: "USD",
        "Standard Price": "",
        Active: "TRUE",
      },
    ]);

    expect(mapped).toHaveLength(2);
    expect(mapped.map((p) => [p.name, p.product.selling_price_cents])).toEqual([
      ["Advantage - Basic + 3", 1025],
      ["Total Loss Letter", 220],
    ]);
  });
});
