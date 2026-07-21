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

function resolveApiKey(env = process.env) {
  for (const name of API_KEY_ENV_CANDIDATES) {
    const value = env[name]?.trim();
    if (value) return { value, source: name };
  }
  return null;
}

function normalizeCaseId(input) {
  const compact = String(input).trim().toLowerCase().replace(/[\s-]+/g, "");
  const explicit = compact.match(/^(sn|rn)(\d+)$/);
  if (explicit) return `${explicit[1]}${explicit[2]}`;
  if (/^\d+$/.test(compact)) return `sn${compact}`;
  throw new Error(
    `Invalid USPTO case id "${input}". Use sn12345678 for a serial number or rn1234567 for a registration number.`
  );
}

async function lookup(caseId, apiKey) {
  const url = `${BASE_URL}/casestatus/${normalizeCaseId(caseId)}/info.json`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "USPTO-API-KEY": apiKey,
    },
  });

  if (!res.ok) {
    const body = (await res.text()).replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(
      body ? `USPTO TSDR HTTP ${res.status}: ${body}` : `USPTO TSDR HTTP ${res.status}`
    );
  }

  return res.json();
}

function usage() {
  console.error(
    [
      "Usage: node apps/psg-hub/scripts/uspto-tsdr-lookup.mjs sn78787878 [rn1234567 ...]",
      "",
      "Set USPTO_TSDR_API_KEY in the shell, .env.local, or deployment secret store.",
      "Use tmsearch.uspto.gov first to find candidate serial or registration numbers, then run this helper to pull official TSDR status details.",
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
    results.push({ caseId: normalizeCaseId(caseId), data });
  }

  console.log(JSON.stringify({ source: "USPTO TSDR", results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
