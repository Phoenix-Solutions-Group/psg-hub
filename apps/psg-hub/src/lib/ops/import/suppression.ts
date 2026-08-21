// PSG-2026 — FileMaker-parity import suppression rules.
//
// The importer should reject non-actionable rows before they affect reports or
// mailings, but the shop-specific pieces must remain configurable. This module
// keeps the evaluator pure; routes load persisted rules and tests use fixtures.

import type {
  ImportKind,
  ImportSuppressionConfig,
  ImportSuppressionHit,
  ImportSuppressionReason,
  ImportSuppressionRule,
  ValidatedRow,
} from "./types";

const DEFAULT_NON_ACTIONABLE_PAY_TYPES = ["warranty", "internal"];
const DEFAULT_JOB_CLASSIFICATIONS = [
  "no warranty",
  "no-warranty",
  "due bill",
  "due-bill",
  "do not mail",
  "do-not-mail",
];

const clean = (value: unknown): string => String(value ?? "").trim();
const norm = (value: unknown): string => clean(value).toLowerCase();

function list(values: string[] | undefined): string[] {
  return (values ?? []).map(norm).filter(Boolean);
}

function hit(
  reason: ImportSuppressionReason,
  message: string,
  field?: string,
  value?: string | number | boolean | null,
  ruleId?: string,
): ImportSuppressionHit {
  return { reason, message, field, value, ruleId };
}

function matchesAny(raw: unknown, candidates: string[] | undefined): boolean {
  const value = norm(raw);
  return value !== "" && list(candidates).includes(value);
}

function matchesRule(value: unknown, rule: ImportSuppressionRule): boolean {
  const raw = clean(value);
  const normalized = raw.toLowerCase();
  const values = list(rule.values);
  if (!raw || values.length === 0) return false;

  switch (rule.operator ?? "equals") {
    case "contains":
      return values.some((v) => normalized.includes(v));
    case "starts_with":
      return values.some((v) => normalized.startsWith(v));
    case "ends_with":
      return values.some((v) => normalized.endsWith(v));
    case "regex":
      return values.some((v) => {
        try {
          return new RegExp(v, "i").test(raw);
        } catch {
          return false;
        }
      });
    case "equals":
    default:
      return values.includes(normalized);
  }
}

function fieldValue(row: ValidatedRow, field: string): string | number | boolean | null {
  return row.values[field] ?? null;
}

function malformedRoNumber(value: unknown): boolean {
  const ro = clean(value);
  if (!ro) return false;
  if (ro.length > 40) return true;
  if (!/[0-9]/.test(ro)) return true;
  return !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ro);
}

export function evaluateImportSuppression(
  kind: ImportKind,
  row: ValidatedRow,
  config: ImportSuppressionConfig = {},
): ImportSuppressionHit[] {
  if (config.enabled === false) return [];

  const reasons: ImportSuppressionHit[] = [];
  if (row.errors.length > 0) {
    reasons.push(
      hit(
        "missing_required_value",
        row.errors[0] ?? "Import row is missing or has an invalid required value",
      ),
    );
  }

  if (kind === "ro" && config.suppressMalformedRoNumber !== false) {
    const roNumber = fieldValue(row, "ro_number");
    if (malformedRoNumber(roNumber)) {
      reasons.push(hit("malformed_ro_number", "Repair order number is malformed", "ro_number", roNumber));
    }
  }

  if (config.suppressTotalLoss !== false && fieldValue(row, "total_loss_flag") === true) {
    reasons.push(hit("total_loss", "Total-loss repair orders are not actionable", "total_loss_flag", true));
  }

  if (config.suppressZeroOrNegativeRepairAmount !== false) {
    const amount = fieldValue(row, "repair_amount");
    if (typeof amount === "number" && amount <= 0) {
      reasons.push(hit("zero_or_negative_repair_total", "Repair total is zero or negative", "repair_amount", amount));
    }
  }

  const payType = fieldValue(row, "pay_type");
  if (matchesAny(payType, config.nonActionablePayTypes ?? DEFAULT_NON_ACTIONABLE_PAY_TYPES)) {
    reasons.push(hit("non_actionable_pay_type", "Pay type is not actionable for customer mailings or reports", "pay_type", payType));
  }

  const insurer = fieldValue(row, "insurance_company");
  if (matchesAny(insurer, config.excludedInsurers)) {
    reasons.push(hit("insurer_exclusion", "Insurer is excluded for this shop", "insurance_company", insurer));
  }

  if (matchesAny(fieldValue(row, "vehicle_make"), config.excludedVehicleMakes)) {
    reasons.push(hit("vehicle_make_exclusion", "Vehicle make is excluded for this shop", "vehicle_make", fieldValue(row, "vehicle_make")));
  }

  if (matchesAny(fieldValue(row, "vehicle_model"), config.excludedVehicleModels)) {
    reasons.push(hit("vehicle_model_exclusion", "Vehicle model is excluded for this shop", "vehicle_model", fieldValue(row, "vehicle_model")));
  }

  const jobClassification = fieldValue(row, "job_classification");
  if (matchesAny(jobClassification, config.excludedJobClassifications ?? DEFAULT_JOB_CLASSIFICATIONS)) {
    const isDoNotMail = ["do not mail", "do-not-mail"].includes(norm(jobClassification));
    reasons.push(
      hit(
        "job_classification",
        isDoNotMail ? "Do-not-mail preference suppresses this row" : "Job classification is excluded",
        "job_classification",
        jobClassification,
      ),
    );
  }

  const normalizedPayType = norm(payType);
  if (insurer && ["customer", "internal", "warranty"].includes(normalizedPayType)) {
    reasons.push(hit("insurance_pay_type_conflict", "Insurance carrier is present but pay type is not insurance", "pay_type", payType));
  }

  for (const rule of config.fieldRules ?? []) {
    const value = fieldValue(row, rule.field);
    if (!matchesRule(value, rule)) continue;
    reasons.push(
      hit(
        rule.reason ?? "shop_field_exclusion",
        rule.message ?? `Shop-specific exclusion matched ${rule.field}`,
        rule.field,
        value,
        rule.id,
      ),
    );
  }

  return reasons;
}
