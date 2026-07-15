#!/usr/bin/env node
// PSG-1493 — reviewed Pipedrive Organization Website dedupe.
//
// Default is dry-run:
//   node --env-file=.env.local scripts/pipedrive-organization-website-dedupe.mjs
//
// Reviewed copy step only:
//   node --env-file=.env.local scripts/pipedrive-organization-website-dedupe.mjs --apply-copy
//
// This script never archives the duplicate field. Archiving must be a separate reviewed
// operator action after this report shows zero conflicts and the copy step has been verified.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TOKEN_ENV_CANDIDATES = [
  "PIPEDRIVE_API_TOKEN",
  "PIPEDRIVE_TOKEN",
  "PIPEDRIVE_API_KEY",
];

const BUILT_IN_WEBSITE_CODE = "website";
const CUSTOM_WEBSITE_CODE = "6ea223d17fb76811dc47ae73d35610559621cf39";
const DEFAULT_REPORT_DIR = "artifacts/pipedrive-organization-website-dedupe";

function clean(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

export function normalizeWebsite(value) {
  const text = clean(value);
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

export function isCopyableWebsiteValue(value) {
  const text = clean(value);
  if (!text) return false;
  if (/[,;\s]/.test(text)) return false;
  return normalizeWebsite(text).includes(".");
}

export function classifyOrganizationWebsite(row, fields = {}) {
  const keptKey = fields.keptKey ?? BUILT_IN_WEBSITE_CODE;
  const duplicateKey = fields.duplicateKey ?? CUSTOM_WEBSITE_CODE;
  const keptValue = clean(row[keptKey]);
  const duplicateValue = clean(row[duplicateKey]);
  const keptNormalized = normalizeWebsite(keptValue);
  const duplicateNormalized = normalizeWebsite(duplicateValue);

  if (!keptValue && duplicateValue) {
    return isCopyableWebsiteValue(duplicateValue) ? "copy" : "needs_review";
  }
  if (keptValue && duplicateValue && keptNormalized !== duplicateNormalized) return "conflict";
  if (keptValue && duplicateValue) return "same";
  if (keptValue && !duplicateValue) return "keeper_only";
  return "blank";
}

export function buildWebsiteDedupeReport({
  organizations,
  keeperField,
  duplicateField,
}) {
  const counts = {
    totalOrganizations: organizations.length,
    copy: 0,
    conflict: 0,
    needsReview: 0,
    same: 0,
    keeperOnly: 0,
    blank: 0,
  };
  const rows = [];

  for (const org of organizations) {
    const status = classifyOrganizationWebsite(org, {
      keptKey: keeperField.code,
      duplicateKey: duplicateField.code,
    });
    if (status === "copy") counts.copy += 1;
    else if (status === "conflict") counts.conflict += 1;
    else if (status === "needs_review") counts.needsReview += 1;
    else if (status === "same") counts.same += 1;
    else if (status === "keeper_only") counts.keeperOnly += 1;
    else counts.blank += 1;

    if (status === "copy" || status === "conflict" || status === "needs_review") {
      rows.push({
        id: org.id,
        name: org.name,
        status,
        keptWebsite: clean(org[keeperField.code]),
        duplicateWebsite: clean(org[duplicateField.code]),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    fields: {
      keeper: keeperField,
      duplicate: duplicateField,
    },
    counts,
    rows,
    archiveAllowed: false,
    archiveGuard:
      "Do not archive the duplicate Website field until this report is reviewed, conflicts are resolved, and a copy verification shows zero custom-only values remain.",
  };
}

export function buildMarkdownReport(report) {
  const lines = [
    "# Pipedrive Organization Website Dedupe Dry Run",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Fields",
    "",
    `- Keeper: ${report.fields.keeper.name} (${report.fields.keeper.code})`,
    `- Duplicate: ${report.fields.duplicate.name} (${report.fields.duplicate.code})`,
    "",
    "## Counts",
    "",
    `- Organizations checked: ${report.counts.totalOrganizations}`,
    `- Would copy from duplicate into keeper: ${report.counts.copy}`,
    `- Conflicts needing review: ${report.counts.conflict}`,
    `- Custom-only values needing manual review: ${report.counts.needsReview}`,
    `- Already matching in both fields: ${report.counts.same}`,
    `- Keeper already populated and duplicate blank: ${report.counts.keeperOnly}`,
    `- Both fields blank: ${report.counts.blank}`,
    "",
    "## Archive Guard",
    "",
    report.archiveGuard,
    "",
  ];

  if (report.rows.length > 0) {
    lines.push("## Copy Or Conflict Rows", "");
    lines.push("| Organization ID | Organization | Status | Keeper Website | Duplicate Website |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of report.rows) {
      lines.push(
        `| ${row.id} | ${escapeMarkdownTable(row.name)} | ${row.status} | ${escapeMarkdownTable(row.keptWebsite ?? "")} | ${escapeMarkdownTable(row.duplicateWebsite ?? "")} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function escapeMarkdownTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
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

class PipedriveApi {
  constructor({ token, base }) {
    this.token = token;
    this.base = base;
  }

  async request(method, apiVersion, pathName, body) {
    const url = new URL(`${this.base}/api/${apiVersion}${pathName}`);
    url.searchParams.set("api_token", this.token);
    const res = await fetch(url.toString(), {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Pipedrive ${method} ${pathName} returned HTTP ${res.status}`);
    const json = await res.json();
    if (json?.success === false) throw new Error(`Pipedrive ${method} ${pathName} returned success=false`);
    return json;
  }

  async listOrganizationFields() {
    const json = await this.request("GET", "v2", "/organizationFields?limit=500");
    return Array.isArray(json.data) ? json.data : [];
  }

  async listOrganizations() {
    const out = [];
    let start = 0;
    for (let page = 0; page < 1000; page += 1) {
      const params = new URLSearchParams({ start: String(start), limit: "500" });
      const json = await this.request("GET", "v1", `/organizations?${params.toString()}`);
      out.push(...(Array.isArray(json.data) ? json.data : []));
      const pagination = json.additional_data?.pagination;
      if (!pagination?.more_items_in_collection) return out;
      start = Number(pagination.next_start);
      if (!Number.isFinite(start)) throw new Error("Pipedrive organizations pagination did not return next_start");
    }
    throw new Error("Pipedrive organizations pagination exceeded 1000 pages");
  }

  async updateOrganization(id, patch) {
    await this.request("PUT", "v1", `/organizations/${encodeURIComponent(String(id))}`, patch);
  }
}

function fieldName(field) {
  return field?.field_name ?? field?.name ?? field?.key ?? "";
}

function fieldCode(field) {
  return field?.field_code ?? field?.key ?? field?.id ?? null;
}

function identifyWebsiteFields(fields) {
  const keeper = fields.find((field) => fieldCode(field) === BUILT_IN_WEBSITE_CODE);
  const duplicate = fields.find((field) => fieldCode(field) === CUSTOM_WEBSITE_CODE);
  if (!keeper || !duplicate) {
    throw new Error("Could not identify both Organization Website fields in Pipedrive");
  }
  return {
    keeper: { name: fieldName(keeper), code: String(fieldCode(keeper)) },
    duplicate: { name: fieldName(duplicate), code: String(fieldCode(duplicate)) },
  };
}

async function writeReports(report, reportDir) {
  await mkdir(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, "report.json");
  const markdownPath = path.join(reportDir, "report.md");
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(markdownPath, buildMarkdownReport(report)),
  ]);
  return { jsonPath, markdownPath };
}

async function applyCopy(api, report) {
  if (report.counts.conflict > 0) {
    throw new Error("Refusing --apply-copy while conflicts exist. Resolve or review conflicts first.");
  }
  for (const row of report.rows.filter((item) => item.status === "copy")) {
    await api.updateOrganization(row.id, {
      [report.fields.keeper.code]: row.duplicateWebsite,
    });
  }
}

async function main() {
  const applyCopyFlag = process.argv.includes("--apply-copy");
  const json = process.argv.includes("--json");
  const reportDirArg = process.argv.find((arg) => arg.startsWith("--report-dir="));
  const reportDir = reportDirArg ? reportDirArg.slice("--report-dir=".length) : DEFAULT_REPORT_DIR;
  const token = resolveToken();
  if (!token) {
    throw new Error(`Missing Pipedrive token. Set one of: ${TOKEN_ENV_CANDIDATES.join(", ")}`);
  }

  const api = new PipedriveApi({ token, base: baseUrl() });
  const fields = identifyWebsiteFields(await api.listOrganizationFields());
  const organizations = await api.listOrganizations();
  const report = buildWebsiteDedupeReport({
    organizations,
    keeperField: fields.keeper,
    duplicateField: fields.duplicate,
  });
  if (applyCopyFlag) {
    report.mode = "apply-copy";
    await applyCopy(api, report);
  }
  const paths = await writeReports(report, reportDir);

  if (json) {
    console.log(JSON.stringify({ ...report, paths }, null, 2));
    return;
  }

  console.log(`Pipedrive Organization Website dedupe ${report.mode}`);
  console.log(`Keeper: ${report.fields.keeper.name} (${report.fields.keeper.code})`);
  console.log(`Duplicate: ${report.fields.duplicate.name} (${report.fields.duplicate.code})`);
  console.log(`Organizations checked: ${report.counts.totalOrganizations}`);
  console.log(`Would copy: ${report.counts.copy}`);
  console.log(`Conflicts: ${report.counts.conflict}`);
  console.log(`Needs manual review: ${report.counts.needsReview}`);
  console.log(`Already matching: ${report.counts.same}`);
  console.log(`Keeper-only: ${report.counts.keeperOnly}`);
  console.log(`Both blank: ${report.counts.blank}`);
  console.log(`Report: ${paths.markdownPath}`);
  console.log("Archive duplicate: NOT performed by this script.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
