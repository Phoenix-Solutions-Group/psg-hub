#!/usr/bin/env node
// PSG-1554 — retire duplicate Pipedrive Won-gate fields and re-point Gate 1.
//
// Dry-run:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-won-gate-fix.mjs
// Apply:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-won-gate-fix.mjs --apply

import { writeFile, mkdir } from "node:fs/promises";
import process from "node:process";

const TOKEN_ENV_CANDIDATES = [
  "PIPEDRIVE_API_TOKEN",
  "PIPEDRIVE_TOKEN",
  "PIPEDRIVE_API_KEY",
];

export const PSG_SALES_PIPELINE_ID = 8;
export const HANDOFF_COMPLETE_FIELD_ID = 12563;

export const GATE_1_REQUIRED_FIELD_IDS = [
  12533,
  12534,
  12540,
  12541,
  12545,
  12567,
  12543,
  12548,
  12549,
  12551,
  12572,
  12554,
  12555,
  12556,
];

export const OPTIONAL_FIELD_IDS = [12536, 12570, 12571];

export const GATE_2_FIELD_IDS = [12553, 12557, 12558, 12559, 12560];

export const RETIRED_FIELD_IDS = [
  12542,
  12550,
  12552,
  12564,
  12565,
  12566,
  12568,
  12569,
  12573,
  12574,
  12575,
];

export const DELIVERY_TEMPLATE_FIELD_ID = 12554;
export const DELIVERY_TEMPLATE_OPTIONS = [
  "New-client onboarding",
  "New Website Build",
  "Custom Delivery Project",
  "Needs Production decision",
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

function optionLabels(field) {
  return Array.isArray(field?.options)
    ? field.options.map((option) => String(option.label ?? "")).filter(Boolean)
    : [];
}

function optionRows(field) {
  return Array.isArray(field?.options)
    ? field.options.filter((option) => option && option.id != null)
    : [];
}

function expectedRequired() {
  return {
    enabled: true,
    stage_ids: [],
    statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["won"] },
  };
}

function requiredMatches(actual, expected = expectedRequired()) {
  return (
    Boolean(actual?.enabled) === expected.enabled &&
    JSON.stringify(actual?.stage_ids ?? []) === JSON.stringify(expected.stage_ids) &&
    JSON.stringify(actual?.statuses ?? {}) === JSON.stringify(expected.statuses)
  );
}

function sortLabels(labels) {
  return [...labels].sort((a, b) => a.localeCompare(b));
}

function sameLabels(a, b) {
  return JSON.stringify(sortLabels(a)) === JSON.stringify(sortLabels(b));
}

function fieldSummary(field, fieldV2) {
  return {
    id: field?.id ?? null,
    key: field?.key ?? fieldV2?.field_code ?? null,
    name: field?.name ?? fieldV2?.field_name ?? null,
    type: field?.field_type ?? fieldV2?.field_type ?? null,
    active: field
      ? field.active_flag !== false && field.deleted !== true && field.is_deleted !== true
      : false,
    required_fields: fieldV2?.required_fields ?? null,
    options: optionLabels(field),
  };
}

export function buildPlan({ fieldsV1, fieldsV2, openDeals }) {
  const byId = new Map(fieldsV1.map((field) => [Number(field.id), field]));
  const byCodeV2 = new Map(fieldsV2.map((field) => [String(field.field_code), field]));
  const getV2 = (field) => byCodeV2.get(String(field?.key));
  const actions = [];
  const errors = [];

  for (const id of GATE_1_REQUIRED_FIELD_IDS) {
    const field = byId.get(id);
    const fieldV2 = getV2(field);
    if (!field) {
      errors.push(`Gate 1 field ${id} was not found`);
      continue;
    }
    if (field.active_flag === false || field.deleted === true || field.is_deleted === true) {
      errors.push(`Gate 1 field ${id} (${field.name}) is already retired`);
      continue;
    }
    if (!fieldV2?.required_fields || !requiredMatches(fieldV2.required_fields)) {
      actions.push({
        type: "requireGate1Field",
        id,
        fieldCode: field.key,
        fieldName: field.name,
        body: {
          required_fields: expectedRequired(),
          ui_visibility: {
            add_visible_flag: true,
            details_visible_flag: true,
            projects_detail_visible_flag: true,
            show_in_pipelines: { show_in_all: false, pipeline_ids: [PSG_SALES_PIPELINE_ID] },
          },
        },
      });
    }
  }

  for (const id of OPTIONAL_FIELD_IDS) {
    const field = byId.get(id);
    const fieldV2 = getV2(field);
    if (!field) {
      errors.push(`Optional field ${id} was not found`);
      continue;
    }
    if (fieldV2?.required_fields?.enabled) {
      actions.push({
        type: "clearOptionalRequired",
        id,
        fieldCode: field.key,
        fieldName: field.name,
        body: {
          required_fields: { enabled: false, stage_ids: [], statuses: {} },
        },
      });
    }
  }

  for (const id of GATE_2_FIELD_IDS) {
    const field = byId.get(id);
    const fieldV2 = getV2(field);
    if (!field) {
      errors.push(`Gate 2 field ${id} was not found`);
      continue;
    }
    if (fieldV2?.required_fields?.enabled) {
      actions.push({
        type: "clearGate2ApiRequired",
        id,
        fieldCode: field.key,
        fieldName: field.name,
        body: {
          required_fields: { enabled: false, stage_ids: [], statuses: {} },
        },
      });
    }
  }

  const template = byId.get(DELIVERY_TEMPLATE_FIELD_ID);
  const templateLabels = optionLabels(template);
  if (!template) {
    errors.push(`Delivery Template field ${DELIVERY_TEMPLATE_FIELD_ID} was not found`);
  } else if (!sameLabels(templateLabels, DELIVERY_TEMPLATE_OPTIONS)) {
    const existingOptions = optionRows(template);
    const rename = DELIVERY_TEMPLATE_OPTIONS.map((label, index) => {
      const option = existingOptions[index];
      return option ? { id: option.id, label } : null;
    }).filter(Boolean);
    const usedOptionIds = new Set(rename.map((option) => option.id));
    const remove = existingOptions
      .filter((option) => !usedOptionIds.has(option.id))
      .map((option) => ({ id: option.id }));
    const add = DELIVERY_TEMPLATE_OPTIONS.slice(rename.length).map((label) => ({ label }));
    actions.push({
      type: "syncDeliveryTemplateOptions",
      id: DELIVERY_TEMPLATE_FIELD_ID,
      fieldCode: template.key,
      fieldName: template.name,
      currentOptions: templateLabels,
      desiredOptions: DELIVERY_TEMPLATE_OPTIONS,
      rename,
      remove,
      add,
    });
  }

  for (const id of RETIRED_FIELD_IDS) {
    const field = byId.get(id);
    if (!field) {
      continue;
    }
    if (field.active_flag !== false && field.deleted !== true && field.is_deleted !== true) {
      actions.push({
        type: "retireDealField",
        id,
        fieldCode: field.key,
        fieldName: field.name,
      });
    }
  }

  const retirementKeys = new Set(
    RETIRED_FIELD_IDS
      .map((id) => byId.get(id)?.key)
      .filter(Boolean),
  );
  const nonBlankRetiredDealValues = [];
  for (const deal of openDeals) {
    for (const key of retirementKeys) {
      const value = deal[key];
      if (value != null && value !== "") {
        nonBlankRetiredDealValues.push({ dealId: deal.id, fieldCode: key });
      }
    }
  }
  const targetKeys = new Set(
    [...GATE_1_REQUIRED_FIELD_IDS, ...OPTIONAL_FIELD_IDS, ...GATE_2_FIELD_IDS, HANDOFF_COMPLETE_FIELD_ID, ...RETIRED_FIELD_IDS]
      .map((id) => byId.get(id)?.key)
      .filter(Boolean),
  );
  const nonBlankTargetDealValues = [];
  for (const deal of openDeals) {
    for (const key of targetKeys) {
      const value = deal[key];
      if (value != null && value !== "") {
        nonBlankTargetDealValues.push({ dealId: deal.id, fieldCode: key });
      }
    }
  }
  if (nonBlankTargetDealValues.length > 0) {
    errors.push(
      `Open deals have nonblank values in target fields; refusing to apply without data migration (${nonBlankTargetDealValues.length} value(s))`,
    );
  }

  const verification = {
    gate1: GATE_1_REQUIRED_FIELD_IDS.map((id) => {
      const field = byId.get(id);
      return fieldSummary(field, getV2(field));
    }),
    optional: OPTIONAL_FIELD_IDS.map((id) => {
      const field = byId.get(id);
      return fieldSummary(field, getV2(field));
    }),
    gate2: GATE_2_FIELD_IDS.map((id) => {
      const field = byId.get(id);
      return fieldSummary(field, getV2(field));
    }),
    handoffComplete: fieldSummary(byId.get(HANDOFF_COMPLETE_FIELD_ID), getV2(byId.get(HANDOFF_COMPLETE_FIELD_ID))),
    retired: RETIRED_FIELD_IDS.map((id) => {
      const field = byId.get(id);
      return fieldSummary(field, getV2(field));
    }),
    openDealNonBlankRetiredValues: nonBlankRetiredDealValues,
    openDealNonBlankTargetValues: nonBlankTargetDealValues,
  };

  return { actions, errors, verification };
}

class PipedriveApi {
  constructor({ token, base }) {
    this.token = token;
    this.base = base;
  }

  async request(method, version, path, body) {
    const url = new URL(`${this.base}/api/${version}/${path}`);
    url.searchParams.set("api_token", this.token);
    const res = await fetch(url, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok || json?.success === false) {
      throw new Error(`Pipedrive ${method} /api/${version}/${path} returned HTTP ${res.status}`);
    }
    return json;
  }

  async listDealFieldsV1() {
    const json = await this.request("GET", "v1", "dealFields", null);
    return Array.isArray(json.data) ? json.data : [];
  }

  async listDealFieldsV2() {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 100; page += 1) {
      const params = new URLSearchParams({
        limit: "500",
        include_fields: "ui_visibility,required_fields",
      });
      if (cursor) params.set("cursor", cursor);
      const json = await this.request("GET", "v2", `dealFields?${params.toString()}`, null);
      out.push(...(Array.isArray(json.data) ? json.data : []));
      cursor = json.additional_data?.next_cursor ?? null;
      if (!cursor) return out;
    }
    throw new Error("Pipedrive dealFields pagination exceeded 100 pages");
  }

  async listDeals() {
    const out = [];
    let start = 0;
    for (let page = 0; page < 100; page += 1) {
      const params = new URLSearchParams({
        status: "all_not_deleted",
        start: String(start),
        limit: "500",
      });
      const json = await this.request("GET", "v1", `deals?${params.toString()}`, null);
      out.push(...(Array.isArray(json.data) ? json.data : []));
      if (!json.additional_data?.pagination?.more_items_in_collection) return out;
      start = Number(json.additional_data.pagination.next_start);
      if (!Number.isFinite(start)) throw new Error("Pipedrive deals pagination did not return next_start");
    }
    throw new Error("Pipedrive deals pagination exceeded 100 pages");
  }

  async applyAction(action) {
    if (
      action.type === "requireGate1Field" ||
      action.type === "clearOptionalRequired" ||
      action.type === "clearGate2ApiRequired"
    ) {
      await this.request("PATCH", "v2", `dealFields/${encodeURIComponent(action.fieldCode)}`, action.body);
      return;
    }
    if (action.type === "syncDeliveryTemplateOptions") {
      if (action.rename.length > 0) {
        await this.request(
          "PATCH",
          "v2",
          `dealFields/${encodeURIComponent(action.fieldCode)}/options`,
          action.rename,
        );
      }
      if (action.remove.length > 0) {
        await this.request(
          "DELETE",
          "v2",
          `dealFields/${encodeURIComponent(action.fieldCode)}/options`,
          action.remove,
        );
      }
      if (action.add.length > 0) {
        await this.request(
          "POST",
          "v2",
          `dealFields/${encodeURIComponent(action.fieldCode)}/options`,
          action.add,
        );
      }
      return;
    }
    if (action.type === "retireDealField") {
      await this.request("DELETE", "v2", `dealFields/${encodeURIComponent(action.fieldCode)}`, null);
      return;
    }
    throw new Error(`Unsupported action type: ${action.type}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const token = resolveToken();
  if (!token) throw new Error(`Missing Pipedrive token. Set one of: ${TOKEN_ENV_CANDIDATES.join(", ")}`);

  const api = new PipedriveApi({ token, base: baseUrl() });
  const [fieldsV1, fieldsV2, deals] = await Promise.all([
    api.listDealFieldsV1(),
    api.listDealFieldsV2(),
    api.listDeals(),
  ]);
  let plan = buildPlan({ fieldsV1, fieldsV2, openDeals: deals });
  if (plan.errors.length) {
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...plan }, null, 2));
    throw new Error(plan.errors.join("; "));
  }

  const applied = [];
  if (apply) {
    for (const action of plan.actions) {
      await api.applyAction(action);
      applied.push({ type: action.type, id: action.id, fieldName: action.fieldName });
    }
    const [afterFieldsV1, afterFieldsV2, afterDeals] = await Promise.all([
      api.listDealFieldsV1(),
      api.listDealFieldsV2(),
      api.listDeals(),
    ]);
    plan = buildPlan({
      fieldsV1: afterFieldsV1,
      fieldsV2: afterFieldsV2,
      openDeals: afterDeals,
    });
  }

  const result = {
    issue: "PSG-1554",
    mode: apply ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    sourceEndpoints: [
      "GET /api/v1/dealFields",
      "GET /api/v2/dealFields?include_fields=ui_visibility,required_fields",
      "GET /api/v1/deals?status=all_not_deleted",
    ],
    counts: {
      plannedActions: plan.actions.length,
      appliedActions: applied.length,
      gate1RequiredFields: GATE_1_REQUIRED_FIELD_IDS.length,
      optionalFields: OPTIONAL_FIELD_IDS.length,
      gate2Fields: GATE_2_FIELD_IDS.length,
      retiredFields: RETIRED_FIELD_IDS.length,
      dealsChecked: deals.length,
    },
    decisions: {
      gate1:
        "The 14 approved fields are required when a PSG Sales pipeline deal is marked won: statuses {\"8\":[\"won\"]}.",
      gate2:
        "Pipedrive required_fields does not expose an API field-to-field rule for 'before Handoff Complete'. Delivery-pipeline stage 63 rules are cleared; PSG Hub's Pipedrive Projects client blocks Handoff Complete=Yes when fields 17-21 are blank.",
      d7:
        "The API accepted and re-read required_fields through v2 dealFields. If the browser does not block an incomplete Won move, the Pipedrive plan lacks Required Fields and Nick must handle the plan/operator decision.",
      apiBypass:
        "Pipedrive required fields apply to web UI interactions. PSG API scripts can bypass them; treat this as a known limit until a separate code guard validates won-deal patches before writing status=won.",
    },
    applied,
    remainingActions: plan.actions,
    errors: plan.errors,
    verification: plan.verification,
  };

  const outDir = new URL("../../../artifacts/PSG-1554/", import.meta.url);
  await mkdir(outDir, { recursive: true });
  const name = apply ? "pipedrive_won_gate_fix_apply_summary.json" : "pipedrive_won_gate_fix_dry-run_summary.json";
  await writeFile(new URL(name, outDir), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
