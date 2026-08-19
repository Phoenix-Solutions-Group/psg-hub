#!/usr/bin/env node
// PSG-1757 / PSG-1805 — create Branding Tier Basis and Cost Basis deal fields and audit filters in Pipedrive.
//
// Dry-run:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-branding-tier-basis.mjs
// Apply safe field + filter setup:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-branding-tier-basis.mjs --apply
// Also require fields at PSG Sales / Proposal Sent (broad gate, affects all PSG Sales quotes):
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-branding-tier-basis.mjs --apply --require-proposal-sent
// Create/use a dedicated Branding pipeline and require Tier Basis fields at its Proposal Sent stage:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-branding-tier-basis.mjs --apply --branding-pipeline
// Export the first closed branding jobs with estimated-vs-actual hours:
//   node --env-file=.env.local apps/psg-hub/scripts/pipedrive-branding-tier-basis.mjs --actual-hours-report

import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

const TOKEN_ENV_CANDIDATES = ["PIPEDRIVE_API_TOKEN", "PIPEDRIVE_TOKEN", "PIPEDRIVE_API_KEY"];

export const PSG_SALES_PIPELINE_ID = 8;
export const PROPOSAL_SENT_STAGE_ID = 59;
export const BRANDING_PIPELINE_NAME = "Branding";
export const BRANDING_STAGE_NAMES = [
  "New Lead",
  "Contacted / Discovery",
  "Qualified",
  "Proposal Sent",
  "Verbal / Negotiation",
  "Won",
];
export const AUDIT_FILTER_NAME = "Branding audit - Proposal Sent missing Tier Basis";
export const COST_BASIS_AUDIT_FILTER_NAME = "Cost basis audit - Proposal Sent missing Cost Basis";
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
  {
    name: "Tier Basis - T3 Named vendors",
    type: "text",
    legacyNames: ["T3 - Named vendors"],
    description:
      "PSG-1810: Tier 3 only. Every vendor PSG coordinates with, named at quote so the included coordination rounds can be enforced.",
  },
];

export const COST_BASIS_FIELDS = [
  {
    name: "Cost basis",
    type: "text",
    description:
      "PSG-1805: the named cost basis behind the quoted price, for example '$85 per sellable design hour'.",
  },
  {
    name: "Cost basis source",
    type: "text",
    description:
      "PSG-1805: the named source for the cost basis, for example 'PSG-1756 doc rebuild rev 1 (CFO)'.",
  },
  {
    name: "Cost basis date",
    type: "date",
    description:
      "PSG-1805: the date of the source used for the cost basis, in YYYY-MM-DD form.",
  },
];

export const COST_BASIS_REJECTION_FIELD = {
  name: "Cost basis rejected lines",
  type: "double",
  description:
    "PSG-1805: count quote lines turned away because the cost basis was missing, unnamed, or out of date. Any filled-in value is queryable by saved filter.",
};

const ROLE_HELP_TEXT =
  "Attribute hours by the role assigned in the PSG-658 task graph, not by the person who did the work. Round to the nearest 0.5 hour.";

function actualPhaseField(phase, role) {
  const roleLabel = role === "pm" ? "project-management" : "design";
  return {
    name: `phase${phase.id}_${role}_hours_actual`,
    type: "double",
    description: `PSG-1795/PSG-1829: actual ${roleLabel} hours for Phase ${phase.id} (${phase.name}). ${ROLE_HELP_TEXT}`,
  };
}

export const ACTUAL_HOURS_FIELDS = [
  ...BRANDING_PHASES.flatMap((phase) => [actualPhaseField(phase, "design"), actualPhaseField(phase, "pm")]),
  {
    name: "change_order_design_hours",
    type: "double",
    description:
      "PSG-1795/PSG-1829: paid change-order design hours for this branding engagement. Keep these hours out of Phase 1-4 fixed-scope totals. " +
      ROLE_HELP_TEXT,
  },
  {
    name: "change_order_pm_hours",
    type: "double",
    description:
      "PSG-1795/PSG-1829: paid change-order project-management hours for this branding engagement. Keep these hours out of Phase 1-4 fixed-scope totals. " +
      ROLE_HELP_TEXT,
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

function visibleInPipelines(pipelineIds = [PSG_SALES_PIPELINE_ID]) {
  return {
    ui_visibility: {
      add_visible_flag: true,
      details_visible_flag: true,
      projects_detail_visible_flag: true,
      show_in_pipelines: { show_in_all: false, pipeline_ids: pipelineIds },
    },
  };
}

function requiredFields(stageId) {
  return stageId
    ? { enabled: true, stage_ids: [stageId], statuses: {} }
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

function visibilityMatches(actual, expectedPipelineIds = [PSG_SALES_PIPELINE_ID]) {
  const pipelines = actual?.show_in_pipelines ?? {};
  return (
    actual?.add_visible_flag === true &&
    actual?.details_visible_flag === true &&
    actual?.projects_detail_visible_flag === true &&
    pipelines.show_in_all === false &&
    JSON.stringify((pipelines.pipeline_ids ?? []).map(Number).sort((a, b) => a - b)) ===
      JSON.stringify(expectedPipelineIds.map(Number).sort((a, b) => a - b))
  );
}

function fieldByName(fields, name) {
  return fields.find((field) => clean(field.name ?? field.field_name) === clean(name)) ?? null;
}

function fieldBySpec(fields, spec) {
  return [spec.name, ...(spec.legacyNames ?? [])].map((name) => fieldByName(fields, name)).find(Boolean) ?? null;
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

function sumRequiredNumbers(values) {
  return values.every((value) => value != null) ? values.reduce((total, value) => total + value, 0) : null;
}

function missingActualsLabel(designTotal, pmTotal) {
  return designTotal == null || pmTotal == null ? "missing actuals" : null;
}

function missingFieldCondition(fieldId) {
  return {
    object: "deal",
    field_id: String(fieldId),
    operator: "IS NULL",
    value: null,
    extra_value: null,
  };
}

function proposalSentMissingFieldConditions(fieldIds, { pipelineId = PSG_SALES_PIPELINE_ID, stageId = PROPOSAL_SENT_STAGE_ID } = {}) {
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
            value: String(pipelineId),
            extra_value: null,
          },
          {
            object: "deal",
            field_id: "12464",
            operator: "=",
            value: String(stageId),
            extra_value: null,
          },
        ],
      },
      {
        glue: "or",
        conditions: fieldIds.map((id) => missingFieldCondition(id)),
      },
    ],
  };
}

function tierBasisAuditConditions({ fields, pipelineId = PSG_SALES_PIPELINE_ID, stageId = PROPOSAL_SENT_STAGE_ID }) {
  return proposalSentMissingFieldConditions(fields.map((field) => field.id), { pipelineId, stageId });
}

function normalizeConditionTree(value) {
  if (Array.isArray(value)) return value.map(normalizeConditionTree);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "json_value_flag")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, normalizeConditionTree(child)]),
    );
  }
  return value;
}

function filterConditionsMatch(actual, expected) {
  return JSON.stringify(normalizeConditionTree(actual)) === JSON.stringify(normalizeConditionTree(expected));
}

function pipelineByName(pipelines, name) {
  return pipelines.find((pipeline) => clean(pipeline.name) === clean(name)) ?? null;
}

function stagePipelineId(stage) {
  return Number(stage?.pipeline_id?.value ?? stage?.pipeline_id);
}

function stageByName(stages, pipelineId, name) {
  return stages.find((stage) => stagePipelineId(stage) === Number(pipelineId) && clean(stage.name) === clean(name)) ?? null;
}

export function buildPlan({
  fieldsV1,
  fieldsV2,
  filters,
  pipelines = [],
  stages = [],
  requireProposalSent = false,
  useBrandingPipeline = false,
}) {
  const actions = [];
  const unresolved = [];
  const notices = [];
  const createdOrExisting = [];
  const costBasisCreatedOrExisting = [];
  const existingV2ByCode = new Map(fieldsV2.map((field) => [String(field.field_code), field]));
  const existingFilter = filters.find((filter) => clean(filter.name) === clean(AUDIT_FILTER_NAME)) ?? null;
  const existingCostBasisFilter =
    filters.find((filter) => clean(filter.name) === clean(COST_BASIS_AUDIT_FILTER_NAME)) ?? null;
  const brandingPipeline = pipelineByName(pipelines, BRANDING_PIPELINE_NAME);
  const brandingProposalStage = brandingPipeline ? stageByName(stages, brandingPipeline.id, "Proposal Sent") : null;
  const tierBasisStageId = useBrandingPipeline
    ? Number(brandingProposalStage?.id) || null
    : requireProposalSent
      ? PROPOSAL_SENT_STAGE_ID
      : null;
  const tierBasisPipelineId = useBrandingPipeline && brandingPipeline ? Number(brandingPipeline.id) : PSG_SALES_PIPELINE_ID;
  const tierBasisFilterStageId = useBrandingPipeline && brandingProposalStage
    ? Number(brandingProposalStage.id)
    : PROPOSAL_SENT_STAGE_ID;
  const tierBasisVisibilityPipelineIds = useBrandingPipeline && brandingPipeline
    ? [PSG_SALES_PIPELINE_ID, Number(brandingPipeline.id)]
    : [PSG_SALES_PIPELINE_ID];

  if (useBrandingPipeline && !brandingPipeline) {
    actions.push({
      type: "createPipeline",
      pipelineName: BRANDING_PIPELINE_NAME,
      body: { name: BRANDING_PIPELINE_NAME },
    });
  }

  if (useBrandingPipeline && brandingPipeline) {
    for (const stageName of BRANDING_STAGE_NAMES) {
      if (!stageByName(stages, brandingPipeline.id, stageName)) {
        actions.push({
          type: "createStage",
          pipelineId: Number(brandingPipeline.id),
          stageName,
          body: { name: stageName, pipeline_id: Number(brandingPipeline.id) },
        });
      }
    }
  }

  if (useBrandingPipeline && (!brandingPipeline || !brandingProposalStage)) {
    notices.push({
      label: `${BRANDING_PIPELINE_NAME} / Proposal Sent`,
      reason: "required-field enforcement will be applied after the branding pipeline and Proposal Sent stage exist",
    });
  }

  for (const spec of [
    ...TIER_BASIS_FIELDS.map((field) => ({ ...field, category: "tierBasis" })),
    ...COST_BASIS_FIELDS.map((field) => ({ ...field, category: "costBasis" })),
    { ...COST_BASIS_REJECTION_FIELD, category: "costBasisRejection" },
    ...ACTUAL_HOURS_FIELDS.map((field) => ({ ...field, category: "actualHours" })),
  ]) {
    const existing = fieldBySpec(fieldsV1, spec);
    const visibilityPipelineIds = spec.category === "tierBasis" ? tierBasisVisibilityPipelineIds : [PSG_SALES_PIPELINE_ID];
    const fieldRequiredState =
      spec.category === "tierBasis"
        ? requiredFields(tierBasisStageId)
        : spec.category === "costBasis"
          ? requiredFields(requireProposalSent ? PROPOSAL_SENT_STAGE_ID : null)
          : requiredFields(null);
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
          ...visibleInPipelines(visibilityPipelineIds),
          required_fields: fieldRequiredState,
        },
      });
      continue;
    }

    if (spec.category === "tierBasis") createdOrExisting.push(existing);
    if (spec.category === "costBasis") costBasisCreatedOrExisting.push(existing);
    if (existing.field_type !== spec.type) {
      unresolved.push({
        label: spec.name,
        reason: `existing field type is ${existing.field_type}, expected ${spec.type}`,
      });
      continue;
    }

    const existingV2 = existingV2ByCode.get(String(existing.key));
    const updateBody = {};
    if (clean(existing.name ?? existing.field_name) !== clean(spec.name)) {
      updateBody.field_name = spec.name;
    }
    if (!visibilityMatches(existingV2?.ui_visibility, visibilityPipelineIds)) {
      Object.assign(updateBody, visibleInPipelines(visibilityPipelineIds));
    }
    if (!requiredMatches(existingV2?.required_fields, fieldRequiredState)) {
      if (
        spec.category === "tierBasis"
          ? Boolean(tierBasisStageId)
          : spec.category === "costBasis"
            ? requireProposalSent
          : Boolean(existingV2?.required_fields?.enabled)
      ) {
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

  if (createdOrExisting.length === TIER_BASIS_FIELDS.length && (!useBrandingPipeline || brandingProposalStage)) {
    const expectedFilterConditions = tierBasisAuditConditions({
      fields: createdOrExisting,
      pipelineId: tierBasisPipelineId,
      stageId: tierBasisFilterStageId,
    });
    if (!existingFilter) {
      actions.push({
        type: "createFilter",
        filterId: null,
        filterName: AUDIT_FILTER_NAME,
        body: {
          name: AUDIT_FILTER_NAME,
          type: "deals",
          conditions: expectedFilterConditions,
        },
      });
    } else if (!filterConditionsMatch(existingFilter.conditions, expectedFilterConditions)) {
      actions.push({
        type: "updateFilter",
        filterId: existingFilter.id,
        filterName: AUDIT_FILTER_NAME,
        body: {
          name: AUDIT_FILTER_NAME,
          type: "deals",
          conditions: expectedFilterConditions,
        },
      });
    }
  } else {
    notices.push({
      label: AUDIT_FILTER_NAME,
      reason:
        createdOrExisting.length === TIER_BASIS_FIELDS.length
          ? "audit filter can be updated after the Branding Proposal Sent stage exists"
          : "audit filter can be created after all nine Tier Basis fields exist and have field IDs",
    });
  }

  if (costBasisCreatedOrExisting.length === COST_BASIS_FIELDS.length) {
    const fieldIds = costBasisCreatedOrExisting.map((field) => field.id);
    const expectedFilterConditions = proposalSentMissingFieldConditions(fieldIds);
    if (!existingCostBasisFilter) {
      actions.push({
        type: "createFilter",
        filterId: null,
        filterName: COST_BASIS_AUDIT_FILTER_NAME,
        body: {
          name: COST_BASIS_AUDIT_FILTER_NAME,
          type: "deals",
          conditions: expectedFilterConditions,
        },
      });
    } else if (!filterConditionsMatch(existingCostBasisFilter.conditions, expectedFilterConditions)) {
      actions.push({
        type: "updateFilter",
        filterId: existingCostBasisFilter.id,
        filterName: COST_BASIS_AUDIT_FILTER_NAME,
        body: {
          name: COST_BASIS_AUDIT_FILTER_NAME,
          type: "deals",
          conditions: expectedFilterConditions,
        },
      });
    }
  } else {
    notices.push({
      label: COST_BASIS_AUDIT_FILTER_NAME,
      reason: "audit filter can be created after all three Cost Basis fields exist and have field IDs",
    });
  }

  return {
    actions,
    unresolved,
    notices,
    verification: {
      fields: TIER_BASIS_FIELDS.map((spec) => {
        const field = fieldBySpec(fieldsV1, spec);
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
      costBasisFields: COST_BASIS_FIELDS.map((spec) => {
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
      costBasisRejectionField: (() => {
        const field = fieldByName(fieldsV1, COST_BASIS_REJECTION_FIELD.name);
        const fieldV2 = field ? existingV2ByCode.get(String(field.key)) : null;
        return {
          id: field?.id ?? null,
          key: field?.key ?? null,
          name: COST_BASIS_REJECTION_FIELD.name,
          type: field?.field_type ?? null,
          required_fields: fieldV2?.required_fields ?? null,
        };
      })(),
      actualHoursFields: ACTUAL_HOURS_FIELDS.map((spec) => {
        const field = fieldByName(fieldsV1, spec.name);
        const fieldV2 = field ? existingV2ByCode.get(String(field.key)) : null;
        return {
          id: field?.id ?? null,
          key: field?.key ?? null,
          name: spec.name,
          type: field?.field_type ?? null,
          ui_visibility: fieldV2?.ui_visibility ?? null,
          required_fields: fieldV2?.required_fields ?? null,
        };
      }),
      filter: existingFilter ? { id: existingFilter.id, name: existingFilter.name } : null,
      costBasisFilter: existingCostBasisFilter
        ? { id: existingCostBasisFilter.id, name: existingCostBasisFilter.name }
        : null,
      pipeline: useBrandingPipeline
        ? {
            id: brandingPipeline?.id ?? null,
            name: brandingPipeline?.name ?? BRANDING_PIPELINE_NAME,
            proposalSentStageId: brandingProposalStage?.id ?? null,
          }
        : { id: PSG_SALES_PIPELINE_ID, name: "PSG Sales", proposalSentStageId: PROPOSAL_SENT_STAGE_ID },
      enforcement: requireProposalSent
        ? "Configured as required at PSG Sales / Proposal Sent. This is broader than branding-only because Pipedrive has no Branding pipeline in this account."
        : useBrandingPipeline && brandingProposalStage
          ? "Configured as required at Branding / Proposal Sent. This avoids blocking unrelated PSG Sales quotes."
          : "Not enabled by this run. Nick chose the branding-only path on PSG-1763, so native required fields stay off until PSG-1757 creates a branding-only Pipedrive path.",
    },
  };
}

export function buildActualHoursReport({ fieldsV1, deals, generatedAt = new Date().toISOString() }) {
  const tierKey = fieldKeyByName(fieldsV1, "Tier Basis - Tier selected");
  const actualHoursKeys = new Map(ACTUAL_HOURS_FIELDS.map((spec) => [spec.name, fieldKeyByName(fieldsV1, spec.name)]));
  const missingFields = [
    ["Tier Basis - Tier selected", tierKey],
    ...ACTUAL_HOURS_FIELDS.map((spec) => [spec.name, actualHoursKeys.get(spec.name)]),
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
        const designHours = readNumber(deal[actualHoursKeys.get(`phase${phase.id}_design_hours_actual`)]);
        const pmHours = readNumber(deal[actualHoursKeys.get(`phase${phase.id}_pm_hours_actual`)]);
        return {
          id: phase.id,
          name: phase.name,
          gate: phase.gate,
          estimatedDesignHours: estimate?.phases?.[phase.id]?.designHours ?? null,
          actualDesignHours: designHours,
          designVariancePct: variancePct(designHours, estimate?.phases?.[phase.id]?.designHours),
          estimatedPmHours: estimate?.phases?.[phase.id]?.pmHours ?? null,
          actualPmHours: pmHours,
          pmVariancePct: variancePct(pmHours, estimate?.phases?.[phase.id]?.pmHours),
        };
      });
      const actualDesignHours = sumRequiredNumbers(phases.map((phase) => phase.actualDesignHours));
      const actualPmHours = sumRequiredNumbers(phases.map((phase) => phase.actualPmHours));
      const designVariancePct = variancePct(actualDesignHours, estimate?.designHours);
      const pmVariancePct = variancePct(actualPmHours, estimate?.pmHours);
      const missingActuals = missingActualsLabel(actualDesignHours, actualPmHours);
      return {
        dealId: deal.id ?? null,
        title: deal.title ?? null,
        tier: tier || null,
        wonAt: deal.won_time ?? deal.close_time ?? null,
        phases,
        estimatedDesignHours: estimate?.designHours ?? null,
        actualDesignHours,
        designVariancePct,
        estimatedPmHours: estimate?.pmHours ?? null,
        actualPmHours,
        pmVariancePct,
        changeOrderDesignHours: readNumber(deal[actualHoursKeys.get("change_order_design_hours")]) ?? 0,
        changeOrderPmHours: readNumber(deal[actualHoursKeys.get("change_order_pm_hours")]) ?? 0,
        repricingTrigger:
          missingActuals ??
          Boolean(
            (designVariancePct != null && Math.abs(designVariancePct) > 15) ||
              (pmVariancePct != null && Math.abs(pmVariancePct) > 15),
          ),
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
        changeOrderDesignHours: 0,
        changeOrderPmHours: 0,
        missingActualJobs: 0,
      };
      bucket.closedJobs += 1;
      bucket.estimatedDesignHours += deal.estimatedDesignHours ?? 0;
      bucket.estimatedPmHours += deal.estimatedPmHours ?? 0;
      bucket.changeOrderDesignHours += deal.changeOrderDesignHours ?? 0;
      bucket.changeOrderPmHours += deal.changeOrderPmHours ?? 0;
      if (deal.actualDesignHours == null || deal.actualPmHours == null) bucket.missingActualJobs += 1;
      else {
        bucket.actualDesignHours += deal.actualDesignHours;
        bucket.actualPmHours += deal.actualPmHours;
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
    pmVariancePct:
      bucket.estimatedPmHours > 0 && bucket.missingActualJobs === 0
        ? Number((((bucket.actualPmHours - bucket.estimatedPmHours) / bucket.estimatedPmHours) * 100).toFixed(1))
        : null,
    repricingTrigger:
      bucket.missingActualJobs > 0
        ? "missing actuals"
        : Math.abs((bucket.actualDesignHours - bucket.estimatedDesignHours) / bucket.estimatedDesignHours) > 0.15 ||
          Math.abs((bucket.actualPmHours - bucket.estimatedPmHours) / bucket.estimatedPmHours) > 0.15,
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
      "Rebuild the tier scope if fixed-scope actual design or project-management hours are more than 15% above or below the approved tier estimate. Paid change-order hours are reported separately and excluded from the phase totals.",
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
    const filters = Array.isArray(json.data) ? json.data : [];
    return Promise.all(
      filters.map(async (filter) => {
        if (filter?.conditions) return filter;
        const detail = await this.request("GET", "v1", `filters/${encodeURIComponent(filter.id)}`, null);
        return detail.data ?? filter;
      }),
    );
  }

  async listPipelines() {
    const json = await this.request("GET", "v2", "pipelines?limit=500", null);
    return Array.isArray(json.data) ? json.data : [];
  }

  async listStages() {
    const json = await this.request("GET", "v2", "stages?limit=500", null);
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
    if (action.type === "createPipeline") {
      return this.request("POST", "v2", "pipelines", action.body);
    }
    if (action.type === "createStage") {
      return this.request("POST", "v2", "stages", action.body);
    }
    throw new Error(`Unsupported action type: ${action.type}`);
  }
}

async function snapshot(api, requireProposalSent, useBrandingPipeline) {
  const [fieldsV1, fieldsV2, filters, pipelines, stages] = await Promise.all([
    api.listDealFieldsV1(),
    api.listDealFieldsV2(),
    api.listFilters(),
    api.listPipelines(),
    api.listStages(),
  ]);
  return buildPlan({ fieldsV1, fieldsV2, filters, pipelines, stages, requireProposalSent, useBrandingPipeline });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const actualHoursReport = process.argv.includes("--actual-hours-report");
  const requireProposalSent = process.argv.includes("--require-proposal-sent");
  const useBrandingPipeline = process.argv.includes("--branding-pipeline");
  if (requireProposalSent && useBrandingPipeline) {
    throw new Error("Use either --require-proposal-sent or --branding-pipeline, not both.");
  }
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

  let plan = await snapshot(api, requireProposalSent, useBrandingPipeline);
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
          pipelineId: action.pipelineId ?? null,
          pipelineName: action.pipelineName ?? null,
          stageName: action.stageName ?? null,
        });
      }
      plan = await snapshot(api, requireProposalSent, useBrandingPipeline);
      if (plan.unresolved.length > 0) {
        console.log(JSON.stringify({ mode: "apply", applied, ...plan }, null, 2));
        throw new Error(`Unresolved configuration after apply pass ${pass}: ${plan.unresolved.map((item) => item.label).join(", ")}`);
      }
    }
  }

  const auditFilter = plan.verification.filter;
  const sampleDeals = apply && auditFilter?.id ? await api.listDealsByFilter(auditFilter.id) : [];
  const result = {
    issue: useBrandingPipeline ? "PSG-1757" : "PSG-1805",
    includes: [
      "PSG-1757 Tier Basis fields and audit filter",
      "PSG-1805 Cost Basis fields, audit filter, and rejected-lines counter",
      "PSG-1810 T3 named-vendors Tier Basis field",
      "PSG-1779 actual-hours capture fields",
    ],
    mode: apply ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    sourceEndpoints: [
      "GET /api/v1/dealFields",
      "GET /api/v2/dealFields?include_fields=ui_visibility,required_fields",
      "GET /api/v1/filters?type=deals",
      "GET /api/v2/pipelines",
      "GET /api/v2/stages",
    ],
    target: {
      pipeline: plan.verification.pipeline,
      quoteStage: { id: plan.verification.pipeline.proposalSentStageId ?? PROPOSAL_SENT_STAGE_ID, name: "Proposal Sent" },
    },
    counts: {
      plannedActions: plan.actions.length,
      appliedActions: applied.length,
      fieldsExpected: TIER_BASIS_FIELDS.length + ACTUAL_HOURS_FIELDS.length,
      costBasisFieldsExpected: COST_BASIS_FIELDS.length,
      costBasisRejectionFieldsExpected: 1,
      auditFilterSampleDealCount: sampleDeals.length,
    },
    decisions: {
      brandingPipelineGap:
        useBrandingPipeline
          ? "Nick chose the dedicated Branding path. This run creates or reuses the Branding pipeline and targets its Proposal Sent stage."
          : "Live Pipedrive has no Branding pipeline. The safe apply creates the fields and audit filter in PSG Sales, but does not turn on the broad Proposal Sent required-field gate unless --require-proposal-sent is used.",
      nativeEnforcement:
        useBrandingPipeline
          ? "Pipedrive deal-field required_fields supports stage-based web UI enforcement. This run requires Tier Basis fields at Branding / Proposal Sent."
          : "Pipedrive deal-field required_fields supports stage-based web UI enforcement. It cannot target only branding quotes here without a real Branding pipeline or another approved pipeline/stage split.",
      auditFilter:
        useBrandingPipeline
          ? "The saved filter lists Branding deals in Proposal Sent where any Tier Basis field is empty. Pipedrive rejected the conditional saved-filter shape for Tier 3-only vendors, so this catches Tier 3 missing vendors but may also show Tier 1/2 deals where the vendor field is blank."
          : "The saved filter lists PSG Sales deals in Proposal Sent where any Tier Basis field is empty.",
      costBasisAuditFilter:
        "The saved filter lists PSG Sales deals in Proposal Sent where Cost basis, Cost basis source, or Cost basis date is empty.",
      rejectedLines:
        "A numeric deal field named Cost basis rejected lines makes turned-away lines queryable in Pipedrive and exports. Pipedrive rejected saved-filter API operators for this numeric counter, so the durable control is the queryable field, not a saved filter.",
      actualHours:
        "Ten optional numeric deal fields capture Phase 1-4 design/project-management hours plus separate paid change-order design/project-management hours. Run this script with --actual-hours-report after branding job #3 closes to compare fixed-scope actuals with the approved tier baseline.",
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

  const outDir = new URL(useBrandingPipeline ? "../../../artifacts/PSG-1757/" : "../../../artifacts/PSG-1805/", import.meta.url);
  await mkdir(outDir, { recursive: true });
  const filename = useBrandingPipeline
    ? apply
      ? "pipedrive_branding_tier_basis_apply_summary.json"
      : "pipedrive_branding_tier_basis_dry-run_summary.json"
    : apply
      ? "pipedrive_cost_basis_apply_summary.json"
      : "pipedrive_cost_basis_dry-run_summary.json";
  await writeFile(new URL(filename, outDir), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
