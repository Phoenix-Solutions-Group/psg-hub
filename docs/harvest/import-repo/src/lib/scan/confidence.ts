import type { ConfidenceTier } from "./types";
import type { FormFieldSpec, FormFieldType } from "./schema";

export const CONFIDENCE_FLOOR = 0.75;

export const REGEX: Record<FormFieldType, RegExp | null> = {
  string: null,
  number: /^-?\d+(\.\d+)?$/,
  phone: /^\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}$/,
  zip: /^\d{5}(-\d{4})?$/,
  vin: /^[A-HJ-NPR-Z0-9]{17}$/,
  date: /^(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{2}|\d{4})$/,
  state: /^[A-Z]{2}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
};

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export function validateField(spec: FormFieldSpec, value: unknown): ValidationResult {
  if (value == null || value === "") {
    return spec.required
      ? { ok: false, error: "Required" }
      : { ok: true };
  }
  const str = String(value).trim();
  if (str === "") {
    return spec.required
      ? { ok: false, error: "Required" }
      : { ok: true };
  }
  const regex = REGEX[spec.type];
  if (!regex) return { ok: true };
  return regex.test(str) ? { ok: true } : { ok: false, error: `Invalid ${spec.type}` };
}

export function classifyConfidence(
  raw: number,
  valid: boolean,
  floor: number = CONFIDENCE_FLOOR
): ConfidenceTier {
  if (!valid) return "invalid";
  if (raw >= 0.9) return "high";
  if (raw >= floor) return "medium";
  return "low";
}
