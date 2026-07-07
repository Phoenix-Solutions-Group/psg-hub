#!/usr/bin/env node
// PSG-617 (parent PSG-614) — production == code OBJECT-parity drift check.
//
// WHY THIS EXISTS (and why it is NOT the same as check-migration-drift.mjs):
// check-migration-drift.mjs reconciles the migration LEDGER — "is every repo
// migration recorded as applied?". That check is blind to objects that exist in
// prod with NO ledger row at all. PSG-614 found exactly that: prod carried four
// tables (billing_memory_decisions, billing_run_history, invoiced_catalog_items,
// invoiced_customer_cache) plus a `monthly-reports` storage bucket that no repo
// file created AND that had no (matching) ledger entry — so the ledger check could
// not see them, and a from-scratch rebuild would silently drop them. This check
// closes that gap by comparing the actual set of PUBLIC tables + storage buckets in
// a live database against the committed code manifest (supabase/schema-manifest.json,
// = what a clean `supabase db reset` produces). It catches drift in BOTH directions:
//   • prod-only object  -> in the DB but not in code -> capture it into a migration
//   • code-only object  -> in code but not in the DB -> apply the migration
//
// WHY OBJECTS, NOT VERSIONS: Supabase re-stamps the migration `version` at apply
// time (two-track authoring — machine vs. hand-typed timestamps), so a version-list
// diff produces dozens of false positives (34, at PSG-614 time). Objects are the
// stable truth.
//
// USAGE:
//   Live mode (CI / operator with DB access):
//     SUPABASE_DB_URL="postgres://...:5432/postgres" node scripts/check-schema-drift.mjs
//     (uses `psql`, preinstalled on GitHub ubuntu runners; pooler URL ok)
//
//   File mode (no DB client; paste the object list from MCP execute_sql):
//     # run this ONE query via MCP execute_sql / psql against the target DB:
//     #   select json_build_object(
//     #     'tables', (select coalesce(json_agg(table_name order by table_name),'[]')
//     #                from information_schema.tables
//     #                where table_schema='public' and table_type='BASE TABLE'
//     #                  and table_name <> 'schema_migrations'),
//     #     'storageBuckets', (select coalesce(json_agg(id order by id),'[]') from storage.buckets));
//     node scripts/check-schema-drift.mjs --objects-file /tmp/objects.json
//
//   Regenerate the manifest from a CLEAN code-built DB (never from prod):
//     node scripts/check-schema-drift.mjs --generate --objects-file /tmp/objects.json > apps/psg-hub/supabase/schema-manifest.json
//
// EXIT CODES: 0 = no drift. 1 = drift found OR usage/connection error. 2 = skipped
// (no DB URL and no --objects-file): non-fatal so CI can no-op until SUPABASE_DB_URL
// is wired, then it enforces automatically. Mirrors check-migration-drift.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = process.env.SCHEMA_MANIFEST
  ? resolve(process.env.SCHEMA_MANIFEST)
  : resolve(__dirname, '../apps/psg-hub/supabase/schema-manifest.json');

const OBJECTS_SQL =
  "select json_build_object(" +
  "'tables', (select coalesce(json_agg(table_name order by table_name),'[]') " +
  "from information_schema.tables where table_schema='public' and table_type='BASE TABLE' " +
  "and table_name <> 'schema_migrations'), " +
  "'storageBuckets', (select coalesce(json_agg(id order by id),'[]') from storage.buckets))";

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`[schema-drift] manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  return {
    tables: new Set(m.tables ?? []),
    buckets: new Set(m.storageBuckets ?? []),
    extensionOwned: new Set(m.extensionOwnedTables ?? []),
  };
}

// Accept either the raw json_build_object row, or a {tables, storageBuckets} object.
function normalizeObjects(parsed) {
  const obj = Array.isArray(parsed)
    ? (parsed[0]?.json_build_object ?? parsed[0] ?? {})
    : (parsed.json_build_object ?? parsed);
  return {
    tables: (obj.tables ?? []).map(String),
    buckets: (obj.storageBuckets ?? obj.buckets ?? []).map(String),
  };
}

function objectsFromFile(path) {
  const raw = readFileSync(path, 'utf8').trim();
  return normalizeObjects(JSON.parse(raw));
}

function objectsFromDb(dbUrl) {
  let out;
  try {
    out = execFileSync('psql', [dbUrl, '-tAc', OBJECTS_SQL], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error('[schema-drift] failed to query object list via psql.');
    console.error('[schema-drift] ensure `psql` is installed and SUPABASE_DB_URL is valid.');
    console.error(String(err.stderr || err.message || err).trim());
    process.exit(1);
  }
  return normalizeObjects(JSON.parse(out.trim()));
}

function diff(setA, arrB) {
  return arrB.filter((x) => !setA.has(x)).sort();
}

function main() {
  const argv = process.argv.slice(2);
  const generate = argv.includes('--generate');
  const fileFlagIdx = argv.indexOf('--objects-file');
  const objectsFile = fileFlagIdx !== -1 ? argv[fileFlagIdx + 1] : null;
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';

  let live;
  if (objectsFile) {
    live = objectsFromFile(resolve(process.cwd(), objectsFile));
  } else if (dbUrl) {
    live = objectsFromDb(dbUrl);
  } else if (!generate) {
    console.warn('[schema-drift] SKIPPED: set SUPABASE_DB_URL (live) or pass --objects-file <path>.');
    process.exit(2);
  } else {
    console.error('[schema-drift] --generate needs a source: SUPABASE_DB_URL or --objects-file.');
    process.exit(1);
  }

  const manifest = loadManifest();

  // --generate: emit a fresh manifest from the (code-built) source DB.
  if (generate) {
    const out = {
      $comment:
        'PSG-617 — canonical PUBLIC objects the repo produces. Regenerate from a CLEAN code-built DB with: node scripts/check-schema-drift.mjs --generate. Keys on objects, not version strings.',
      generatedFrom: objectsFile ? `--objects-file ${objectsFile}` : 'SUPABASE_DB_URL',
      extensionOwnedTables: [...manifest.extensionOwned].sort(),
      tables: live.tables.filter((t) => !manifest.extensionOwned.has(t)).sort(),
      storageBuckets: live.buckets.slice().sort(),
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  // Ignore extension-owned tables in both directions (e.g. postgis spatial_ref_sys).
  const liveTables = live.tables.filter((t) => !manifest.extensionOwned.has(t));

  const prodOnlyTables = diff(manifest.tables, liveTables);
  const codeOnlyTables = diff(new Set(liveTables), [...manifest.tables]);
  const prodOnlyBuckets = diff(manifest.buckets, live.buckets);
  const codeOnlyBuckets = diff(new Set(live.buckets), [...manifest.buckets]);

  console.log(
    `[schema-drift] live: ${liveTables.length} tables, ${live.buckets.length} buckets | ` +
      `manifest: ${manifest.tables.size} tables, ${manifest.buckets.size} buckets`,
  );

  const drift =
    prodOnlyTables.length + codeOnlyTables.length + prodOnlyBuckets.length + codeOnlyBuckets.length;

  if (drift === 0) {
    console.log('[schema-drift] OK — live objects match the code manifest. No drift.');
    process.exit(0);
  }

  console.error(`\n[schema-drift] DRIFT DETECTED — ${drift} object(s) differ:`);
  if (prodOnlyTables.length) {
    console.error(`\n  DB-ONLY tables (exist live, NOT in code — capture into a migration):`);
    for (const t of prodOnlyTables) console.error(`    ✗ ${t}`);
  }
  if (codeOnlyTables.length) {
    console.error(`\n  CODE-ONLY tables (in code, NOT applied live — apply the migration):`);
    for (const t of codeOnlyTables) console.error(`    ✗ ${t}`);
  }
  if (prodOnlyBuckets.length) {
    console.error(`\n  DB-ONLY storage buckets (exist live, NOT in code — capture):`);
    for (const b of prodOnlyBuckets) console.error(`    ✗ ${b}`);
  }
  if (codeOnlyBuckets.length) {
    console.error(`\n  CODE-ONLY storage buckets (in code, NOT applied live — apply):`);
    for (const b of codeOnlyBuckets) console.error(`    ✗ ${b}`);
  }
  console.error('\n[schema-drift] Reconcile per docs/runbooks/supabase-migration-apply.md.');
  console.error('[schema-drift] After a legitimate schema change, regenerate the manifest from a');
  console.error('[schema-drift] CLEAN code-built DB: node scripts/check-schema-drift.mjs --generate.');
  process.exit(1);
}

main();
