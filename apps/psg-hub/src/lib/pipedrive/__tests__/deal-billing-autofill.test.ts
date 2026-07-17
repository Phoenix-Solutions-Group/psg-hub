import { describe, expect, it } from "vitest";

import {
  DEAL_BILLING_FIELD_KEYS,
  DEAL_WON_GATE_FIELD_KEYS,
  buildDealBillingAutofillPatch,
  buildDealWonGateAutofillPatch,
  type PipedriveOrganizationBillingDetails,
} from "../deal-billing-autofill";

const org = (overrides: Partial<PipedriveOrganizationBillingDetails> = {}) => ({
  id: 9,
  name: "Wallace Collision",
  displayName: "Wallace Collision LLC",
  address: "123 Main St, Phoenix, AZ 85001",
  generalEmail: "billing@wallace.example",
  paymentTerms: "Net 15",
  ...overrides,
});

describe("deal billing auto-fill", () => {
  it("fills Group A deal billing fields from the linked organization when blank", () => {
    const result = buildDealBillingAutofillPatch({
      deal: {},
      organization: org(),
      billingContactName: "Pat Owner",
    });

    expect(result.patch).toEqual({
      [DEAL_BILLING_FIELD_KEYS.legalCustomerName]: "Wallace Collision LLC",
      [DEAL_BILLING_FIELD_KEYS.billingAddress]: "123 Main St, Phoenix, AZ 85001",
      [DEAL_BILLING_FIELD_KEYS.billingEmail]: "billing@wallace.example",
      [DEAL_BILLING_FIELD_KEYS.paymentTerms]: "NET 15 (standard)",
      [DEAL_BILLING_FIELD_KEYS.billingContactName]: "Pat Owner",
    });
    expect(result.filled.map((field) => field.dealFieldName)).toEqual([
      "Legal Customer Name",
      "Billing Address",
      "Billing Email",
      "Payment Terms (deal)",
      "Billing Contact Name",
    ]);
  });

  it("does not overwrite values already typed on the deal", () => {
    const result = buildDealBillingAutofillPatch({
      deal: {
        [DEAL_BILLING_FIELD_KEYS.billingEmail]: "rep-entered@example.com",
      },
      organization: org(),
      billingContactName: "Pat Owner",
    });

    expect(result.patch[DEAL_BILLING_FIELD_KEYS.billingEmail]).toBeUndefined();
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dealFieldName: "Billing Email",
          reason: "deal_already_has_value",
          sourceValue: "billing@wallace.example",
        }),
      ]),
    );
  });

  it("skips payment terms when the organization text has no clean enum mapping", () => {
    const result = buildDealBillingAutofillPatch({
      deal: {},
      organization: org({ paymentTerms: "half now, half later" }),
      billingContactName: "Pat Owner",
    });

    expect(result.patch[DEAL_BILLING_FIELD_KEYS.paymentTerms]).toBeUndefined();
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dealFieldName: "Payment Terms (deal)",
          reason: "unmapped_payment_terms",
          sourceValue: "half now, half later",
        }),
      ]),
    );
  });
});

describe("deal Won-gate auto-fill", () => {
  it("fills product notes and one-time fees from deal products when blank", () => {
    const result = buildDealWonGateAutofillPatch({
      deal: {},
      products: [
        {
          name: "Website Design & Build",
          sku: "PSG_P_026",
          quantity: 1,
          sum: 6500,
          billingFrequency: "one-time",
        },
        {
          name: "Landing Page Add-on",
          sku: null,
          quantity: 2,
          sum: 750,
          billingFrequency: "one-time",
        },
      ],
      signedContractUrl: null,
    });

    expect(result.patch).toEqual({
      [DEAL_WON_GATE_FIELD_KEYS.soldProductsSkuNotes]:
        "Website Design & Build (SKU PSG_P_026); Landing Page Add-on (qty 2)",
      [DEAL_WON_GATE_FIELD_KEYS.oneTimeSetupFees]: 7250,
    });
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dealFieldName: "Monthly Recurring Fees",
          reason: "no_recurring_products",
        }),
        expect.objectContaining({
          dealFieldName: "Signed Contract / Approval Link",
          reason: "source_blank",
        }),
      ]),
    );
  });

  it("fills monthly recurring fees only when at least one product is recurring", () => {
    const result = buildDealWonGateAutofillPatch({
      deal: {},
      products: [
        { name: "SEO Retainer", sku: "MRR_001", quantity: 1, sum: 1250, billingFrequency: "monthly" },
        { name: "CRM Setup", sku: null, quantity: 1, sum: 500, billingFrequency: "one-time" },
      ],
      signedContractUrl: "https://app.pandadoc.com/a/#/document/abc",
    });

    expect(result.patch).toEqual({
      [DEAL_WON_GATE_FIELD_KEYS.soldProductsSkuNotes]:
        "SEO Retainer (SKU MRR_001); CRM Setup",
      [DEAL_WON_GATE_FIELD_KEYS.oneTimeSetupFees]: 500,
      [DEAL_WON_GATE_FIELD_KEYS.monthlyRecurringFees]: 1250,
      [DEAL_WON_GATE_FIELD_KEYS.signedContractApprovalLink]:
        "https://app.pandadoc.com/a/#/document/abc",
    });
  });

  it("does not overwrite deal-side Won-gate values already typed by a rep", () => {
    const result = buildDealWonGateAutofillPatch({
      deal: {
        [DEAL_WON_GATE_FIELD_KEYS.soldProductsSkuNotes]: "rep-entered product notes",
        [DEAL_WON_GATE_FIELD_KEYS.monthlyRecurringFees]: 0,
      },
      products: [
        { name: "SEO Retainer", sku: "MRR_001", quantity: 1, sum: 1250, billingFrequency: "monthly" },
      ],
      signedContractUrl: null,
    });

    expect(result.patch[DEAL_WON_GATE_FIELD_KEYS.soldProductsSkuNotes]).toBeUndefined();
    expect(result.patch[DEAL_WON_GATE_FIELD_KEYS.monthlyRecurringFees]).toBeUndefined();
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dealFieldName: "Sold Products / SKU Notes",
          reason: "deal_already_has_value",
        }),
        expect.objectContaining({
          dealFieldName: "Monthly Recurring Fees",
          reason: "deal_already_has_value",
        }),
      ]),
    );
  });
});
