// v1.1 / PSG-38 — Validate + normalize mapped rows against the field catalog.

import { fieldsFor } from "./fields";
import { normalizePhone, resolveAddress } from "./address";
import { missingRequiredMappings } from "./template";
import type {
  FieldMapping,
  ImportKind,
  ValidatedRow,
  ValidationSummary,
} from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

function coerceNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function coerceBoolean(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (["y", "yes", "true", "1", "t", "x"].includes(v)) return true;
  if (["n", "no", "false", "0", "f", ""].includes(v)) return false;
  return null;
}

function coerceDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Validate one mapped record. Address parts (line1/2/city/state/zip) are pulled
 * together through resolveAddress so smart-resolution warnings/errors surface
 * once per row rather than per field.
 */
function validateRow(
  kind: ImportKind,
  index: number,
  mapped: Record<string, string>,
): ValidatedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const values: ValidatedRow["values"] = {};
  const fields = fieldsFor(kind);
  const addressKeys = new Set([
    "address_line1",
    "address_line2",
    "address_city",
    "address_state",
    "address_zip",
  ]);

  for (const field of fields) {
    if (addressKeys.has(field.key)) continue; // handled below
    const raw = (mapped[field.key] ?? "").trim();

    if (!raw) {
      if (field.required) errors.push(`${field.label} is required`);
      values[field.key] = null;
      continue;
    }

    switch (field.type) {
      case "number": {
        const n = coerceNumber(raw);
        if (n === null) errors.push(`${field.label} is not a number: "${raw}"`);
        values[field.key] = n;
        break;
      }
      case "boolean": {
        const b = coerceBoolean(raw);
        if (b === null) errors.push(`${field.label} is not yes/no: "${raw}"`);
        values[field.key] = b;
        break;
      }
      case "date": {
        const d = coerceDate(raw);
        if (d === null) errors.push(`${field.label} is not a valid date: "${raw}"`);
        values[field.key] = d;
        break;
      }
      case "email": {
        if (!EMAIL_RE.test(raw)) warnings.push(`${field.label} looks invalid: "${raw}"`);
        values[field.key] = raw.toLowerCase();
        break;
      }
      case "phone": {
        const p = normalizePhone(raw);
        if (p === null) warnings.push(`${field.label} could not be normalized: "${raw}"`);
        values[field.key] = p ?? raw;
        break;
      }
      default:
        values[field.key] = raw;
    }
  }

  // Address block — only when at least one address part is present.
  const hasAddress = [...addressKeys].some((k) => (mapped[k] ?? "").trim());
  if (hasAddress) {
    const resolved = resolveAddress({
      line1: mapped.address_line1,
      line2: mapped.address_line2,
      city: mapped.address_city,
      state: mapped.address_state,
      zip: mapped.address_zip,
    });
    values.address_line1 = resolved.address.line1;
    values.address_line2 = resolved.address.line2;
    values.address_city = resolved.address.city;
    values.address_state = resolved.address.state;
    values.address_zip = resolved.address.zip;
    warnings.push(...resolved.warnings);
    errors.push(...resolved.errors);
  } else {
    values.address_line1 = null;
    values.address_line2 = null;
    values.address_city = null;
    values.address_state = null;
    values.address_zip = null;
  }

  // Defensive: a directly-mapped zip that bypassed the address block.
  const zipVal = values.address_zip;
  if (typeof zipVal === "string" && zipVal && !ZIP_RE.test(zipVal)) {
    errors.push(`ZIP is malformed: "${zipVal}"`);
  }

  return { index, values, errors, warnings };
}

export function validateRecords(
  kind: ImportKind,
  mapping: FieldMapping,
  records: Array<Record<string, string>>,
): ValidationSummary {
  const unmappedRequired = missingRequiredMappings(kind, mapping);
  const rows = records.map((r, i) => validateRow(kind, i + 1, r));
  const valid = rows.filter((r) => r.errors.length === 0).length;
  return {
    kind,
    total: rows.length,
    valid,
    invalid: rows.length - valid,
    rows,
    unmappedRequired,
  };
}
