import { describe, expect, it } from "vitest";

import {
  DEAL_BILLING_FIELD_KEYS,
  buildDealBillingAutofillPatch,
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

