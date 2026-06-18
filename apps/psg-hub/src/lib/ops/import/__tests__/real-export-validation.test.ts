// PSG-51 — Real pilot-export validation harness.
//
// The synthetic-fixture suite (import.test.ts) proves the pipeline is correct.
// This harness closes PSG-51's remaining gap: it runs the SAME parse -> suggest
// mapping -> validate -> commit-shape pipeline against REAL RO/Estimate exports
// from the pilot shop's estimating system (CCC ONE / Mitchell / Audatex).
//
// Drop real exports into (both are .gitignore'd — they contain customer PII and
// MUST NOT be committed):
//
//   src/lib/ops/import/__tests__/real-exports/ro/*.csv|.txt|.tsv|.xlsx|.xlsb
//   src/lib/ops/import/__tests__/real-exports/estimate/*.csv|.txt|.tsv|.xlsx|.xlsb
//
// For every file present, the harness asserts: it parses, every REQUIRED field
// auto-resolves from the headers, and zero rows have hard validation errors —
// and prints a per-file readiness report (rows, mapped fields, warnings). When
// no real exports are present it self-skips with a clear note, so CI stays green
// until the pilot delivers files. See real-exports/README.md.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { previewImport, requiredFields, type ImportKind } from "@/lib/ops/import";

const REAL_DIR = path.resolve(__dirname, "real-exports");
const PARSEABLE = new Set([".csv", ".txt", ".tsv", ".xlsx", ".xlsm", ".xlsb"]);

function discover(kind: ImportKind): string[] {
  const dir = path.join(REAL_DIR, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => PARSEABLE.has(path.extname(f).toLowerCase()))
    .filter((f) => !f.startsWith(".") && f.toLowerCase() !== "readme.md")
    .map((f) => path.join(dir, f));
}

const KINDS: ImportKind[] = ["ro", "estimate"];
const found = KINDS.flatMap((kind) => discover(kind).map((file) => ({ kind, file })));

describe("real pilot-export validation (PSG-51)", () => {
  if (found.length === 0) {
    it.skip("no real exports present — drop files in __tests__/real-exports/{ro,estimate}/ to validate", () => {
      /* intentionally skipped until the pilot delivers real export files */
    });
    return;
  }

  for (const { kind, file } of found) {
    const name = path.basename(file);
    it(`imports ${kind} export cleanly end-to-end: ${name}`, async () => {
      const buffer = readFileSync(file);
      const res = await previewImport({ kind, filename: name, buffer });

      const mappedKeys = Object.keys(res.mapping);
      const required = requiredFields(kind).map((f) => f.key);
      const warned = res.validation.rows.filter((r) => r.warnings.length > 0).length;
      const firstErrors = res.validation.rows
        .filter((r) => r.errors.length > 0)
        .slice(0, 5)
        .map((r) => `  row ${r.index}: ${r.errors.join("; ")}`);

      // eslint-disable-next-line no-console
      console.log(
        [
          `\n── ${kind.toUpperCase()} ${name} (${res.table.format}) ──`,
          `rows:            ${res.table.rowCount}`,
          `headers:         ${res.table.headers.length} (${res.table.headers.join(", ")})`,
          `mapped fields:   ${mappedKeys.length} (${mappedKeys.join(", ")})`,
          `required mapped: ${required.every((k) => mappedKeys.includes(k)) ? "yes" : "NO"}`,
          `valid / invalid: ${res.validation.valid} / ${res.validation.invalid}`,
          `rows w/ warning: ${warned}`,
          ...(firstErrors.length ? ["first errors:", ...firstErrors] : []),
        ].join("\n"),
      );

      expect(res.table.rowCount, "export should contain at least one data row").toBeGreaterThan(0);
      expect(res.validation.unmappedRequired, "all required fields must auto-map").toEqual([]);
      expect(res.validation.invalid, "no row should have hard validation errors").toBe(0);
    });
  }
});
