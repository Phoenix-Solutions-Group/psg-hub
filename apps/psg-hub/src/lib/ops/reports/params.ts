// v1.4 / PSG-28 — Operational Reports: parameter parsing + validation.
// Pure: no clock read, no IO. Defaults (e.g. "last full month") are the page's
// job — this layer validates whatever it is given and reports precise errors.

import { z } from "zod";
import type { ReportDefinition, ReportParams } from "./types";

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export type ParseOk = { ok: true; params: ReportParams };
export type ParseErr = { ok: false; errors: string[] };
export type ParseResult = ParseOk | ParseErr;

/**
 * Validate query params for a report definition.
 *
 * - When `params.dateRange` is set, `start`/`end` are accepted (each optional;
 *   the caller decides defaults) but if BOTH are present, start must be <= end.
 * - Declared filters are pulled by key. Required filters must be present and,
 *   for enum filters, the value must be one of the declared options.
 * - Unknown query keys are ignored (forward-compatible export/format flags).
 */
export function parseReportParams(
  def: ReportDefinition,
  search: URLSearchParams,
): ParseResult {
  const errors: string[] = [];

  let start: string | null = null;
  let end: string | null = null;

  if (def.params.dateRange) {
    const rawStart = search.get("start");
    const rawEnd = search.get("end");
    if (rawStart) {
      const r = ymd.safeParse(rawStart);
      if (r.success) start = rawStart;
      else errors.push(`start: ${r.error.issues[0]?.message ?? "invalid"}`);
    }
    if (rawEnd) {
      const r = ymd.safeParse(rawEnd);
      if (r.success) end = rawEnd;
      else errors.push(`end: ${r.error.issues[0]?.message ?? "invalid"}`);
    }
    if (start && end && start > end) {
      errors.push("start must be on or before end");
    }
  }

  const filters: Record<string, string> = {};
  for (const spec of def.params.filters) {
    const v = search.get(spec.key);
    if (v === null || v === "") {
      if (spec.required) errors.push(`${spec.label} is required`);
      continue;
    }
    if (spec.type === "enum" && spec.options) {
      const allowed = spec.options.some((o) => o.value === v);
      if (!allowed) {
        errors.push(`${spec.label}: "${v}" is not a valid option`);
        continue;
      }
    }
    if (spec.type === "number" && Number.isNaN(Number(v))) {
      errors.push(`${spec.label} must be a number`);
      continue;
    }
    filters[spec.key] = v;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, params: { start, end, filters } };
}
