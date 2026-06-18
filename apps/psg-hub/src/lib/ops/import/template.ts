// v1.1 / PSG-38 — Template field-mapping + smart column auto-resolution.

import { fieldsFor } from "./fields";
import type { FieldMapping, ImportKind, RawTable } from "./types";

/**
 * Suggest a field_mapping from a file's headers using each field's aliases
 * ("smart resolution"). An exact header match wins over a substring match; a
 * header is only assigned to one canonical field. Returns canonical-key ->
 * source-header for every field we could confidently resolve.
 */
export function suggestMapping(kind: ImportKind, headers: string[]): FieldMapping {
  const fields = fieldsFor(kind);
  const normHeaders = headers.map((h) => ({ raw: h, norm: h.toLowerCase().trim() }));
  const used = new Set<string>();
  const mapping: FieldMapping = {};

  // Pass 1: exact alias / key equality.
  for (const field of fields) {
    const targets = [field.key.replace(/_/g, " "), field.label.toLowerCase(), ...field.aliases];
    const hit = normHeaders.find(
      (h) => !used.has(h.raw) && targets.some((t) => h.norm === t),
    );
    if (hit) {
      mapping[field.key] = hit.raw;
      used.add(hit.raw);
    }
  }

  // Pass 2: substring containment for anything still unmapped.
  for (const field of fields) {
    if (mapping[field.key]) continue;
    const hit = normHeaders.find(
      (h) => !used.has(h.raw) && field.aliases.some((a) => h.norm.includes(a)),
    );
    if (hit) {
      mapping[field.key] = hit.raw;
      used.add(hit.raw);
    }
  }

  return mapping;
}

/**
 * Apply a mapping to a RawTable, producing rows keyed by canonical field key
 * (raw string values). Unmapped fields are simply absent. Validation/coercion
 * happens downstream in validate.ts.
 */
export function applyMapping(
  table: RawTable,
  mapping: FieldMapping,
): Array<Record<string, string>> {
  return table.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [fieldKey, sourceHeader] of Object.entries(mapping)) {
      if (!sourceHeader) continue;
      out[fieldKey] = row[sourceHeader] ?? "";
    }
    return out;
  });
}

/** Canonical field keys that a mapping must cover for the given kind. */
export function missingRequiredMappings(kind: ImportKind, mapping: FieldMapping): string[] {
  return fieldsFor(kind)
    .filter((f) => f.required && !mapping[f.key])
    .map((f) => f.key);
}
