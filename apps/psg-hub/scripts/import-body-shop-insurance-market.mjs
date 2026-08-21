#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";

const evidenceRules = {
  carrier_appetite: {
    registryTypes: new Set(["group", "company"]),
    scopes: new Set(["national_marketing", "state_specific"]),
  },
  state_authorization: {
    registryTypes: new Set(["company"]),
    scopes: new Set(["state_specific"]),
  },
  policy_observation: {
    registryTypes: new Set(["company"]),
    scopes: new Set(["psg_customer"]),
  },
};

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
    const rules = evidenceRules[row.evidence_type];
    const states = row.state_codes ?? [];
    if (
      row.registry_source !== "naic_loc" ||
      !/^\d+$/.test(row.registry_id) ||
      row.naics_code !== "811121" ||
      !rules?.registryTypes.has(row.registry_type) ||
      !rules.scopes.has(row.evidence_scope) ||
      !Array.isArray(states) ||
      states.some((state) => !/^[A-Z]{2}$/.test(state)) ||
      (row.evidence_scope === "state_specific" && states.length === 0) ||
      (row.evidence_type === "policy_observation" &&
        (states.length === 0 || !row.valid_through)) ||
      typeof row.source_url !== "string" ||
      !row.source_url.startsWith("https://") ||
      !Array.isArray(row.coverage_types) ||
      row.coverage_types.length === 0
    ) {
      throw new Error(`Invalid insurer evidence: ${row.carrier_name}`);
    }
  }
}

function selfCheck() {
  const base = {
    registry_source: "naic_loc",
    naics_code: "811121",
    carrier_name: "Fixture Carrier",
    coverage_types: ["garagekeepers"],
    source_name: "Fixture source",
    observed_on: "2026-08-20",
    is_current: true,
  };
  validate([
    {
      ...base,
      registry_type: "group",
      registry_id: "1",
      evidence_type: "carrier_appetite",
      evidence_scope: "national_marketing",
      state_codes: [],
      source_url: "https://example.com/appetite",
      valid_through: null,
    },
    {
      ...base,
      registry_type: "company",
      registry_id: "2",
      evidence_type: "state_authorization",
      evidence_scope: "state_specific",
      state_codes: ["KS"],
      source_url: "https://example.com/authority",
      valid_through: "2026-12-31",
    },
    {
      ...base,
      registry_type: "company",
      registry_id: "2",
      evidence_type: "policy_observation",
      evidence_scope: "psg_customer",
      state_codes: ["KS"],
      source_url: "https://example.com/policy",
      valid_through: "2026-12-31",
    },
  ]);
  assert.throws(
    () =>
      validate([
        {
          ...base,
          registry_type: "group",
          registry_id: "1",
          evidence_type: "policy_observation",
          evidence_scope: "psg_customer",
          state_codes: [],
          source_url: "https://example.com/invalid-policy",
          valid_through: null,
        },
      ]),
    /Invalid insurer evidence/,
  );
}

if (values["self-check"]) {
  selfCheck();
  console.log("Body-shop insurance market self-check passed");
  process.exit(0);
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
