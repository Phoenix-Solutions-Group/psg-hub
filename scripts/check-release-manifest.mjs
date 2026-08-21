#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrationApplied, tokenize } from "./check-migration-drift.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifest = resolve(
  repoRoot,
  "apps/psg-hub/supabase/releases/collision-intelligence-20260820.json",
);
const migrationsDir = resolve(repoRoot, "apps/psg-hub/supabase/migrations");

function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  if (!argv[index + 1]) throw new Error(`${flag} requires a value`);
  return argv[index + 1];
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function appliedNames(path) {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  if (!raw.startsWith("["))
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  return JSON.parse(raw).map((row) => String(row.name ?? row.version ?? row));
}

function assertPrefix(applied) {
  const firstPending = applied.indexOf(false);
  const prefixLength = firstPending === -1 ? applied.length : firstPending;
  if (applied.slice(prefixLength).some(Boolean)) {
    throw new Error(
      "ledger has a later release migration while an earlier migration is missing",
    );
  }
  return prefixLength;
}

function validateManifest(path, expectedProjectRef) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (expectedProjectRef && manifest.projectRef !== expectedProjectRef) {
    throw new Error(
      `manifest targets ${manifest.projectRef}, not ${expectedProjectRef}`,
    );
  }
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
    throw new Error("manifest has no migrations");
  }

  const files = manifest.migrations.map(({ file }) => file);
  const sorted = [...files].sort();
  assert.deepEqual(
    files,
    sorted,
    "manifest migrations must be in timestamp order",
  );
  assert.equal(
    new Set(files).size,
    files.length,
    "manifest contains duplicate files",
  );

  for (const migration of manifest.migrations) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(migration.file)) {
      throw new Error(`invalid migration filename: ${migration.file}`);
    }
    const expectedName = migration.file
      .replace(/^\d+_/, "")
      .replace(/\.sql$/, "");
    assert.equal(
      migration.name,
      expectedName,
      `${migration.file} has the wrong apply name`,
    );
    const path = resolve(migrationsDir, migration.file);
    if (!existsSync(path))
      throw new Error(`missing migration: ${migration.file}`);
    assert.equal(
      sha256(path),
      migration.sha256,
      `${migration.file} changed after release review`,
    );
  }
  return manifest;
}

function selfTest() {
  assert.equal(assertPrefix([false, false, false]), 0);
  assert.equal(assertPrefix([true, true, false]), 2);
  assert.equal(assertPrefix([true, true, true]), 3);
  assert.throws(
    () => assertPrefix([true, false, true]),
    /later release migration/,
  );
  console.log("[release] self-test OK");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();

  const manifestPath = resolve(
    flagValue(argv, "--manifest") ?? defaultManifest,
  );
  const projectRef = flagValue(argv, "--project-ref");
  const appliedFile = flagValue(argv, "--applied-file");
  const manifest = validateManifest(manifestPath, projectRef);

  console.log(
    `[release] OK — ${manifest.migrations.length} ordered migration files match reviewed SHA-256 hashes.`,
  );
  console.log(`[release] target: ${manifest.projectRef}`);

  if (!appliedFile) return;

  const appliedTokenLists = appliedNames(resolve(appliedFile)).map(tokenize);
  const applied = manifest.migrations.map((migration) =>
    migrationApplied(tokenize(migration.name), appliedTokenLists),
  );
  const prefixLength = assertPrefix(applied);

  if (prefixLength === manifest.migrations.length) {
    console.log(
      `[release] ledger: ${prefixLength}/${applied.length} applied — release is fully recorded.`,
    );
    return;
  }

  console.log(`[release] ledger: ${prefixLength}/${applied.length} applied.`);
  console.log(`[release] next: ${manifest.migrations[prefixLength].name}`);
}

try {
  main();
} catch (error) {
  console.error(`[release] FAILED — ${error.message}`);
  process.exitCode = 1;
}

export { appliedNames, assertPrefix, validateManifest };
