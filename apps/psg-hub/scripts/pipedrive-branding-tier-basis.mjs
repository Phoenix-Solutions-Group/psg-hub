#!/usr/bin/env node
// PSG-1757 — create Branding Tier Basis deal fields and audit filter in Pipedrive.
//
// Dry-run:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-branding-tier-basis.mjs
// Apply safe field + filter setup:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-branding-tier-basis.mjs --apply
// Also require fields at PSG Sales / Proposal Sent (broad gate, affects all PSG Sales quotes):
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-branding-tier-basis.mjs --apply --require-proposal-sent
// Export the first closed branding jobs with estimated-vs-actual hours:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-branding-tier-basis.mjs --actual-hours-report

import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const TOKEN_ENV_CANDIDATES = ["PIPEDRIVE_API_TOKEN", "PIPEDRIVE_TOKEN", "PIPEDRIVE_API_KEY"];

export const PSG_SALES_PIPELINE_ID = 8;
export const PROPOSAL_SENT_STAGE_ID = 59;
export const AUDIT_FILTER_NAME = "Branding audit - Proposal Sent missing Tier Basis";
export const ACTUAL_HOURS_REPORT_LIMIT = 3;

export const BRANDING_PHASES = [
  { id: 1, name: "Discovery & Brand Audit", gate: "A-GATE" },
  { id: 2, name: "Concept Development", gate: "D-GATE" },
  { id: 3, name: "Review & Refinement", gate: "R-GATE" },
  { id: 4, name: "Delivery & Rollout Handoff", gate: "F-GATE" },
];

export const BRANDING_TIER_ESTIMATES = {
  "T1 Brand Mark": {
    designHours: 27,
    pmHours: 5,
    phases: {
      1: { designHours: 3, pmHours: 1.5 },
      2: { designHours: 11, pmHours: 1 },
      3: { designHours: 9, pmHours: 1.5 },
      4: { designHours: 4, pmHours: 1 },
    },
  },
  "T2 Brand Identity System": {
    designHours: 50,
    pmHours: 8,
    phases: {
      1: { designHours: 8, pmHours: 2.5 },
      2: { designHours: 14, pmHours: 1.5 },
      3: { designHours: 15, pmHours: 2 },
      4: { designHours: 13, pmHours: 2 },
    },
  },
  "T3 Identity + Rollout": {
    designHours: 70,
    pmHours: 14,
    phases: {
      1: { designHours: 12, pmHours: 3 },
      2: { designHours: 23, pmHours: 3 },
      3: { designHours: 21, pmHours: 3 },
      4: { designHours: 14, pmHours: 5 },
    },
  },
};

export const TIER_BASIS_FIELDS = [
  {
    name: "Tier Basis - Q1 What's driving this",
    type: "enum",
    options: [
      "New ownership or name change",
      "Refresh - current look is dated",
      "Other",
    ],
  },
  {
    name: "Tier Basis - Q2 Surfaces carrying the mark today",
    type: "double",
  },
  {
    name: "Tier Basis - Q3 Locations / vehicles",
    type: "varchar",
  },
  {
    name: "Tier Basis - Q4 Vendor specs needed",
    type: "enum",
    options: [
      "PSG specs and coordinates vendors",
      "Client has a vendor - files only",
    ],
  },
  {
    name: "Tier Basis - Q5 Brand guide needed",
    type: "enum",
    options: ["Full brand guide", "1-page usage sheet", "Logo files only"],
  },
  {
    name: "Tier Basis - Tier selected",
    type: "enum",
    options: ["T1 Brand Mark", "T2 Brand Identity System", "T3 Identity + Rollout"],
  },
  {
    name: "Tier Basis - Date asked",
    type: "date",
  },
  {
    name: "Tier Basis - Answered by",
    type: "varchar",
  },
];

export const ACTUAL_HOURS_FIELDS = [
  ...BRANDING_PHASES.flatMap((phase) => [
    {
      name: `phase${phase.id}_design_hours_actual`,
      type: "double",
      description:
        `PSG-1779: actual design hours for Branding phase ${phase.id} (${phase.name}), recorded before ${phase.gate} closes. Round to the nearest 0.5 hour. Attribute hours by the ROLE the PSG-658 graph assigns to the task, never by who did the work.`,
    },
    {
      name: `phase${phase.id}_pm_hours_actual`,
      type: "double",
      description:
        `PSG-1779: actual project-management hours for Branding phase ${phase.id} (${phase.name}), recorded before ${phase.gate} closes. Round to the nearest 0.5 hour. Attribute hours by the ROLE the PSG-658 graph assigns to the task, never by who did the work.`,
    },
  ]),
  {
    name: "change_order_design_hours",
    type: "double",
    description:
      "PSG-1779: design hours sold on a D5 change order. Keep these out of phase totals so out-of-scope paid work does not make fixed-scope delivery look over budget. Round to the nearest 0.5 hour.",
  },
  {
    name: "change_order_pm_hours",
    type: "double",
    description:
      "PSG-1779: project-management hours sold on a D5 change order. Keep these out of phase totals so out-of-scope paid work does not make fixed-scope delivery look over budget. Round to the nearest 0.5 hour.",
  },
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

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function optionLabels(field) {
  return Array.isArray(field?.options)
    ? field.options.map((option) => String(option.label ?? "")).filter(Boolean)
    : [];
}

function visibleInSales() {
  return {
    ui_visibility: {
      add_visible_flag: true,
      details_visible_flag: true,
      projects_detail_visible_flag: true,
      show_in_pipelines: { show_in_all: false, pipeline_ids: [PSG_SALES_PIPELINE_ID] },
    },
  };
}

function requiredFields(requireProposalSent) {
  return requireProposalSent
    ? { enabled: true, stage_ids: [PROPOSAL_SENT_STAGE_ID], statuses: {} }
    : { enabled: false, stage_ids: [], statuses: {} };
}

function requiredMatches(actual, expected) {
  return (
    Boolean(actual?.enabled) === expected.enabled &&
    JSON.stringify((actual?.stage_ids ?? []).map(Number).sort((a, b) => a - b)) ===
      JSON.stringify((expected.stage_ids ?? []).map(Number).sort((a, b) => a - b)) &&
    JSON.stringify(actual?.statuses ?? {}) === JSON.stringify(expected.statuses ?? {})
  );
}

function visibilityMatches(actual) {
  const pipelines = actual?.show_in_pipelines ?? {};
  return (
    actual?.add_visible_flag === true &&
    actual?.details_visible_flag === true &&
    actual?.projects_detail_visible_flag === true &&
    pipelines.show_in_all === false &&
    JSON.stringify((pipelines.pipeline_ids ?? []).map(Number).sort((a, b) => a - b)) ===
      JSON.stringify([PSG_SALES_PIPELINE_ID])
  );
}

function fieldByName(fields, name) {
  return fields.find((field) => clean(field.name ?? field.field_name) === clean(name)) ?? null;
}

function fieldKeyByName(fields, name) {
  const field = fieldByName(fields, name);
  return field?.key ?? field?.field_code ?? null;
}

function readNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function readDate(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function variancePct(actual, expected) {
  return expected && actual != null ? Number((((actual - expected) / expected) * 100).toFixed(1)) : null;
}

function sumNumbers(values) {
  let total = 0;
  for (const value of values) {
    if (value == null) return null;
    total += value;
  }
  return total;
}

function filterConditions(fieldIds) {
  return {
    glue: "and",
    conditions: [
      {
        glue: "and",
        conditions: [
          {
            object: "deal",
            field_id: "12462",
            operator: "=",
            value: String(PSG_SALES_PIPELINE_ID),
            extra_value: null,
          },
          {
            object: "deal",
            field_id: "12464",
            operator: "=",
            value: String(PROPOSAL_SENT_STAGE_ID),
            extra_value: null,
          },
        ],
      },
      {
        glue: "or",
        conditions: fieldIds.map((id) => ({
          object: "deal",
          field_id: String(id),
          operator: "IS NULL",
          value: null,
          extra_value: null,
        })),
      },
    ],
  };
}

export function buildPlan({ fieldsV1, fieldsV2, filters, requireProposalSent = false }) {
  const actions = [];
  const unresolved = [];
  const notices = [];
  const createdOrExisting = [];
  const existingV2ByCode = new Map(fieldsV2.map((field) => [String(field.field_code), field]));
  const existingFilter = filters.find((filter) => clean(filter.name) === clean(AUDIT_FILTER_NAME)) ?? null;

  for (const spec of [
    ...TIER_BASIS_FIELDS.map((field) => ({ ...field, category: "tierBasis" })),
    ...ACTUAL_HOURS_FIELDS.map((field) => ({ ...field, category: "actualHours" })),
  ]) {
    const existing = fieldByName(fieldsV1, spec.name);
    const fieldRequiredState = spec.category === "tierBasis" ? requiredFields(requireProposalSent) : requiredFields(false);
    if (!existing) {
      actions.push({
        type: "createDealField",
        fieldName: spec.name,
        body: {
          field_name: spec.name,
          field_type: spec.type,
          description:
            spec.description ??
            `PSG-1757: Branding quote Tier Basis field. Required before quote only after the enforcement gate is approved.`,
          ...(spec.options ? { options: spec.options.map((label) => ({ label })) } : {}),
          ...visibleInSales(),
          required_fields: fieldRequiredState,
        },
      });
      continue;
    }

    if (spec.category === "tierBasis") createdOrExisting.push(existing);
    if (existing.field_type !== spec.type) {
      unresolved.push({
        label: spec.name,
        reason: `existing field type is ${existing.field_type}, expected ${spec.type}`,
      });
      continue;
    }

    const existingV2 = existingV2ByCode.get(String(existing.key));
    const updateBody = {};
    if (!visibilityMatches(existingV2?.ui_visibility)) {
      Object.assign(updateBody, visibleInSales());
    }
    if (!requiredMatches(existingV2?.required_fields, fieldRequiredState)) {
      if (spec.category === "tierBasis" ? requireProposalSent : Boolean(existingV2?.required_fields?.enabled)) {
        updateBody.required_fields = fieldRequiredState;
      }
    }
    if (Object.keys(updateBody).length > 0) {
      actions.push({
        type: "updateDealField",
        fieldCode: String(existing.key),
        fieldId: existing.id,
        fieldName: spec.name,
        body: updateBody,
      });
    }

    if (spec.options) {
      const labels = new Set(optionLabels(existing).map(clean));
      const missingOptions = spec.options.filter((label) => !labels.has(clean(label)));
      if (missingOptions.length > 0) {
        actions.push({
          type: "addDealFieldOptions",
          fieldCode: String(existing.key),
          fieldId: existing.id,
          fieldName: spec.name,
          body: missingOptions.map((label) => ({ label })),
        });
      }
    }
  }

  if (createdOrExisting.length === TIER_BASIS_FIELDS.length) {
    const fieldIds = createdOrExisting.map((field) => field.id);
    if (!existingFilter) {
      actions.push({
        type: "createFilter",
        filterId: null,
        filterName: AUDIT_FILTER_NAME,
        body: {
          name: AUDIT_FILTER_NAME,
          type: "deals",
          conditions: filterConditions(fieldIds),
        },
      });
    }
  } else {
    notices.push({
      label: AUDIT_FILTER_NAME,
      reason: "audit filter can be created after all eight Tier Basis fields exist and have field IDs",
    });
  }

  return {
    actions,
    unresolved,
    notices,
    verification: {
      fields: TIER_BASIS_FIELDS.map((spec) => {
        const field = fieldByName(fieldsV1, spec.name);
        const fieldV2 = field ? existingV2ByCode.get(String(field.key)) : null;
        return {
          id: field?.id ?? null,
          key: field?.key ?? null,
          name: spec.name,
          type: field?.field_type ?? null,
          options: optionLabels(field),
          required_fields: fieldV2?.required_fields ?? null,
        };
      }),
      actualHoursFields: ACTUAL_HOURS_FIELDS.map((spec) => {
        const field = fieldByName(fieldsV1, spec.name);
        const fieldV2 = field ? existingV2ByCode.get(String(field.key)) : null;
        return {
          id: field?.id ?? null,
          key: field?.key ?? null,
          name: spec.name,
          type: field?.field_type ?? null,
          required_fields: fieldV2?.required_fields ?? null,
        };
      }),
      filter: existingFilter ? { id: existingFilter.id, name: existingFilter.name } : null,
      enforcement: requireProposalSent
        ? "Configured as required at PSG Sales / Proposal Sent. This is broader than branding-only because Pipedrive has no Branding pipeline in this account."
        : "Not enabled by this run. Native Pipedrive required fields can target stages/statuses, but this account has no Branding pipeline to target without affecting all PSG Sales proposal moves.",
    },
  };
}

export function buildActualHoursReport({ fieldsV1, deals, generatedAt = new Date().toISOString() }) {
  const tierKey = fieldKeyByName(fieldsV1, "Tier Basis - Tier selected");
  const actualHourFieldKeys = Object.fromEntries(
    ACTUAL_HOURS_FIELDS.map((spec) => [spec.name, fieldKeyByName(fieldsV1, spec.name)]),
  );
  const missingFields = [
    ["Tier Basis - Tier selected", tierKey],
    ...ACTUAL_HOURS_FIELDS.map((spec) => [spec.name, actualHourFieldKeys[spec.name]]),
  ]
    .filter(([, key]) => !key)
    .map(([name]) => name);

  if (missingFields.length > 0) {
    return {
      issue: "PSG-1779",
      generatedAt,
      ready: false,
      missingFields,
      firstClosedBrandingJobs: [],
      byTier: [],
    };
  }

  const firstClosedBrandingJobs = deals
    .filter((deal) => clean(deal.status) === "won")
    .map((deal) => {
      const tier = String(deal[tierKey] ?? "").trim();
      const estimate = BRANDING_TIER_ESTIMATES[tier] ?? null;
      const phases = BRANDING_PHASES.map((phase) => {
        const phaseEstimate = estimate?.phases?.[phase.id] ?? null;
        const actualDesignHours = readNumber(deal[actualHourFieldKeys[`phase${phase.id}_design_hours_actual`]]);
        const actualPmHours = readNumber(deal[actualHourFieldKeys[`phase${phase.id}_pm_hours_actual`]]);
        return {
          phase: phase.id,
          name: phase.name,
          gate: phase.gate,
          estimatedDesignHours: phaseEstimate?.designHours ?? null,
          actualDesignHours,
          designVariancePct: variancePct(actualDesignHours, phaseEstimate?.designHours),
          estimatedPmHours: phaseEstimate?.pmHours ?? null,
          actualPmHours,
          pmVariancePct: variancePct(actualPmHours, phaseEstimate?.pmHours),
        };
      });
      const actualDesignHours = sumNumbers(phases.map((phase) => phase.actualDesignHours));
      const actualPmHours = sumNumbers(phases.map((phase) => phase.actualPmHours));
      const designVariancePct = variancePct(actualDesignHours, estimate?.designHours);
      const pmVariancePct = variancePct(actualPmHours, estimate?.pmHours);
      return {
        dealId: deal.id ?? null,
        title: deal.title ?? null,
        tier: tier || null,
        wonAt: deal.won_time ?? deal.close_time ?? null,
        estimatedDesignHours: estimate?.designHours ?? null,
        actualDesignHours,
        designVariancePct,
        estimatedPmHours: estimate?.pmHours ?? null,
        actualPmHours,
        pmVariancePct,
        phases,
        changeOrderDesignHours: readNumber(deal[actualHourFieldKeys.change_order_design_hours]),
        changeOrderPmHours: readNumber(deal[actualHourFieldKeys.change_order_pm_hours]),
        repricingTrigger: designVariancePct == null ? "missing actuals" : Math.abs(designVariancePct) > 15,
      };
    })
    .filter((deal) => deal.tier && deal.estimatedDesignHours != null)
    .sort((a, b) => readDate(a.wonAt) - readDate(b.wonAt))
    .slice(0, ACTUAL_HOURS_REPORT_LIMIT);

  const byTier = Object.entries(
    firstClosedBrandingJobs.reduce((acc, deal) => {
      const bucket = acc[deal.tier] ?? {
        tier: deal.tier,
        closedJobs: 0,
        estimatedDesignHours: 0,
        actualDesignHours: 0,
        estimatedPmHours: 0,
        actualPmHours: 0,
        missingActualJobs: 0,
        phases: Object.fromEntries(
          BRANDING_PHASES.map((phase) => [
            phase.id,
            {
              phase: phase.id,
              name: phase.name,
              estimatedDesignHours: 0,
              actualDesignHours: 0,
              estimatedPmHours: 0,
              actualPmHours: 0,
              missingActualJobs: 0,
            },
          ]),
        ),
      };
      bucket.closedJobs += 1;
      bucket.estimatedDesignHours += deal.estimatedDesignHours ?? 0;
      bucket.estimatedPmHours += deal.estimatedPmHours ?? 0;
      if (deal.actualDesignHours == null || deal.actualPmHours == null) bucket.missingActualJobs += 1;
      else {
        bucket.actualDesignHours += deal.actualDesignHours;
        bucket.actualPmHours += deal.actualPmHours;
      }
      for (const phase of deal.phases) {
        const phaseBucket = bucket.phases[phase.phase];
        phaseBucket.estimatedDesignHours += phase.estimatedDesignHours ?? 0;
        phaseBucket.estimatedPmHours += phase.estimatedPmHours ?? 0;
        if (phase.actualDesignHours == null || phase.actualPmHours == null) {
          phaseBucket.missingActualJobs += 1;
        } else {
          phaseBucket.actualDesignHours += phase.actualDesignHours;
          phaseBucket.actualPmHours += phase.actualPmHours;
        }
      }
      acc[deal.tier] = bucket;
      return acc;
    }, {}),
  ).map(([, bucket]) => ({
    ...bucket,
    designVariancePct:
      bucket.estimatedDesignHours > 0 && bucket.missingActualJobs === 0
        ? Number((((bucket.actualDesignHours - bucket.estimatedDesignHours) / bucket.estimatedDesignHours) * 100).toFixed(1))
        : null,
    repricingTrigger:
      bucket.missingActualJobs > 0
        ? "missing actuals"
        : Math.abs((bucket.actualDesignHours - bucket.estimatedDesignHours) / bucket.estimatedDesignHours) > 0.15,
    phases: Object.values(bucket.phases).map((phase) => ({
      ...phase,
      designVariancePct:
        phase.estimatedDesignHours > 0 && phase.missingActualJobs === 0
          ? Number((((phase.actualDesignHours - phase.estimatedDesignHours) / phase.estimatedDesignHours) * 100).toFixed(1))
          : null,
      pmVariancePct:
        phase.estimatedPmHours > 0 && phase.missingActualJobs === 0
          ? Number((((phase.actualPmHours - phase.estimatedPmHours) / phase.estimatedPmHours) * 100).toFixed(1))
          : null,
    })),
  }));

  return {
    issue: "PSG-1779",
    generatedAt,
    ready:
      firstClosedBrandingJobs.length >= ACTUAL_HOURS_REPORT_LIMIT &&
      firstClosedBrandingJobs.every((deal) => deal.repricingTrigger !== "missing actuals"),
    missingFields: [],
    firstClosedBrandingJobs,
    byTier,
    threshold:
      "Rebuild the tier scope if total actual design hours are more than 15% above or below the estimate. Use phase splits to tell pricing defects from Phase 3 change-order enforcement defects.",
  };
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
    const json = await this.request(
      "GET",
      "v2",
      "dealFields?limit=500&include_fields=ui_visibility,required_fields",
      null,
    );
    return Array.isArray(json.data) ? json.data : [];
  }

  async listFilters() {
    const json = await this.request("GET", "v1", "filters?type=deals", null);
    return Array.isArray(json.data) ? json.data : [];
  }

  async listDealsByFilter(filterId) {
    const json = await this.request("GET", "v1", `deals?filter_id=${filterId}&limit=50`, null);
    return Array.isArray(json.data) ? json.data : [];
  }

  async listWonDeals() {
    const deals = [];
    let start = 0;
    for (let page = 0; page < 100; page += 1) {
      const json = await this.request("GET", "v1", `deals?status=won&start=${start}&limit=500`, null);
      if (Array.isArray(json.data)) deals.push(...json.data);
      const pagination = json?.additional_data?.pagination ?? {};
      if (!pagination.more_items_in_collection) return deals;
      start = Number(pagination.next_start);
      if (!Number.isFinite(start)) throw new Error("Pipedrive won-deal pagination did not return next_start");
    }
    throw new Error("Pipedrive won-deal pagination exceeded 100 pages");
  }

  async applyAction(action) {
    if (action.type === "createDealField") {
      return this.request("POST", "v2", "dealFields", action.body);
    }
    if (action.type === "updateDealField") {
      return this.request("PATCH", "v2", `dealFields/${encodeURIComponent(action.fieldCode)}`, action.body);
    }
    if (action.type === "addDealFieldOptions") {
      return this.request("POST", "v2", `dealFields/${encodeURIComponent(action.fieldCode)}/options`, action.body);
    }
    if (action.type === "createFilter") {
      return this.request("POST", "v1", "filters?include_field_code=true", action.body);
    }
    if (action.type === "updateFilter") {
      return this.request("PUT", "v1", `filters/${action.filterId}?include_field_code=true`, action.body);
    }
    throw new Error(`Unsupported action type: ${action.type}`);
  }
}

async function snapshot(api, requireProposalSent) {
  const [fieldsV1, fieldsV2, filters] = await Promise.all([
    api.listDealFieldsV1(),
    api.listDealFieldsV2(),
    api.listFilters(),
  ]);
  return buildPlan({ fieldsV1, fieldsV2, filters, requireProposalSent });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const actualHoursReport = process.argv.includes("--actual-hours-report");
  const requireProposalSent = process.argv.includes("--require-proposal-sent");
  const token = resolveToken();
  if (!token) throw new Error(`Missing Pipedrive token. Set one of: ${TOKEN_ENV_CANDIDATES.join(", ")}`);

  const api = new PipedriveApi({ token, base: baseUrl() });
  if (actualHoursReport) {
    const [fieldsV1, deals] = await Promise.all([api.listDealFieldsV1(), api.listWonDeals()]);
    const result = buildActualHoursReport({ fieldsV1, deals });
    const outDir = new URL("../../../artifacts/PSG-1779/", import.meta.url);
    await mkdir(outDir, { recursive: true });
    await writeFile(new URL("branding_actual_hours_report.json", outDir), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  let plan = await snapshot(api, requireProposalSent);
  if (plan.unresolved.length > 0) {
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...plan }, null, 2));
    throw new Error(`Unresolved configuration: ${plan.unresolved.map((item) => item.label).join(", ")}`);
  }

  const applied = [];
  if (apply) {
    for (let pass = 1; pass <= 4; pass += 1) {
      if (plan.actions.length === 0) break;
      for (const action of plan.actions) {
        await api.applyAction(action);
        applied.push({
          pass,
          type: action.type,
          fieldId: action.fieldId ?? null,
          fieldName: action.fieldName ?? null,
          filterId: action.filterId ?? null,
          filterName: action.filterName ?? null,
        });
      }
      plan = await snapshot(api, requireProposalSent);
      if (plan.unresolved.length > 0) {
        console.log(JSON.stringify({ mode: "apply", applied, ...plan }, null, 2));
        throw new Error(`Unresolved configuration after apply pass ${pass}: ${plan.unresolved.map((item) => item.label).join(", ")}`);
      }
    }
  }

  const auditFilter = plan.verification.filter;
  const sampleDeals = apply && auditFilter?.id ? await api.listDealsByFilter(auditFilter.id) : [];
  const result = {
    issue: "PSG-1757",
    includes: ["PSG-1779 actual-hours capture fields"],
    mode: apply ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    sourceEndpoints: [
      "GET /api/v1/dealFields",
      "GET /api/v2/dealFields?include_fields=ui_visibility,required_fields",
      "GET /api/v1/filters?type=deals",
    ],
    target: {
      pipeline: { id: PSG_SALES_PIPELINE_ID, name: "PSG Sales" },
      quoteStage: { id: PROPOSAL_SENT_STAGE_ID, name: "Proposal Sent" },
    },
    counts: {
      plannedActions: plan.actions.length,
      appliedActions: applied.length,
      fieldsExpected: TIER_BASIS_FIELDS.length + ACTUAL_HOURS_FIELDS.length,
      auditFilterSampleDealCount: sampleDeals.length,
    },
    decisions: {
      brandingPipelineGap:
        "Live Pipedrive has no Branding pipeline. The safe apply creates the fields and audit filter in PSG Sales, but does not turn on the broad Proposal Sent required-field gate unless --require-proposal-sent is used.",
      nativeEnforcement:
        "Pipedrive deal-field required_fields supports stage-based web UI enforcement. It cannot target only branding quotes here without a real Branding pipeline or another approved pipeline/stage split.",
      auditFilter:
        "The saved filter lists PSG Sales deals in Proposal Sent where any Tier Basis field is empty.",
      actualHours:
        "Ten numeric deal fields capture actual design and project-management hours per branding phase, plus separate change-order design/PM hours that stay out of phase totals. Run this script with --actual-hours-report after branding job #3 closes to compare actuals with the approved per-phase tier baseline.",
    },
    applied,
    remainingActions: plan.actions,
    unresolved: plan.unresolved,
    notices: plan.notices,
    verification: {
      ...plan.verification,
      auditFilterSampleDeals: sampleDeals.map((deal) => ({ id: deal.id, title: deal.title })),
    },
  };

  const outDir = new URL("../../../artifacts/PSG-1779/", import.meta.url);
  await mkdir(outDir, { recursive: true });
  const filename = apply ? "pipedrive_branding_hours_apply_summary.json" : "pipedrive_branding_hours_dry-run_summary.json";
  await writeFile(new URL(filename, outDir), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
