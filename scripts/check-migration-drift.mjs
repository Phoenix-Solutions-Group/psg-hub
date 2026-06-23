#!/usr/bin/env node
// PSG-197 — Supabase migration drift detector.
//
// WHY THIS EXISTS: the psg-hub deploy pipeline does NOT auto-apply Supabase
// migrations. Vercel deploys `main` as a build-only Next.js app; the only GitHub
// workflow (e2e.yml) runs against a throwaway LOCAL Supabase. Migrations are
// applied by hand (operator "gate batch" via MCP apply_migration, per
// apps/psg-hub/.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md).
// That manual step has been silently skipped before — 7 merged migrations were
// found unapplied in prod (the v1.3 production-mail tables among them, which 500'd
// the Lob webhook). This check makes such drift impossible to miss.
//
// WHY BY NAME, NOT VERSION: Supabase RE-STAMPS the `version` column at apply time
// (especially via MCP apply_migration), so the ledger `version` no longer matches
// the migration filename's timestamp. The stable key is the embedded migration
// NAME — the snake_case slug after the leading `<digits>_` in the filename, which
// the ledger preserves in its `name` column even when re-stamped. So `supabase
// migration list` (version-based) gives false drift here; this reconciles by name.
//
// USAGE:
//   Live mode (CI / operator with DB access):
//     SUPABASE_DB_URL="postgres://...:5432/postgres" node scripts/check-migration-drift.mjs
//     (uses `psql`, which is preinstalled on GitHub ubuntu runners; pooler URL ok)
//
//   File mode (no DB client; paste the applied ledger):
//     # produce the applied list once, via MCP or psql:
//     #   select name from supabase_migrations.schema_migrations order by version;
//     node scripts/check-migration-drift.mjs --applied-file /tmp/applied.txt
//     (file = one applied name per line, OR the raw JSON array from MCP execute_sql)
//
// EXIT CODES: 0 = no drift (every local migration is applied). 1 = drift found
// (one or more local migrations are unapplied) OR a usage/connection error.
// 2 = skipped (no DB URL and no --applied-file): non-fatal so CI can no-op until
// the SUPABASE_DB_URL secret is wired, then it enforces automatically.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// MIGRATIONS_DIR env override exists so the duplicate-version guard and the
// reconciliation can be exercised against a scratch fixture dir (see the
// self-verification in docs/runbooks/supabase-migration-apply.md / PSG-269 QA).
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ? resolve(process.env.MIGRATIONS_DIR)
  : resolve(__dirname, '../apps/psg-hub/supabase/migrations');

// Reduce a filename or ledger name to its stable token sequence. Operators apply
// migrations via MCP with inconsistent names: the timestamp can lead the filename
// (`20260618130000_access_audit_append_only`), be appended by the operator
// (`access_audit_append_only_20260618130000`), or the slug can carry an extra
// version infix (`competitors_engine_v1_6_20260618183000` for `..._competitors`).
// So we strip ALL pure-digit tokens (timestamps wherever they sit), lowercase, and
// compare the remaining token sequences — see migrationApplied() for the match rule.
function tokenize(filenameOrLedgerName) {
  return String(filenameOrLedgerName)
    .replace(/\.sql$/i, '')
    .toLowerCase()
    .split('_')
    .filter((tok) => tok.length > 0 && !/^\d+$/.test(tok));
}

// Human-readable embedded name (display only; not used for matching).
function embeddedName(filename) {
  return tokenize(filename).join('_');
}

// PSG-269 — the migration VERSION is the leading all-digit timestamp token of the
// filename (`20260623130000` in `20260623130000_competitor_monitor_runs.sql`).
// Supabase keys supabase_migrations.schema_migrations on THIS value, so two files
// sharing it is a latent hazard regardless of applied-state — see findDuplicateVersions.
function migrationVersion(filename) {
  const m = /^(\d+)_/.exec(String(filename).replace(/.*\//, ''));
  return m ? m[1] : null;
}

// Find local migration files whose leading version timestamp collides. Returns
// [{ version, files: [...] }] for every version used by >1 file, sorted. This is a
// PURE repo invariant — it needs NO database, so it runs even when the ledger
// reconciliation is skipped (no SUPABASE_DB_URL). A fresh `supabase db push`/`start`
// records a given version ONCE and silently skips later files at that version, so
// the skipped file's DDL never runs (its table is simply absent). PSG-238/PSG-265
// hit exactly this; the fix is a byte-identical rename to a free version slot.
function findDuplicateVersions(local) {
  const byVersion = new Map();
  for (const m of local) {
    const v = migrationVersion(m.file);
    if (!v) continue;
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(m.file);
  }
  return [...byVersion.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([version, files]) => ({ version, files: files.slice().sort() }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

// True if `needle` tokens appear as a contiguous run inside `hay` tokens. This lets
// a repo file (`competitors`) match an operator-renamed ledger entry
// (`competitors engine v1`) WITHOUT letting `monthly_reports` falsely satisfy
// `monthly_reports_claim` (the longer file's tokens are not a run of the shorter
// ledger entry, so it is correctly reported as drift).
function isContiguousSubsequence(needle, hay) {
  if (needle.length === 0) return false;
  if (needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

// A local migration is "applied" iff its token sequence is a contiguous run of
// SOME ledger entry's tokens (exact equality is the length-equal case).
function migrationApplied(fileTokens, appliedTokenLists) {
  return appliedTokenLists.some((appTokens) => isContiguousSubsequence(fileTokens, appTokens));
}

function localMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`[drift] migrations dir not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, name: embeddedName(file), tokens: tokenize(file) }));
}

// Parse the applied ledger from a file into a list of {raw, tokens}: either one
// name per line, or the JSON array MCP execute_sql returns (objects, `name` key).
function appliedFromFile(path) {
  const raw = readFileSync(path, 'utf8').trim();
  let names;
  if (raw.startsWith('[')) {
    names = JSON.parse(raw).map((row) => String(row.name ?? row.version ?? row));
  } else {
    names = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  return names.map((n) => ({ raw: n, tokens: tokenize(n) }));
}

// Live mode: query the ledger via psql (preinstalled on CI runners).
function appliedFromDb(dbUrl) {
  let out;
  try {
    out = execFileSync(
      'psql',
      [dbUrl, '-tAc', 'select name from supabase_migrations.schema_migrations order by version'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    console.error('[drift] failed to query the ledger via psql.');
    console.error('[drift] ensure `psql` is installed and SUPABASE_DB_URL is a valid connection string.');
    console.error(String(err.stderr || err.message || err).trim());
    process.exit(1);
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((n) => ({ raw: n, tokens: tokenize(n) }));
}

function main() {
  const local = localMigrations();

  // PSG-269 — duplicate-version guard. Runs FIRST and unconditionally: it is a pure
  // repo invariant (no DB), so it fails CI even while ledger enforcement is OFF
  // (no SUPABASE_DB_URL). This would have caught the 20260623130000 collision
  // (competitor_monitor_runs / mail_template_approvals) at PR time.
  const duplicateVersions = findDuplicateVersions(local);
  if (duplicateVersions.length) {
    console.error(
      `\n[drift] DUPLICATE MIGRATION VERSION(S) — ${duplicateVersions.length} version prefix(es) used by more than one file:`,
    );
    for (const { version, files } of duplicateVersions) {
      console.error(`         ✗ ${version}`);
      for (const f of files) console.error(`             • ${f}`);
    }
    console.error('\n[drift] Supabase keys schema_migrations on the leading version timestamp, so a fresh');
    console.error("[drift] `supabase db push`/`supabase start` records that version ONCE and SKIPS the");
    console.error("[drift] other file(s) as 'already applied' — their DDL never runs and their tables are");
    console.error('[drift] absent. Rename the colliding file(s) to a free version slot (keep the SQL');
    console.error('[drift] byte-identical). Precedent: PSG-238, PSG-265.');
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  const fileFlagIdx = argv.indexOf('--applied-file');
  const appliedFile = fileFlagIdx !== -1 ? argv[fileFlagIdx + 1] : null;
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';

  let applied;
  if (appliedFile) {
    applied = appliedFromFile(resolve(process.cwd(), appliedFile));
  } else if (dbUrl) {
    applied = appliedFromDb(dbUrl);
  } else {
    console.warn('[drift] SKIPPED: set SUPABASE_DB_URL (live) or pass --applied-file <path>.');
    console.warn('[drift] See docs/runbooks/supabase-migration-apply.md.');
    process.exit(2);
  }

  const appliedTokenLists = applied.map((a) => a.tokens);

  const unapplied = local.filter((m) => !migrationApplied(m.tokens, appliedTokenLists));
  // Ledger entries that no repo file matches. Usually benign (e.g.
  // `monthly_reports_bucket` folded into another file, or squashed history) but
  // worth surfacing so an operator can confirm it is intentional.
  const localTokenLists = local.map((m) => m.tokens);
  const remoteOnly = applied.filter((a) => !localTokenLists.some((lt) => isContiguousSubsequence(lt, a.tokens)));

  console.log(`[drift] local migrations: ${local.length} | applied in ledger: ${applied.length}`);

  if (remoteOnly.length) {
    console.log(`[drift] note — ${remoteOnly.length} ledger entr${remoteOnly.length === 1 ? 'y has' : 'ies have'} no matching repo file (usually benign):`);
    for (const a of remoteOnly) console.log(`         • ${a.raw}`);
  }

  if (unapplied.length === 0) {
    console.log('[drift] OK — every local migration is applied in the target DB. No drift.');
    process.exit(0);
  }

  console.error(`\n[drift] DRIFT DETECTED — ${unapplied.length} migration(s) merged but NOT applied:`);
  for (const m of unapplied) console.error(`         ✗ ${m.file}`);
  console.error('\n[drift] Apply them in timestamp order per docs/runbooks/supabase-migration-apply.md');
  console.error('[drift] (operator gate: review each diff + advisor baseline before applying to prod).');
  process.exit(1);
}

// Run as a CLI unless imported (e.g. by a verification harness pointing
// MIGRATIONS_DIR at a scratch fixture).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

export { tokenize, migrationVersion, findDuplicateVersions, isContiguousSubsequence, migrationApplied };
