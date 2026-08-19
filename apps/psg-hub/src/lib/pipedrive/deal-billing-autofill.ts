export const DEAL_BILLING_FIELD_KEYS = {
  legalCustomerName: "eaecf6080f4dc77a8533315844a8cc8663312aa2",
  billingAddress: "5d5c27acc52d0ed92af361bc4dc0a87801477f4b",
  billingEmail: "c0a76c955f288460d1d472141df2574ac24a1d8d",
  paymentTerms: "5461d82fd372f1e65195ac3689e3ac9bfdb7e1e9",
  billingContactName: "d318a4cf86fc9a9fae395cd7a4e8785862ded54c",
} as const;

export const DEAL_WON_GATE_FIELD_KEYS = {
  signedContractApprovalLink: "55ea89f59464ce238ee7093bdf7282f7951c7129",
  expectedDeliveryStartDate: "4c4b2ff1ef59a56331fc2cdc3927e3b9c72c708a",
  soldProductsSkuNotes: "c454180428b8e3ee69d817c44f825eacd489eeb3",
  oneTimeSetupFees: "4047a088118caa2c0b353c000d33c5ac35ea2ed9",
  monthlyRecurringFees: "1f19ed0b91dda56a12be3655eaf09934982c4c63",
} as const;

export const ORG_BILLING_FIELD_KEYS = {
  displayName: "d6dfb1cfee548ef9e680962ddcbce413a3fda68d",
  generalEmail: "ab9a437a33140874fae9a97439852840975327ed",
  paymentTerms: "bd65fffd521173fe8a752bf3bac64476f4626415",
} as const;

export interface PipedriveOrganizationBillingDetails {
  id: number;
  name: string | null;
  displayName: string | null;
  address: string | null;
  generalEmail: string | null;
  paymentTerms: string | null;
}

export interface DealBillingAutofillResult {
  patch: Record<string, string>;
  filled: Array<{
    dealFieldKey: string;
    dealFieldName: string;
    sourceField: string;
    value: string;
  }>;
  skipped: Array<{
    dealFieldKey: string;
    dealFieldName: string;
    reason: "deal_already_has_value" | "source_blank" | "unmapped_payment_terms";
    sourceField: string;
    sourceValue?: string | null;
  }>;
}

export interface DealWonGateProduct {
  name: string;
  sku?: string | null;
  quantity?: number | null;
  sum?: number | null;
  billingFrequency?: string | null;
}

export interface DealWonGateAutofillResult {
  patch: Record<string, string | number>;
  filled: Array<{
    dealFieldKey: string;
    dealFieldName: string;
    sourceField: string;
    value: string | number;
  }>;
  skipped: Array<{
    dealFieldKey: string;
    dealFieldName: string;
    reason:
      | "deal_already_has_value"
      | "source_blank"
      | "no_products"
      | "no_recurring_products";
    sourceField: string;
    sourceValue?: string | number | null;
  }>;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function isBlankPipedriveValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0 || value.every(isBlankPipedriveValue);
  if (typeof value === "object") {
    const values = Object.values(value as Record<string, unknown>);
    return values.length === 0 || values.every(isBlankPipedriveValue);
  }
  return false;
}

function normalizePaymentTerms(value: string): string | null {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/[()]/g, "")
    .replace(/\./g, "");

  if (["due on receipt", "due upon receipt", "on receipt"].includes(normalized)) {
    return "Due on Receipt";
  }
  if (["net 7", "net7"].includes(normalized)) return "NET 7";
  if (["net 14", "net14"].includes(normalized)) return "NET 14";
  if (["net 15", "net15", "net 15 standard", "net15 standard"].includes(normalized)) {
    return "NET 15 (standard)";
  }
  if (["net 30", "net30"].includes(normalized)) return "NET 30";
  if (
    [
      "payment plan",
      "payment plan see special terms",
      "custom see notes",
      "custom",
    ].includes(normalized)
  ) {
    return "Payment Plan - see Special Terms";
  }
  return null;
}

function candidateRows(
  org: PipedriveOrganizationBillingDetails,
  billingContactName?: string | null,
): Array<{
  dealFieldKey: string;
  dealFieldName: string;
  sourceField: string;
  sourceValue: string | null;
  outputValue: string | null;
}> {
  const legalName = org.displayName ?? org.name;
  return [
    {
      dealFieldKey: DEAL_BILLING_FIELD_KEYS.legalCustomerName,
      dealFieldName: "Legal Customer Name",
      sourceField: "organization Display Name / Name",
      sourceValue: legalName,
      outputValue: legalName,
    },
    {
      dealFieldKey: DEAL_BILLING_FIELD_KEYS.billingAddress,
      dealFieldName: "Billing Address",
      sourceField: "organization Address",
      sourceValue: org.address,
      outputValue: org.address,
    },
    {
      dealFieldKey: DEAL_BILLING_FIELD_KEYS.billingEmail,
      dealFieldName: "Billing Email",
      sourceField: "organization General Email",
      sourceValue: org.generalEmail,
      outputValue: org.generalEmail,
    },
    {
      dealFieldKey: DEAL_BILLING_FIELD_KEYS.paymentTerms,
      dealFieldName: "Payment Terms (deal)",
      sourceField: "organization Payment Terms",
      sourceValue: org.paymentTerms,
      outputValue: org.paymentTerms ? normalizePaymentTerms(org.paymentTerms) : null,
    },
    {
      dealFieldKey: DEAL_BILLING_FIELD_KEYS.billingContactName,
      dealFieldName: "Billing Contact Name",
      sourceField: "linked primary person name",
      sourceValue: billingContactName ?? null,
      outputValue: billingContactName ?? null,
    },
  ];
}

export function buildDealBillingAutofillPatch({
  deal,
  organization,
  billingContactName,
}: {
  deal: Record<string, unknown>;
  organization: PipedriveOrganizationBillingDetails;
  billingContactName?: string | null;
}): DealBillingAutofillResult {
  const result: DealBillingAutofillResult = { patch: {}, filled: [], skipped: [] };

  for (const row of candidateRows(organization, clean(billingContactName))) {
    if (!isBlankPipedriveValue(deal[row.dealFieldKey])) {
      result.skipped.push({
        dealFieldKey: row.dealFieldKey,
        dealFieldName: row.dealFieldName,
        sourceField: row.sourceField,
        sourceValue: row.sourceValue,
        reason: "deal_already_has_value",
      });
      continue;
    }
    if (row.sourceValue && !row.outputValue && row.dealFieldKey === DEAL_BILLING_FIELD_KEYS.paymentTerms) {
      result.skipped.push({
        dealFieldKey: row.dealFieldKey,
        dealFieldName: row.dealFieldName,
        sourceField: row.sourceField,
        sourceValue: row.sourceValue,
        reason: "unmapped_payment_terms",
      });
      continue;
    }
    if (!row.outputValue) {
      result.skipped.push({
        dealFieldKey: row.dealFieldKey,
        dealFieldName: row.dealFieldName,
        sourceField: row.sourceField,
        sourceValue: row.sourceValue,
        reason: "source_blank",
      });
      continue;
    }

    result.patch[row.dealFieldKey] = row.outputValue;
    result.filled.push({
      dealFieldKey: row.dealFieldKey,
      dealFieldName: row.dealFieldName,
      sourceField: row.sourceField,
      value: row.outputValue,
    });
  }

  return result;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isRecurringFrequency(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
  return [
    "monthly",
    "month",
    "recurring",
    "subscription",
    "quarterly",
    "annual",
    "annually",
    "yearly",
    "weekly",
  ].includes(normalized);
}

function productLineLabel(product: DealWonGateProduct): string | null {
  const name = clean(product.name);
  if (!name) return null;
  const sku = clean(product.sku);
  const quantity =
    typeof product.quantity === "number" && Number.isFinite(product.quantity)
      ? product.quantity
      : null;
  const details = [
    sku ? `SKU ${sku}` : null,
    quantity != null && quantity !== 1 ? `qty ${quantity}` : null,
  ].filter((part): part is string => part != null);
  return details.length > 0 ? `${name} (${details.join(", ")})` : name;
}

function addWonGatePatchValue(
  result: DealWonGateAutofillResult,
  deal: Record<string, unknown>,
  row: {
    dealFieldKey: string;
    dealFieldName: string;
    sourceField: string;
    sourceValue: string | number | null;
    outputValue: string | number | null;
    blankReason?: DealWonGateAutofillResult["skipped"][number]["reason"];
  },
): void {
  if (!isBlankPipedriveValue(deal[row.dealFieldKey])) {
    result.skipped.push({
      dealFieldKey: row.dealFieldKey,
      dealFieldName: row.dealFieldName,
      sourceField: row.sourceField,
      sourceValue: row.sourceValue,
      reason: "deal_already_has_value",
    });
    return;
  }
  if (row.outputValue == null || row.outputValue === "") {
    result.skipped.push({
      dealFieldKey: row.dealFieldKey,
      dealFieldName: row.dealFieldName,
      sourceField: row.sourceField,
      sourceValue: row.sourceValue,
      reason: row.blankReason ?? "source_blank",
    });
    return;
  }
  result.patch[row.dealFieldKey] = row.outputValue;
  result.filled.push({
    dealFieldKey: row.dealFieldKey,
    dealFieldName: row.dealFieldName,
    sourceField: row.sourceField,
    value: row.outputValue,
  });
}

export function buildDealWonGateAutofillPatch({
  deal,
  products,
  signedContractUrl,
}: {
  deal: Record<string, unknown>;
  products: readonly DealWonGateProduct[];
  signedContractUrl?: string | null;
}): DealWonGateAutofillResult {
  const result: DealWonGateAutofillResult = { patch: {}, filled: [], skipped: [] };
  const productLabels = products
    .map(productLineLabel)
    .filter((label): label is string => label != null);
  const oneTimeTotal = roundMoney(
    products
      .filter((product) => !isRecurringFrequency(product.billingFrequency))
      .reduce((sum, product) => sum + (Number.isFinite(product.sum) ? Number(product.sum) : 0), 0),
  );
  const recurringProducts = products.filter((product) =>
    isRecurringFrequency(product.billingFrequency),
  );
  const recurringTotal = roundMoney(
    recurringProducts.reduce(
      (sum, product) => sum + (Number.isFinite(product.sum) ? Number(product.sum) : 0),
      0,
    ),
  );

  addWonGatePatchValue(result, deal, {
    dealFieldKey: DEAL_WON_GATE_FIELD_KEYS.soldProductsSkuNotes,
    dealFieldName: "Sold Products / SKU Notes",
    sourceField: "deal products",
    sourceValue: productLabels.join("; ") || null,
    outputValue: productLabels.join("; ") || null,
    blankReason: products.length === 0 ? "no_products" : "source_blank",
  });
  addWonGatePatchValue(result, deal, {
    dealFieldKey: DEAL_WON_GATE_FIELD_KEYS.oneTimeSetupFees,
    dealFieldName: "One-Time Setup Fees",
    sourceField: "deal products with one-time billing frequency",
    sourceValue: oneTimeTotal,
    outputValue: products.length > 0 ? oneTimeTotal : null,
    blankReason: "no_products",
  });
  addWonGatePatchValue(result, deal, {
    dealFieldKey: DEAL_WON_GATE_FIELD_KEYS.monthlyRecurringFees,
    dealFieldName: "Monthly Recurring Fees",
    sourceField: "deal products with recurring billing frequency",
    sourceValue: recurringTotal,
    outputValue: recurringProducts.length > 0 ? recurringTotal : null,
    blankReason: recurringProducts.length === 0 ? "no_recurring_products" : "source_blank",
  });
  addWonGatePatchValue(result, deal, {
    dealFieldKey: DEAL_WON_GATE_FIELD_KEYS.signedContractApprovalLink,
    dealFieldName: "Signed Contract / Approval Link",
    sourceField: "PandaDoc signed document URL",
    sourceValue: clean(signedContractUrl),
    outputValue: clean(signedContractUrl),
  });

  return result;
}
