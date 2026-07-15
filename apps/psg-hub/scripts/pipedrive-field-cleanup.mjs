#!/usr/bin/env node
// PSG-1468 — Pipedrive field cleanup from Reese's PSG-1467 audit.
//
// Default is dry-run:
//   node --env-file=.env.local scripts/pipedrive-field-cleanup.mjs
// Apply live changes:
//   node --env-file=.env.local scripts/pipedrive-field-cleanup.mjs --apply
//
// The script never prints the API token. It only changes Pipedrive when --apply is
// supplied; otherwise it reports the planned mutations and unresolved manual checks.

import process from "node:process";

export const PSG_SALES_PIPELINE_ID = 8;
export const PSG_SALES_STAGE_IDS = {
  newLead: 56,
  discovery: 57,
  qualified: 58,
  proposalSent: 59,
  negotiation: 60,
  won: 61,
};

const TOKEN_ENV_CANDIDATES = [
  "PIPEDRIVE_API_TOKEN",
  "PIPEDRIVE_TOKEN",
  "PIPEDRIVE_API_KEY",
];

const REQUIRED_DEAL_FIELDS = [
  { labels: ["Lead Source (Channel)"], stageIds: [PSG_SALES_STAGE_IDS.newLead] },
  { labels: ["Organization", "Organization ID", "org_id"], stageIds: [PSG_SALES_STAGE_IDS.newLead] },
  { labels: ["Contact person", "Person", "Person ID", "person_id"], stageIds: [PSG_SALES_STAGE_IDS.newLead] },
  { labels: ["First Contact Date"], stageIds: [PSG_SALES_STAGE_IDS.discovery] },
  { labels: ["Service Line"], stageIds: [PSG_SALES_STAGE_IDS.discovery] },
  { labels: ["Value", "Deal Value"], stageIds: [PSG_SALES_STAGE_IDS.qualified, PSG_SALES_STAGE_IDS.proposalSent] },
  { labels: ["Expected Close Date", "Expected close date"], stageIds: [PSG_SALES_STAGE_IDS.qualified, PSG_SALES_STAGE_IDS.negotiation] },
  { labels: ["Revenue Type"], stageIds: [PSG_SALES_STAGE_IDS.qualified] },
  { labels: ["Proposal Link"], stageIds: [PSG_SALES_STAGE_IDS.proposalSent] },
];

const PRODUCT_FIELDS_TO_ARCHIVE = ["Income Account", "Expense Account", "Supplier"];
const CUSTOM_LOST_REASON_LABELS = ["Lost Reason (custom enum)", "Lost Reason"];

function cleanLabel(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldName(field) {
  return field?.name ?? field?.field_name ?? field?.key ?? "";
}

export function fieldCode(field) {
  return field?.field_code ?? field?.key ?? field?.id ?? null;
}

function sameField(a, b) {
  if (!a || !b) return false;
  const aCodes = [a?.field_code, a?.key, a?.id].filter((value) => value != null).map(String);
  const bCodes = new Set([b?.field_code, b?.key, b?.id].filter((value) => value != null).map(String));
  return aCodes.some((value) => bCodes.has(value));
}

export function findField(fields, labels, predicate = () => true) {
  const wanted = new Set(labels.map(cleanLabel));
  return fields.find((field) => {
    const candidates = [fieldName(field), field?.key, field?.field_code].map(cleanLabel);
    return candidates.some((candidate) => wanted.has(candidate)) && predicate(field);
  }) ?? null;
}

function isDeleted(field) {
  return field?.active_flag === false || field?.deleted === true || field?.is_deleted === true;
}

function isBuiltIn(field) {
  return field?.is_custom_flag === false || field?.edit_flag === false || field?.field_type === "system";
}

function mergeRequiredFields(existing, additions) {
  const current = existing && typeof existing === "object" ? existing : {};
  const stageIds = new Set(Array.isArray(current.stage_ids) ? current.stage_ids.map(Number) : []);
  for (const id of additions.stageIds ?? []) stageIds.add(Number(id));

  const statuses = { ...(current.statuses ?? {}) };
  for (const [pipelineId, values] of Object.entries(additions.statuses ?? {})) {
    const merged = new Set(Array.isArray(statuses[pipelineId]) ? statuses[pipelineId] : []);
    for (const value of values) merged.add(value);
    statuses[pipelineId] = [...merged];
  }

  return {
    enabled: stageIds.size > 0 || Object.keys(statuses).length > 0,
    stage_ids: [...stageIds].sort((a, b) => a - b),
    statuses,
  };
}

function requiredFieldOperation(field, label, additions) {
  const code = fieldCode(field);
  if (code == null) {
    return { type: "unresolved", label, reason: "matched field has no API field code" };
  }
  return {
    type: "updateDealFieldRequired",
    label,
    fieldCode: String(code),
    fieldName: fieldName(field),
    body: {
      required_fields: mergeRequiredFields(field.required_fields, additions),
      show_in_pipelines: { show_in_all: false, pipeline_ids: [PSG_SALES_PIPELINE_ID] },
    },
  };
}

export function buildCleanupPlan({ dealFields, organizationFields, productFields }) {
  const operations = [];
  const unresolved = [];

  for (const spec of REQUIRED_DEAL_FIELDS) {
    const field = findField(dealFields, spec.labels, (f) => !isDeleted(f));
    if (!field) {
      unresolved.push({
        label: spec.labels[0],
        reason: `field not found; cannot require it at stage(s) ${spec.stageIds.join(", ")}`,
      });
      continue;
    }
    operations.push(requiredFieldOperation(field, spec.labels[0], { stageIds: spec.stageIds }));
  }

  const builtInLostReason = findField(
    dealFields,
    ["lost_reason", "Lost reason", "Lost Reason"],
    (f) => !isDeleted(f) && (cleanLabel(f.key) === "lost reason" || cleanLabel(f.key) === "lost reason" || isBuiltIn(f)),
  ) ?? findField(dealFields, ["lost_reason"], (f) => !isDeleted(f));
  if (builtInLostReason) {
    operations.push(
      requiredFieldOperation(builtInLostReason, "Lost Reason", {
        statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["lost"] },
      }),
    );
  } else {
    unresolved.push({
      label: "Lost Reason",
      reason: "built-in lost reason field not found; required-on-lost was not configured",
    });
  }

  const customLostReason = findField(
    dealFields,
    CUSTOM_LOST_REASON_LABELS,
    (f) => !isDeleted(f) && !isBuiltIn(f) && !sameField(f, builtInLostReason),
  );
  if (customLostReason) {
    operations.push({
      type: "deleteDealField",
      label: "Custom Lost Reason",
      fieldCode: String(fieldCode(customLostReason)),
      fieldName: fieldName(customLostReason),
    });
  }

  const builtInWebsite = findField(
    organizationFields,
    ["website", "Website"],
    (f) => !isDeleted(f) && isBuiltIn(f),
  );
  const customWebsite = findField(
    organizationFields,
    ["website", "Website"],
    (f) => !isDeleted(f) && !isBuiltIn(f),
  );
  if (builtInWebsite && customWebsite) {
    operations.push({
      type: "dedupeOrganizationWebsite",
      label: "Organization Website",
      customFieldCode: String(fieldCode(customWebsite)),
      customFieldName: fieldName(customWebsite),
      builtInFieldName: fieldName(builtInWebsite),
    });
  } else {
    unresolved.push({
      label: "Organization Website",
      reason: "could not identify both built-in and custom Website fields; no website field was archived",
    });
  }

  for (const label of PRODUCT_FIELDS_TO_ARCHIVE) {
    const field = findField(productFields, [label], (f) => !isDeleted(f));
    if (!field) {
      unresolved.push({ label, reason: "product field not found or already archived" });
      continue;
    }
    operations.push({
      type: "deleteProductField",
      label,
      fieldCode: String(fieldCode(field)),
      fieldName: fieldName(field),
    });
  }

  unresolved.push({
    label: "qbo_item_id",
    reason: "kept by design; CFO John still needs the source QuickBooks item-link file before we can populate blanks",
  });
  unresolved.push({
    label: "Legacy warranty/letter/header organization fields",
    reason: "not archived by this script; each field must be confirmed as orphaned from warranty-letter and portal generation first",
  });
  unresolved.push({
    label: "First Contact Date auto-stamp",
    reason: "requires Pipedrive webhook/automation registration after the field key is confirmed; this script makes the field required at Discovery only",
  });

  return { operations, unresolved };
}

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

class PipedriveAdminApi {
  constructor({ token, base }) {
    this.token = token;
    this.base = base;
  }

  async request(method, apiVersion, path, body) {
    const url = new URL(`${this.base}/api/${apiVersion}${path}`);
    url.searchParams.set("api_token", this.token);
    const res = await fetch(url.toString(), {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Pipedrive ${method} ${path} returned HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json?.success === false) throw new Error(`Pipedrive ${method} ${path} returned success=false`);
    return json;
  }

  async listFields(resource) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 100; page += 1) {
      const params = new URLSearchParams({
        limit: "500",
        include_fields: "ui_visibility,important_fields,required_fields",
      });
      if (cursor) params.set("cursor", cursor);
      const json = await this.request("GET", "v2", `/${resource}?${params.toString()}`);
      out.push(...(Array.isArray(json.data) ? json.data : []));
      cursor = json.additional_data?.next_cursor ?? null;
      if (!cursor) return out;
    }
    throw new Error(`Pipedrive ${resource} pagination exceeded 100 pages`);
  }

  async applyOperation(op) {
    if (op.type === "updateDealFieldRequired") {
      await this.request("PATCH", "v2", `/dealFields/${encodeURIComponent(op.fieldCode)}`, op.body);
      return;
    }
    if (op.type === "deleteDealField") {
      await this.request("DELETE", "v2", `/dealFields/${encodeURIComponent(op.fieldCode)}`);
      return;
    }
    if (op.type === "deleteProductField") {
      await this.request("DELETE", "v2", `/productFields/${encodeURIComponent(op.fieldCode)}`);
      return;
    }
    if (op.type === "dedupeOrganizationWebsite") {
      throw new Error(
        "Website dedupe needs a data migration pass before deleting the custom field; run this as a reviewed operator step, not a blind bulk archive.",
      );
    }
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const json = process.argv.includes("--json");
  const token = resolveToken();
  if (!token) {
    throw new Error(`Missing Pipedrive token. Set one of: ${TOKEN_ENV_CANDIDATES.join(", ")}`);
  }

  const api = new PipedriveAdminApi({ token, base: baseUrl() });
  const [dealFields, organizationFields, productFields] = await Promise.all([
    api.listFields("dealFields"),
    api.listFields("organizationFields"),
    api.listFields("productFields"),
  ]);
  const plan = buildCleanupPlan({ dealFields, organizationFields, productFields });

  const result = {
    mode: apply ? "apply" : "dry-run",
    plannedOperationCount: plan.operations.length,
    operations: plan.operations,
    unresolved: plan.unresolved,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Pipedrive field cleanup ${result.mode}: ${result.plannedOperationCount} planned operations`);
    for (const op of plan.operations) {
      console.log(`- ${op.type}: ${op.label} (${op.fieldName ?? op.fieldCode})`);
    }
    console.log("Unresolved / needs human confirmation:");
    for (const item of plan.unresolved) console.log(`- ${item.label}: ${item.reason}`);
  }

  if (apply) {
    const applyable = plan.operations.filter((op) => op.type !== "dedupeOrganizationWebsite");
    for (const op of applyable) await api.applyOperation(op);
    console.log(`Applied ${applyable.length} operations. Website dedupe was intentionally left for reviewed migration.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
