#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "data-file": { type: "string" },
    "env-file": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "self-check": { type: "boolean", default: false },
  },
});

function requireAbsolutePath(value, flag) {
  if (!value || !isAbsolute(value)) {
    throw new Error(`${flag} must be an absolute path`);
  }
  return value;
}

function validate(rows) {
  const keys = new Set();
  for (const row of rows) {
    const key = [
      row.registry_source,
      row.registry_type,
      row.registry_id,
      row.naics_code,
      row.evidence_type,
      row.source_url,
    ].join("|");
    if (keys.has(key)) throw new Error(`Duplicate evidence row: ${key}`);
    keys.add(key);
    if (
      row.registry_type !== "group" ||
      row.naics_code !== "811121" ||
      row.evidence_type !== "carrier_appetite" ||
      !row.source_url.startsWith("https://") ||
      row.coverage_types.length === 0
    ) {
      throw new Error(`Invalid appetite evidence: ${row.carrier_name}`);
    }
  }
}

const dataFile = requireAbsolutePath(values["data-file"], "--data-file");
const rows = JSON.parse(await readFile(dataFile, "utf8"));
validate(rows);

const summary = {
  naics_code: "811121",
  carrier_groups: new Set(rows.map((row) => row.registry_id)).size,
  appetite_evidence: rows.length,
  state_authorizations: rows.filter(
    (row) => row.evidence_type === "state_authorization",
  ).length,
  policy_observations: rows.filter(
    (row) => row.evidence_type === "policy_observation",
  ).length,
};

if (values["self-check"]) {
  console.log("Body-shop insurance market self-check passed");
  process.exit(0);
}

if (values["dry-run"]) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const envFile = requireAbsolutePath(values["env-file"], "--env-file");
loadEnvFile(envFile);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
}

const endpoint = new URL(
  "/rest/v1/collision_shop_insurance_appetite_evidence",
  supabaseUrl,
);
endpoint.searchParams.set(
  "on_conflict",
  "registry_source,registry_type,registry_id,naics_code,evidence_type,source_url",
);
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  },
  body: JSON.stringify(rows),
});
if (!response.ok) {
  throw new Error(`Supabase HTTP ${response.status}: ${await response.text()}`);
}

console.log(JSON.stringify(summary, null, 2));
