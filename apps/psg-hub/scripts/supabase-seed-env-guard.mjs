import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SUPABASE_SEED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const PROCESS_ENV_SOURCE = "process environment";

function displayPath(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const entries = [];
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    entries.push([key, rawValue.replace(/^['"]|['"]$/g, "")]);
  }
  return entries;
}

export function loadSeedEnvFiles(filePaths, env = process.env) {
  const sources = {};
  for (const key of SUPABASE_SEED_KEYS) {
    if (env[key] !== undefined) sources[key] = PROCESS_ENV_SOURCE;
  }

  for (const filePath of filePaths) {
    for (const [key, value] of parseEnvFile(filePath)) {
      if (env[key] !== undefined) continue;
      env[key] = value;
      if (SUPABASE_SEED_KEYS.includes(key)) {
        sources[key] = displayPath(filePath);
      }
    }
  }

  return sources;
}

export function assertSupabaseSeedEnvNotCrossWired(sources, env = process.env) {
  const urlSource = sources.NEXT_PUBLIC_SUPABASE_URL;
  const keySource = sources.SUPABASE_SERVICE_ROLE_KEY;
  if (!urlSource || !keySource || urlSource === keySource) return;
  if (env.SUPABASE_SEED_ALLOW_MIXED_ENV === "1") return;

  throw new Error(
    [
      "Refusing to run Supabase seed with mixed environment sources.",
      `NEXT_PUBLIC_SUPABASE_URL came from ${urlSource}.`,
      `SUPABASE_SERVICE_ROLE_KEY came from ${keySource}.`,
      "Use one matching env file for both values, or set SUPABASE_SEED_ALLOW_MIXED_ENV=1 if you have manually verified the URL and key belong to the same Supabase project.",
    ].join(" ")
  );
}
