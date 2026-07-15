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

export const WON_HANDOFF_DEAL_FIELDS = [
  {
    labels: ["Signed Contract / Approval Link", "Signed Contract Link", "PandaDoc Link"],
    create: {
      field_name: "Signed Contract / Approval Link",
      field_type: "varchar",
      description: "PSG-1337: signed agreement, PandaDoc completion, or written approval link required before Won handoff.",
    },
  },
  {
    labels: ["Contract Start Date"],
    create: {
      field_name: "Contract Start Date",
      field_type: "date",
      description: "PSG-1337: signed contract or service start date.",
    },
  },
  {
    labels: ["Expected Delivery Start Date", "Delivery Start Date"],
    create: {
      field_name: "Expected Delivery Start Date",
      field_type: "date",
      description: "PSG-1337: expected date Production can begin delivery.",
    },
  },
  {
    labels: ["Custom Promises / Exclusions / Deadlines", "Custom Promises", "Scope Notes"],
    create: {
      field_name: "Custom Promises / Exclusions / Deadlines",
      field_type: "text",
      description: "PSG-1337: plain-language notes for promises, exclusions, custom scope, or special deadlines.",
    },
  },
  {
    labels: ["Sold Products / SKU Notes", "Product SKU", "Product Code"],
    create: {
      field_name: "Sold Products / SKU Notes",
      field_type: "text",
      description: "PSG-1337: product/service line items, SKU or product code when available, quantity, tier, and frequency notes.",
    },
  },
  {
    labels: ["MSO Parent Company", "Parent Company Name"],
    create: {
      field_name: "MSO Parent Company",
      field_type: "varchar",
      description: "PSG-1337: parent company name when the customer is a multi-shop operator.",
    },
  },
  {
    labels: ["Client Location List", "Location List"],
    create: {
      field_name: "Client Location List",
      field_type: "text",
      description: "PSG-1337: shop/location names and location-specific notes for this sale.",
    },
  },
  {
    labels: ["Billing Model", "Payer Model"],
    create: {
      field_name: "Billing Model",
      field_type: "enum",
      options: [
        { label: "Not applicable / single location" },
        { label: "Parent-paid" },
        { label: "Location-paid" },
        { label: "Split billing" },
      ],
      description: "PSG-1337: how Finance should bill a multi-shop operator or single-location customer.",
    },
  },
  {
    labels: ["Consolidated Invoicing Required"],
    create: {
      field_name: "Consolidated Invoicing Required",
      field_type: "enum",
      options: [{ label: "No" }, { label: "Yes" }, { label: "Not applicable" }],
      description: "PSG-1337: whether Finance must use parent/sub-customer consolidated invoicing.",
    },
  },
  {
    labels: ["Billing Contact Name"],
    create: {
      field_name: "Billing Contact Name",
      field_type: "varchar",
      description: "PSG-1337: billing contact name copied into Invoiced during setup.",
    },
  },
  {
    labels: ["Billing Email"],
    create: {
      field_name: "Billing Email",
      field_type: "varchar",
      description: "PSG-1337: billing email copied into Invoiced during setup.",
    },
  },
  {
    labels: ["Billing Address"],
    create: {
      field_name: "Billing Address",
      field_type: "address",
      description: "PSG-1337: billing mailing address copied into Invoiced during setup.",
    },
  },
  {
    labels: ["Legal Customer Name"],
    create: {
      field_name: "Legal Customer Name",
      field_type: "varchar",
      description: "PSG-1337: legal customer name if different from the shop or organization name.",
    },
  },
  {
    labels: ["Purchase Order Requirement"],
    create: {
      field_name: "Purchase Order Requirement",
      field_type: "text",
      description: "PSG-1337: purchase-order requirement, PO number, or no-PO note.",
    },
  },
  {
    labels: ["Tax Exempt Status"],
    create: {
      field_name: "Tax Exempt Status",
      field_type: "enum",
      options: [{ label: "No" }, { label: "Yes" }, { label: "Unknown / needs Finance" }],
      description: "PSG-1337: tax-exempt status for Finance before invoicing.",
    },
  },
  {
    labels: ["One-Time Setup Fees"],
    create: {
      field_name: "One-Time Setup Fees",
      field_type: "monetary",
      description: "PSG-1337: one-time setup fees from the signed agreement.",
    },
  },
  {
    labels: ["Monthly Recurring Fees"],
    create: {
      field_name: "Monthly Recurring Fees",
      field_type: "monetary",
      description: "PSG-1337: recurring monthly fees from the signed agreement.",
    },
  },
  {
    labels: ["Discounts / Credits"],
    create: {
      field_name: "Discounts / Credits",
      field_type: "text",
      description: "PSG-1337: discounts, credits, waived fees, and expiration dates.",
    },
  },
  {
    labels: ["First Invoice Date"],
    create: {
      field_name: "First Invoice Date",
      field_type: "date",
      description: "PSG-1337: first invoice date Finance should use.",
    },
  },
  {
    labels: ["Payment Terms"],
    create: {
      field_name: "Payment Terms",
      field_type: "enum",
      options: [
        { label: "Due on receipt" },
        { label: "Net 15" },
        { label: "Net 30" },
        { label: "Custom - see notes" },
      ],
      description: "PSG-1337: invoice timing, due date, and payment terms.",
    },
  },
  {
    labels: ["Invoiced Customer / Billing Link", "Invoiced Customer Link", "Invoiced Link"],
    create: {
      field_name: "Invoiced Customer / Billing Link",
      field_type: "varchar",
      description: "PSG-1337: Invoiced customer, invoice, subscription, or consolidated invoice setup link.",
    },
  },
  {
    labels: ["Delivery Template", "Delivery Template Selected"],
    create: {
      field_name: "Delivery Template",
      field_type: "enum",
      options: [
        { label: "New-client onboarding" },
        { label: "New Website Build" },
        { label: "Custom Delivery Project" },
        { label: "Needs Production decision" },
      ],
      description: "PSG-1337: delivery template selected from sold product/SKU or approved manually.",
    },
  },
  {
    labels: ["Missing Access List", "Access Needs"],
    create: {
      field_name: "Missing Access List",
      field_type: "text",
      description: "PSG-1337: needed access, received access, missing access, owner, and due date.",
    },
  },
  {
    labels: ["Asset Request List", "Required Assets"],
    create: {
      field_name: "Asset Request List",
      field_type: "text",
      description: "PSG-1337: product-specific asset checklist and known files already available.",
    },
  },
  {
    labels: ["Google Shared Drive Folder Link", "Google Drive Folder Link", "Client Folder Link"],
    create: {
      field_name: "Google Shared Drive Folder Link",
      field_type: "varchar",
      description: "PSG-1337: client shared-drive folder with the standard handoff folder structure.",
    },
  },
  {
    labels: ["Delivery Owner"],
    create: {
      field_name: "Delivery Owner",
      field_type: "user",
      description: "PSG-1337: accountable delivery owner for kickoff and client communication.",
    },
  },
  {
    labels: ["Backup Delivery Owner"],
    create: {
      field_name: "Backup Delivery Owner",
      field_type: "user",
      description: "PSG-1337: backup delivery owner if the main delivery owner is unavailable.",
    },
  },
  {
    labels: ["Pipedrive Delivery Project Link", "Delivery Project Link"],
    create: {
      field_name: "Pipedrive Delivery Project Link",
      field_type: "varchar",
      description: "PSG-1337: created delivery project or projects linked back to the won deal.",
    },
  },
  {
    labels: ["Finance Handoff Sign-Off"],
    create: {
      field_name: "Finance Handoff Sign-Off",
      field_type: "enum",
      options: [{ label: "Not ready" }, { label: "Ready" }, { label: "Blocked - see notes" }],
      description: "PSG-1337: Finance confirms billing can be created accurately before delivery starts.",
    },
  },
  {
    labels: ["Production Handoff Sign-Off"],
    create: {
      field_name: "Production Handoff Sign-Off",
      field_type: "enum",
      options: [{ label: "Not ready" }, { label: "Ready" }, { label: "Blocked - see notes" }],
      description: "PSG-1337: Production confirms scope, template, owner, access, assets, and folder are ready.",
    },
  },
  {
    labels: ["Handoff Complete"],
    create: {
      field_name: "Handoff Complete",
      field_type: "enum",
      options: [{ label: "No" }, { label: "Yes" }, { label: "Exception approved" }],
      description: "PSG-1337: marked only after Sales, Finance, and Production confirm readiness.",
    },
  },
];

const PRODUCT_FIELDS_TO_ARCHIVE = ["Income Account", "Expense Account", "Supplier"];
const CUSTOM_LOST_REASON_LABELS = ["Lost Reason (custom enum)", "Lost Reason"];
const APPLY_EXCLUDED_OPERATION_TYPES = new Set(["dedupeOrganizationWebsite"]);

const LIVE_APPLY_SCOPE = {
  included: [
    "Required deal-field rules for PSG Sales pipeline 8",
    "Won-stage handoff fields and required-on-Won rules",
    "Dead product field removals for Income Account, Expense Account, and Supplier",
  ],
  excluded: [
    {
      label: "Lost Reason consolidation",
      reason:
        "Pipedrive's field API rejects required_fields updates on the built-in lost_reason field. Keep the custom duplicate until the built-in Lost Reason is confirmed required through Pipedrive UI or a supported vendor endpoint.",
    },
    {
      label: "Organization Website dedupe",
      reason:
        "Dry-run detects the duplicate fields, but live --apply does not delete the custom Website field until a reviewed data migration copies any custom values into the kept Website field.",
    },
    {
      label: "Contact phone-or-email",
      reason:
        "Pipedrive's deal-field required_fields API cannot express 'the linked contact must have either phone or email'. Enforce this through a reviewed Pipedrive automation, validation workflow, or follow-up API check before live rollout.",
    },
    {
      label: "First Contact Date auto-stamp",
      reason:
        "Handled by the Pipedrive webhook in apps/psg-hub/src/app/api/webhooks/pipedrive/route.ts when a sales deal first reaches Discovery; this script only makes the field required at Discovery.",
    },
    {
      label: "qbo_item_id backfill",
      reason:
        "Protected from deletion; Finance still needs to supply the source QuickBooks item-link file before blanks can be populated.",
    },
    {
      label: "Legacy warranty/letter/header organization fields",
      reason:
        "Protected from bulk archive until each field is confirmed as unused by warranty-letter and customer-portal generation.",
    },
  ],
};

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

function mergeRequiredFields(existing, additions, opts = {}) {
  const current = existing && typeof existing === "object" ? existing : {};
  const stageIds = new Set(Array.isArray(current.stage_ids) ? current.stage_ids.map(Number) : []);
  if (opts.activeStageIds) {
    for (const id of [...stageIds]) {
      if (!opts.activeStageIds.has(id)) stageIds.delete(id);
    }
  }
  for (const id of additions.stageIds ?? []) stageIds.add(Number(id));

  const statuses = {};
  for (const [pipelineId, values] of Object.entries(current.statuses ?? {})) {
    if (opts.activePipelineIds && !opts.activePipelineIds.has(Number(pipelineId))) continue;
    statuses[pipelineId] = Array.isArray(values) ? [...values] : [];
  }
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

function requiredFieldOperation(field, label, additions, opts = {}) {
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
      required_fields: mergeRequiredFields(field.required_fields, additions, opts),
      show_in_pipelines: { show_in_all: false, pipeline_ids: [PSG_SALES_PIPELINE_ID] },
    },
  };
}

function createDealFieldOperation(spec) {
  return {
    type: "createDealField",
    label: spec.create.field_name,
    fieldName: spec.create.field_name,
    body: {
      ...spec.create,
      ui_visibility: {
        add_visible_flag: true,
        details_visible_flag: true,
        projects_detail_visible_flag: true,
      },
      show_in_pipelines: { show_in_all: false, pipeline_ids: [PSG_SALES_PIPELINE_ID] },
      required_fields: {
        enabled: true,
        stage_ids: [],
        statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["won"] },
      },
    },
  };
}

export function buildCleanupPlan({
  dealFields,
  organizationFields,
  productFields,
  activeStageIds,
  activePipelineIds,
}) {
  const operations = [];
  const unresolved = [];
  const requiredFieldOpts = { activeStageIds, activePipelineIds };
  const notices = [
    {
      label: "First Contact Date auto-stamp",
      status: "handled outside this script",
      reason:
        "The Pipedrive webhook stamps this field once when a PSG Sales deal first reaches Discovery and the field is still blank.",
    },
  ];

  for (const spec of REQUIRED_DEAL_FIELDS) {
    const field = findField(dealFields, spec.labels, (f) => !isDeleted(f));
    if (!field) {
      unresolved.push({
        label: spec.labels[0],
        reason: `field not found; cannot require it at stage(s) ${spec.stageIds.join(", ")}`,
      });
      continue;
    }
    operations.push(
      requiredFieldOperation(field, spec.labels[0], { stageIds: spec.stageIds }, requiredFieldOpts),
    );
  }

  for (const spec of WON_HANDOFF_DEAL_FIELDS) {
    const field = findField(dealFields, spec.labels, (f) => !isDeleted(f));
    if (!field) {
      operations.push(createDealFieldOperation(spec));
      continue;
    }
    operations.push(
      requiredFieldOperation(field, spec.create.field_name, {
        statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["won"] },
      }, requiredFieldOpts),
    );
  }

  const builtInLostReason = findField(
    dealFields,
    ["lost_reason", "Lost reason", "Lost Reason"],
    (f) => !isDeleted(f) && (cleanLabel(f.key) === "lost reason" || cleanLabel(f.key) === "lost reason" || isBuiltIn(f)),
  ) ?? findField(dealFields, ["lost_reason"], (f) => !isDeleted(f));
  if (builtInLostReason) {
    unresolved.push({
      label: "Lost Reason required-on-lost",
      reason:
        "Pipedrive rejects required_fields updates on the built-in lost_reason field through the field API; configure or confirm this in Pipedrive UI before archiving the custom duplicate",
    });
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
    unresolved.push({
      label: "Custom Lost Reason",
      reason:
        "kept until the built-in Lost Reason field is confirmed required on Lost; then this duplicate can be archived safely",
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
    label: "Contact phone-or-email",
    reason:
      "not applied by this script; Pipedrive deal-field rules cannot require either phone or email on the linked contact through the field admin API",
  });
  unresolved.push({
    label: "qbo_item_id",
    reason: "kept by design; CFO John still needs the source QuickBooks item-link file before we can populate blanks",
  });
  unresolved.push({
    label: "Legacy warranty/letter/header organization fields",
    reason: "not archived by this script; each field must be confirmed as orphaned from warranty-letter and portal generation first",
  });
  return { operations, unresolved, notices, liveApplyScope: LIVE_APPLY_SCOPE };
}

function applyableOperations(operations) {
  return operations.filter((op) => !APPLY_EXCLUDED_OPERATION_TYPES.has(op.type));
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

  async listResource(resource) {
    const out = [];
    let cursor = null;
    for (let page = 0; page < 100; page += 1) {
      const params = new URLSearchParams({ limit: "500" });
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
    if (op.type === "createDealField") {
      await this.request("POST", "v2", "/dealFields", op.body);
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
  const [dealFields, organizationFields, productFields, stages, pipelines] = await Promise.all([
    api.listFields("dealFields"),
    api.listFields("organizationFields"),
    api.listFields("productFields"),
    api.listResource("stages"),
    api.listResource("pipelines"),
  ]);
  const activeStageIds = new Set(
    stages
      .filter((stage) => stage.active_flag !== false && stage.is_deleted !== true)
      .map((stage) => Number(stage.id))
      .filter(Number.isFinite),
  );
  const activePipelineIds = new Set(
    pipelines
      .filter((pipeline) => pipeline.active_flag !== false && pipeline.is_deleted !== true)
      .map((pipeline) => Number(pipeline.id))
      .filter(Number.isFinite),
  );
  const plan = buildCleanupPlan({
    dealFields,
    organizationFields,
    productFields,
    activeStageIds,
    activePipelineIds,
  });
  const applyable = applyableOperations(plan.operations);

  const result = {
    mode: apply ? "apply" : "dry-run",
    plannedOperationCount: plan.operations.length,
    applyableOperationCount: applyable.length,
    operations: plan.operations,
    unresolved: plan.unresolved,
    notices: plan.notices,
    liveApplyScope: plan.liveApplyScope,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Pipedrive field cleanup ${result.mode}: ${result.plannedOperationCount} planned operations`);
    for (const op of plan.operations) {
      console.log(`- ${op.type}: ${op.label} (${op.fieldName ?? op.fieldCode})`);
    }
    console.log(`Apply scope: ${applyable.length} of ${plan.operations.length} operations run with --apply.`);
    console.log("Excluded from live --apply:");
    for (const item of LIVE_APPLY_SCOPE.excluded) console.log(`- ${item.label}: ${item.reason}`);
    console.log("Handled by other guardrails:");
    for (const item of plan.notices) console.log(`- ${item.label}: ${item.reason}`);
    console.log("Unresolved / needs human confirmation:");
    for (const item of plan.unresolved) console.log(`- ${item.label}: ${item.reason}`);
  }

  if (apply) {
    for (const op of applyable) await api.applyOperation(op);
    console.log(
      `Applied ${applyable.length} operations. Website dedupe and contact phone-or-email validation were intentionally left for reviewed follow-up work.`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
