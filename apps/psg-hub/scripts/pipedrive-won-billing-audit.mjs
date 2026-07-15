#!/usr/bin/env node
// PSG-1610 — detect Won PSG Sales deals that bypassed Pipedrive's browser-only gate.
//
// Dry-run / scheduled check:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-won-billing-audit.mjs
//
// The script is read-only and never prints the API token. It exits with code 1
// when any Won PSG Sales deal is missing one or more canonical Won-gate fields.

import process from "node:process";

import {
  GATE_1_REQUIRED_FIELD_IDS,
  PSG_SALES_PIPELINE_ID,
} from "./pipedrive-won-gate-fix.mjs";

const TOKEN_ENV_CANDIDATES = [
  "PIPEDRIVE_API_TOKEN",
  "PIPEDRIVE_TOKEN",
  "PIPEDRIVE_API_KEY",
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

function isBlank(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const values = Object.values(value);
    return values.length === 0 || values.every(isBlank);
  }
  return false;
}

function fieldName(field) {
  return String(field?.name ?? field?.field_name ?? field?.key ?? field?.id ?? "");
}

function fieldKey(field) {
  return field?.key ?? field?.field_code ?? null;
}

export function buildWonBillingAudit({
  dealFields,
  wonDeals,
  pipelineId = PSG_SALES_PIPELINE_ID,
  requiredFieldIds = GATE_1_REQUIRED_FIELD_IDS,
}) {
  const activeFieldsById = new Map(
    dealFields
      .filter(
        (field) =>
          field?.active_flag !== false &&
          field?.deleted !== true &&
          field?.is_deleted !== true,
      )
      .map((field) => [Number(field.id), field]),
  );
  const requiredFields = requiredFieldIds.map((id) => {
    const field = activeFieldsById.get(Number(id));
    return {
      id: Number(id),
      key: fieldKey(field),
      name: fieldName(field),
      found: Boolean(field),
    };
  });
  const missingFieldDefinitions = requiredFields.filter((field) => !field.found || !field.key);
  const targetDeals = wonDeals.filter((deal) => Number(deal.pipeline_id) === Number(pipelineId));
  const violations = [];

  for (const deal of targetDeals) {
    const missingFields = requiredFields
      .filter((field) => field.key && isBlank(deal[field.key]))
      .map((field) => ({ id: field.id, key: field.key, name: field.name }));
    if (missingFields.length > 0) {
      violations.push({
        dealId: Number(deal.id),
        title: String(deal.title ?? ""),
        missingFields,
      });
    }
  }

  return {
    ok: violations.length === 0 && missingFieldDefinitions.length === 0,
    pipelineId,
    requiredFieldCount: requiredFields.length,
    dealsChecked: targetDeals.length,
    violationCount: violations.length,
    missingFieldDefinitions,
    violations,
  };
}

class PipedriveReadApi {
  constructor({ token, base }) {
    this.token = token;
    this.base = base;
  }

  async request(path) {
    const url = new URL(`${this.base}/api/v1${path}`);
    url.searchParams.set("api_token", this.token);
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Pipedrive GET ${path} returned HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json?.success === false) throw new Error(`Pipedrive GET ${path} returned success=false`);
    return json;
  }

  async listDealFields() {
    const json = await this.request("/dealFields");
    return Array.isArray(json.data) ? json.data : [];
  }

  async listWonDeals() {
    const out = [];
    for (let start = 0; start < 100000; start += 500) {
      const params = new URLSearchParams({
        status: "won",
        start: String(start),
        limit: "500",
      });
      const json = await this.request(`/deals?${params.toString()}`);
      out.push(...(Array.isArray(json.data) ? json.data : []));
      const pagination = json.additional_data?.pagination;
      if (!pagination?.more_items_in_collection) return out;
    }
    throw new Error("Pipedrive won-deal pagination exceeded 100000 rows");
  }
}

async function main() {
  const token = resolveToken();
  if (!token) throw new Error(`Missing Pipedrive token. Set one of: ${TOKEN_ENV_CANDIDATES.join(", ")}`);

  const api = new PipedriveReadApi({ token, base: baseUrl() });
  const [dealFields, wonDeals] = await Promise.all([
    api.listDealFields(),
    api.listWonDeals(),
  ]);
  const audit = buildWonBillingAudit({ dealFields, wonDeals });
  const result = {
    issue: "PSG-1610",
    generatedAt: new Date().toISOString(),
    sourceEndpoints: [
      "GET /api/v1/dealFields",
      "GET /api/v1/deals?status=won",
    ],
    ...audit,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!audit.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
