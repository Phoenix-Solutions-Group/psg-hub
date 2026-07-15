#!/usr/bin/env node
// PSG-1616 — weekly drift detector for Pipedrive's Won billing gate.
//
// Scheduled check:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-won-billing-coverage-check.mjs
//
// The script is read-only and never prints the API token. It exits with code 1
// when the Won gate requires anything other than the exact 19 billing fields.

import process from "node:process";

const TOKEN_ENV_CANDIDATES = [
  "PIPEDRIVE_API_TOKEN",
  "PIPEDRIVE_TOKEN",
  "PIPEDRIVE_API_KEY",
];

export const PSG_SALES_PIPELINE_ID = 8;
export const WON_STAGE_ID = 61;

export const EXPECTED_WON_BILLING_REQUIRED_FIELDS = [
  { id: 12533, code: "55ea89f59464ce238ee7093bdf7282f7951c7129", name: "Signed Contract / Approval Link" },
  { id: 12534, code: "b7ed5ca4718ba9dc4c3a324f223de3f2a00de9be", name: "Contract Start Date" },
  { id: 12535, code: "4c4b2ff1ef59a56331fc2cdc3927e3b9c72c708a", name: "Expected Delivery Start Date" },
  { id: 12537, code: "c454180428b8e3ee69d817c44f825eacd489eeb3", name: "Sold Products / SKU Notes" },
  { id: 12540, code: "7a84a5c9286927e0b644d781e30c3c1b834bbdb1", name: "Billing Model" },
  { id: 12541, code: "f2bd200170a14cb937a5ce178fffec84e9a7c3c3", name: "Consolidated Invoicing Required" },
  { id: 12543, code: "c0a76c955f288460d1d472141df2574ac24a1d8d", name: "Billing Email" },
  { id: 12544, code: "5d5c27acc52d0ed92af361bc4dc0a87801477f4b", name: "Billing Address" },
  { id: 12545, code: "eaecf6080f4dc77a8533315844a8cc8663312aa2", name: "Legal Customer Name" },
  { id: 12546, code: "693a7054366858ca05ea41e760ead2f78f8efccb", name: "Purchase Order Requirement" },
  { id: 12547, code: "22e14ad62b154aa65b26492b8df61f6c338fab38", name: "Tax Exempt Status" },
  { id: 12548, code: "4047a088118caa2c0b353c000d33c5ac35ea2ed9", name: "One-Time Setup Fees" },
  { id: 12549, code: "1f19ed0b91dda56a12be3655eaf09934982c4c63", name: "Monthly Recurring Fees" },
  { id: 12551, code: "26112fa2328ef92aea1d87efa0af18e231841d8e", name: "First Invoice Date" },
  { id: 12554, code: "3025cb67fb88b6b548483e1a108f6d5b6b2ea362", name: "Delivery Template" },
  { id: 12555, code: "c5d5cd6efedd935b7320d5206cfeade7cad4bb56", name: "Missing Access List" },
  { id: 12556, code: "4edecfde7682e1565c0450fc087953a1c457c12f", name: "Asset Request List" },
  { id: 12572, code: "5461d82fd372f1e65195ac3689e3ac9bfdb7e1e9", name: "Payment Terms (deal)" },
  { id: 12576, code: "d318a4cf86fc9a9fae395cd7a4e8785862ded54c", name: "Billing Contact Name" },
];

function resolveToken(env = process.env) {
  for (const name of TOKEN_ENV_CANDIDATES) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function baseUrl(env = process.env) {
  const domain = (env.PIPEDRIVE_COMPANY_DOMAIN ?? env.PIPEDRIVE_DOMAIN ?? "").trim();
  if (!domain) return "https://api.pipedrive.com";
  const sub = domain.replace(/^https?:\/\//, "").replace(/\.pipedrive\.com.*$/, "");
  return `https://${sub}.pipedrive.com`;
}

function fieldCode(field) {
  return String(field?.field_code ?? field?.key ?? "");
}

function fieldName(field) {
  return String(field?.field_name ?? field?.name ?? field?.key ?? field?.field_code ?? "");
}

function hasWonStageRequirement(field, wonStageId = WON_STAGE_ID) {
  const stageIds = field?.required_fields?.stage_ids;
  return Array.isArray(stageIds) && stageIds.map(Number).includes(Number(wonStageId));
}

function compareValues(actualValues, expectedValues) {
  const actual = new Set(actualValues.map(String));
  const expected = new Set(expectedValues.map(String));
  return {
    missingValues: expectedValues.map(String).filter((value) => !actual.has(value)),
    unexpectedValues: actualValues.map(String).filter((value) => !expected.has(value)).sort(),
  };
}

function alertText({ missingNames, unexpectedNames }) {
  const parts = [];
  if (missingNames.length > 0) {
    parts.push(`lost coverage: ${missingNames.join(", ")} no longer required`);
  }
  if (unexpectedNames.length > 0) {
    parts.push(`unexpectedly requires: ${unexpectedNames.join(", ")}`);
  }
  if (parts.length === 0) return "";
  return `Won-gate billing check ${parts.join("; ")}. Finance may be unable to invoice new sales.`;
}

export function buildWonBillingCoverageCheck({
  dealFields,
  expectedFields = EXPECTED_WON_BILLING_REQUIRED_FIELDS,
  wonStageId = WON_STAGE_ID,
  pipelineId = PSG_SALES_PIPELINE_ID,
}) {
  const expectedCodes = expectedFields.map((field) => String(field.code));
  const expectedByCode = new Map(expectedFields.map((field) => [String(field.code), field]));
  const wonRequiredFields = dealFields
    .filter((field) => hasWonStageRequirement(field, wonStageId))
    .map((field) => ({
      code: fieldCode(field),
      name: fieldName(field),
      requiredFields: field?.required_fields ?? null,
    }))
    .filter((field) => field.code);
  const actualCodes = wonRequiredFields.map((field) => field.code);
  const actualByCode = new Map(wonRequiredFields.map((field) => [field.code, field]));
  const { missingValues: missingCodes, unexpectedValues: unexpectedCodes } = compareValues(
    actualCodes,
    expectedCodes,
  );
  const missingIds = missingCodes.map((code) => expectedByCode.get(code)?.id).filter(Number.isFinite);
  const unexpectedIds = unexpectedCodes
    .map((code) => Number(dealFields.find((field) => fieldCode(field) === code)?.id))
    .filter(Number.isFinite);
  const missingNames = missingCodes.map((code) => expectedByCode.get(code)?.name ?? `Field ${code}`);
  const unexpectedNames = unexpectedCodes.map((code) => actualByCode.get(code)?.name ?? `Field ${code}`);

  return {
    ok: missingCodes.length === 0 && unexpectedCodes.length === 0,
    pipelineId,
    wonStageId,
    expectedFieldCount: expectedCodes.length,
    actualFieldCount: actualCodes.length,
    missingIds,
    missingCodes,
    missingNames,
    unexpectedIds,
    unexpectedCodes,
    unexpectedNames,
    alertText: alertText({ missingNames, unexpectedNames }),
    expectedFields,
    actualFields: wonRequiredFields
      .map((field) => ({
        id: expectedByCode.get(field.code)?.id ?? null,
        code: field.code,
        name: field.name,
        requiredFields: field.requiredFields,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

class PipedriveReadApi {
  constructor({ token, base }) {
    this.token = token;
    this.base = base;
  }

  async request(path) {
    const url = new URL(`${this.base}/api/v2${path}`);
    url.searchParams.set("api_token", this.token);
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Pipedrive GET /api/v2${path} returned HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json?.success === false) throw new Error(`Pipedrive GET /api/v2${path} returned success=false`);
    return json;
  }

  async listDealFields() {
    const params = new URLSearchParams({
      limit: "500",
      include_fields: "required_fields",
    });
    const json = await this.request(`/dealFields?${params.toString()}`);
    return Array.isArray(json.data) ? json.data : [];
  }
}

async function main() {
  const token = resolveToken();
  if (!token) throw new Error(`Missing Pipedrive token. Set one of: ${TOKEN_ENV_CANDIDATES.join(", ")}`);

  const api = new PipedriveReadApi({ token, base: baseUrl() });
  const dealFields = await api.listDealFields();
  const check = buildWonBillingCoverageCheck({ dealFields });
  const result = {
    issue: "PSG-1616",
    generatedAt: new Date().toISOString(),
    sourceEndpoints: [
      "GET /api/v2/dealFields?limit=500&include_fields=required_fields",
    ],
    dealFieldsSeen: dealFields.length,
    ...check,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!check.ok) {
    console.error(check.alertText);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
