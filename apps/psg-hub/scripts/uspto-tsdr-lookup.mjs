#!/usr/bin/env node
// PSG-2192 — delivery helper for the branding trademark knock-out check.
//
// This verifies and retrieves official USPTO TSDR status data for candidate
// serial or registration numbers found during a basic trademark search.
//
// Usage:
//   USPTO_TSDR_API_KEY=... node apps/psg-hub/scripts/uspto-tsdr-lookup.mjs sn78787878 rn1234567
//   node --env-file=apps/psg-hub/.env.local apps/psg-hub/scripts/uspto-tsdr-lookup.mjs 78787878

const API_KEY_ENV_CANDIDATES = ["USPTO_TSDR_API_KEY", "USPTO_API_KEY"];
const BASE_URL = "https://tsdrapi.uspto.gov/ts/cd";
const STATUS_ENDPOINTS = [
  {
    format: "json",
    accept: "application/json",
    buildUrl: (caseId) =>
      `${BASE_URL}/last-update/info.json?${buildCaseQueryParam(caseId)}`,
  },
  { format: "xml", path: "info.xml", accept: "application/xml" },
  { format: "html", path: "content", accept: "text/html" },
];

function resolveApiKey(env = process.env) {
  for (const name of API_KEY_ENV_CANDIDATES) {
    const value = env[name]?.trim();
    if (value) return { value, source: name };
  }
  return null;
}

function normalizeCaseId(input) {
  const compact = String(input).trim().toLowerCase().replace(/[\s,-]+/g, "");
  const explicit = compact.match(/^(sn|rn|ref|ir)([a-z0-9]+)$/);
  if (explicit) return `${explicit[1]}${explicit[2]}`;
  if (/^\d+$/.test(compact)) {
    if (compact.length === 8) return `sn${compact}`;
    if (compact.length === 7) return `rn${compact}`;
  }
  throw new Error(
    `Invalid USPTO case id "${input}". Use an 8-digit serial number, 7-digit registration number, or explicit sn/rn/ref/ir prefix.`
  );
}

async function lookup(caseId, apiKey) {
  const normalizedCaseId = normalizeCaseId(caseId);
  let lastNotFound = null;

  for (const endpoint of STATUS_ENDPOINTS) {
    const url =
      typeof endpoint.buildUrl === "function"
        ? endpoint.buildUrl(normalizedCaseId)
        : `${BASE_URL}/casestatus/${normalizedCaseId}/${endpoint.path}`;
    const res = await fetch(url, {
      headers: {
        Accept: endpoint.accept,
        "USPTO-API-KEY": apiKey,
      },
    });

    if (!res.ok) {
      const body = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 500);
      const message = body
        ? `USPTO TSDR HTTP ${res.status} for ${url}: ${body}`
        : `USPTO TSDR HTTP ${res.status} for ${url}`;
      if (res.status === 404) {
        lastNotFound = new Error(message);
        continue;
      }
      throw new Error(message);
    }

    return {
      caseId: normalizedCaseId,
      format: endpoint.format,
      sourceUrl: url,
      xml: await res.text(),
    };
  }

  throw lastNotFound ?? new Error(`USPTO TSDR case not found for ${normalizedCaseId}.`);
}

function buildCaseQueryParam(normalizedCaseId) {
  const match = String(normalizedCaseId).match(/^(sn|rn|ref|ir)(.+)$/);
  const type = match ? match[1] : "sn";
  const value = match ? match[2] : String(normalizedCaseId);
  return `${type}=${value}`;
}

function usage() {
  console.error(
    [
      "Usage: node apps/psg-hub/scripts/uspto-tsdr-lookup.mjs sn78787878 [rn1234567 ...]",
      "",
      "Set USPTO_TSDR_API_KEY in the shell, .env.local, or deployment secret store.",
      "Use tmsearch.uspto.gov first to find candidate serial or registration numbers, then run this helper to pull official TSDR status details.",
      "Bare 8-digit inputs are treated as serial numbers; bare 7-digit inputs are treated as registration numbers.",
    ].join("\n")
  );
}

async function main() {
  const cases = process.argv.slice(2);
  if (cases.length === 0 || cases.includes("--help") || cases.includes("-h")) {
    usage();
    process.exit(cases.length === 0 ? 1 : 0);
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error("Missing required USPTO_TSDR_API_KEY.");
    usage();
    process.exit(1);
  }

  const results = [];
  for (const caseId of cases) {
    const data = await lookup(caseId, apiKey.value);
    results.push(data);
  }

  console.log(JSON.stringify({ source: "USPTO TSDR", results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
