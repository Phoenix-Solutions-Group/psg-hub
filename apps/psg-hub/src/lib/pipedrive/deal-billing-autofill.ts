export const DEAL_BILLING_FIELD_KEYS = {
  legalCustomerName: "eaecf6080f4dc77a8533315844a8cc8663312aa2",
  billingAddress: "5d5c27acc52d0ed92af361bc4dc0a87801477f4b",
  billingEmail: "c0a76c955f288460d1d472141df2574ac24a1d8d",
  paymentTerms: "5461d82fd372f1e65195ac3689e3ac9bfdb7e1e9",
  billingContactName: "d318a4cf86fc9a9fae395cd7a4e8785862ded54c",
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

