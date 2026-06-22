// v1.1 / PSG-38 — Template field-mapping + smart column auto-resolution.

import { fieldsFor } from "./fields";
import type { FieldMapping, ImportKind, RawTable } from "./types";

type FieldDefT = ReturnType<typeof fieldsFor>[number];

/**
 * Split a header into lowercase word tokens, breaking on camelCase, ALLCAPS
 * runs, and separators (space / underscore / dash / dot / slash). This lets us
 * match aliases against *whole words* of compound headers — e.g. CCC ONE's
 * `OwnerStateProvince` -> ["owner","state","province"] and `RONumber` ->
 * ["ro","number"] — instead of doing raw substring containment, which used to
 * mis-map `CustomerProgramID` to State (via "cu·st·omer") and `OwnerOtherPhone`
 * to RO number (via "own·ero·therPhone"). (PSG-51 real-export hardening.)
 */
function tokenize(header: string): string[] {
  return header
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-./\\]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Lowercased match candidates for a field: its key, label, and aliases. */
function fieldCandidates(field: FieldDefT): string[] {
  return [field.key.replace(/_/g, " "), field.label.toLowerCase(), ...field.aliases]
    .map((c) => c.toLowerCase().trim())
    .filter(Boolean);
}

/**
 * Confidence score that `header` is the source column for `field`. Higher is a
 * tighter match. The tiers, in order:
 *   100  whole header equals a candidate (raw or token-joined) — e.g. an exact
 *        canonical name like `OwnerStateProvince` == alias "ownerstateprovince"
 *    90  multi-word candidate is a contiguous substring of the header
 *    85  every word of a multi-word candidate appears as a header token
 *    80  single-word candidate equals one of the header tokens (whole-word)
 *    45  long (>=4 char) candidate is a prefix of / prefixed by a header token
 *    25  long (>=5 char) candidate is a raw substring (last-resort fuzzy)
 * Short aliases ("ro", "st", "tl") therefore only ever match a *whole word*,
 * never an accidental substring inside a longer header.
 */
function scoreField(field: FieldDefT, rawHeader: string): number {
  const norm = rawHeader.toLowerCase().trim();
  const tokens = tokenize(rawHeader);
  const joined = tokens.join(" ");
  let best = 0;
  for (const cand of fieldCandidates(field)) {
    if (norm === cand || joined === cand) return 100;
    const words = cand.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      if (joined.includes(cand) || norm.includes(cand)) best = Math.max(best, 90);
      else if (words.every((w) => tokens.includes(w))) best = Math.max(best, 85);
    } else {
      if (tokens.includes(cand)) best = Math.max(best, 80);
      // Only the safe direction: a header token that *extends* the alias
      // ("addresses" ⊃ "address"). The reverse (alias extends token) wrongly
      // let "totaled" grab a "Total" amount column, so it is excluded.
      else if (cand.length >= 4 && tokens.some((t) => t.length > cand.length && t.startsWith(cand)))
        best = Math.max(best, 45);
      else if (cand.length >= 5 && norm.includes(cand)) best = Math.max(best, 25);
    }
  }
  return best;
}

/**
 * Suggest a field_mapping from a file's headers using each field's aliases
 * ("smart resolution"). Every (field, header) pair is scored and assigned
 * globally best-first, so the strongest match wins regardless of column order
 * and each header/field is used at most once. Ties break toward earlier fields
 * and then more specific (fewer-token) headers. Returns canonical-key ->
 * source-header for every field we could confidently resolve.
 */
export function suggestMapping(kind: ImportKind, headers: string[]): FieldMapping {
  const fields = fieldsFor(kind);
  const pairs: Array<{ field: string; header: string; score: number; order: number; spec: number }> =
    [];
  fields.forEach((field, order) => {
    for (const header of headers) {
      const score = scoreField(field, header);
      if (score > 0)
        pairs.push({ field: field.key, header, score, order, spec: tokenize(header).length });
    }
  });

  // Best score first; then earlier field; then tighter (fewer-token) header.
  pairs.sort((a, b) => b.score - a.score || a.order - b.order || a.spec - b.spec);

  const mapping: FieldMapping = {};
  const usedFields = new Set<string>();
  const usedHeaders = new Set<string>();
  for (const p of pairs) {
    if (usedFields.has(p.field) || usedHeaders.has(p.header)) continue;
    mapping[p.field] = p.header;
    usedFields.add(p.field);
    usedHeaders.add(p.header);
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
