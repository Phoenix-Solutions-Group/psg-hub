import type { MailProduct } from "@/lib/production/templates";
import type { StoredAddressInput } from "@/lib/ops/production";

export const LETTER_KINDS = [
  "three_month",
  "six_month",
  "one_year",
  "eighteen_month",
  "two_year",
  "birthday",
  "drivers_license",
  "thank_you",
  "referral",
] as const;

export type LetterKind = (typeof LETTER_KINDS)[number];

export type NonPrintableReason =
  | "missing_name"
  | "missing_address_line1"
  | "missing_city"
  | "missing_state"
  | "missing_postal_code";

export type IneligibleReason =
  | NonPrintableReason
  | "missing_completed_repair_date"
  | "outside_date_window"
  | "suppressed_by_open_survey_alert"
  | "already_printed";

export type SurveyAlert = {
  alertClass: string | null;
  alertPostedAt: string | null;
};

export type EligibilityCustomer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  address?: StoredAddressInput;
  roCompletedAt?: string | null;
  printedAt?: string | null;
  surveyAlerts?: readonly SurveyAlert[];
};

export type EligibilityOptions = {
  letterKind: LetterKind;
  /** ISO date, YYYY-MM-DD. */
  asOf: string;
  /** Open FileMaker survey alerts suppress routine mail for this many days. */
  alertLookbackDays?: number;
};

export type EligibilityDecision = {
  repairCustomerId: string;
  letterKind: LetterKind;
  periodKey: string;
  eligible: boolean;
  printable: boolean;
  suppressedByAlert: boolean;
  reasons: IneligibleReason[];
};

export type EligibilityBatch = {
  decisions: EligibilityDecision[];
  eligibleIds: string[];
  nonPrintable: EligibilityDecision[];
  suppressed: EligibilityDecision[];
  ineligible: EligibilityDecision[];
};

const WINDOW_DAYS: Record<LetterKind, { min: number; max: number } | null> = {
  three_month: { min: 90, max: 120 },
  six_month: { min: 180, max: 210 },
  one_year: { min: 365, max: 395 },
  eighteen_month: { min: 545, max: 575 },
  two_year: { min: 730, max: 760 },
  birthday: null,
  drivers_license: null,
  thank_you: { min: 0, max: 45 },
  referral: null,
};

const PRODUCT_KIND: Record<MailProduct, LetterKind> = {
  thank_you: "thank_you",
  warranty: "one_year",
  envelope: "thank_you",
  service_recovery: "referral",
  self_mailer: "thank_you",
};

export function letterKindForProduct(product: MailProduct): LetterKind {
  return PRODUCT_KIND[product];
}

export function dateOnly(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function diffDays(from: string, to: string): number | null {
  const a = new Date(`${from}T00:00:00.000Z`);
  const b = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function periodKeyFor(letterKind: LetterKind, customer: EligibilityCustomer, asOf: string): string {
  const roDate = customer.roCompletedAt ? dateOnly(customer.roCompletedAt) : "";
  switch (letterKind) {
    case "birthday":
    case "drivers_license":
      return `${letterKind}:${asOf.slice(0, 7)}`;
    case "referral":
      return `referral:${roDate || asOf}`;
    default:
      return `${letterKind}:${roDate ? monthKey(roDate) : "missing-date"}`;
  }
}

export function printableReasons(customer: EligibilityCustomer): NonPrintableReason[] {
  const reasons: NonPrintableReason[] = [];
  const name = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim();
  const address = customer.address;
  if (!name) reasons.push("missing_name");
  if (!address?.line1?.trim()) reasons.push("missing_address_line1");
  if (!address?.city?.trim()) reasons.push("missing_city");
  if (!address?.state?.trim()) reasons.push("missing_state");
  if (!address?.postal_code?.trim()) reasons.push("missing_postal_code");
  return reasons;
}

export function hasOpenSurveyAlert(
  alerts: readonly SurveyAlert[] | undefined,
  asOf: string,
  lookbackDays = 120
): boolean {
  if (!alerts?.length) return false;
  const asOfDate = new Date(`${asOf}T00:00:00.000Z`);
  if (Number.isNaN(asOfDate.getTime())) return false;
  const threshold = dateOnly(addDays(asOfDate, -lookbackDays));
  return alerts.some((alert) => {
    if (!alert.alertPostedAt || !alert.alertClass || alert.alertClass === "none") return false;
    const posted = dateOnly(alert.alertPostedAt);
    return posted !== "" && posted >= threshold && posted <= asOf;
  });
}

export function evaluateDirectMailEligibility(
  customer: EligibilityCustomer,
  options: EligibilityOptions
): EligibilityDecision {
  const reasons: IneligibleReason[] = [...printableReasons(customer)];
  const printable = reasons.length === 0;
  const roDate = customer.roCompletedAt ? dateOnly(customer.roCompletedAt) : "";
  const window = WINDOW_DAYS[options.letterKind];

  if (customer.printedAt) reasons.push("already_printed");

  if (window) {
    if (!roDate) {
      reasons.push("missing_completed_repair_date");
    } else {
      const ageDays = diffDays(roDate, options.asOf);
      if (ageDays === null || ageDays < window.min || ageDays > window.max) {
        reasons.push("outside_date_window");
      }
    }
  }

  const suppressible = options.letterKind !== "referral";
  const suppressedByAlert =
    suppressible &&
    hasOpenSurveyAlert(customer.surveyAlerts, options.asOf, options.alertLookbackDays ?? 120);
  if (suppressedByAlert) reasons.push("suppressed_by_open_survey_alert");

  return {
    repairCustomerId: customer.id,
    letterKind: options.letterKind,
    periodKey: periodKeyFor(options.letterKind, customer, options.asOf),
    eligible: reasons.length === 0,
    printable,
    suppressedByAlert,
    reasons,
  };
}

export function evaluateEligibilityBatch(
  customers: readonly EligibilityCustomer[],
  options: EligibilityOptions
): EligibilityBatch {
  const decisions = customers.map((customer) => evaluateDirectMailEligibility(customer, options));
  return {
    decisions,
    eligibleIds: decisions.filter((d) => d.eligible).map((d) => d.repairCustomerId),
    nonPrintable: decisions.filter((d) => !d.printable),
    suppressed: decisions.filter((d) => d.suppressedByAlert),
    ineligible: decisions.filter((d) => !d.eligible),
  };
}

export function extractRoCompletedAt(datesJson: unknown): string | null {
  if (!datesJson || typeof datesJson !== "object" || Array.isArray(datesJson)) return null;
  const dates = datesJson as Record<string, unknown>;
  for (const key of ["ro_completed_at", "completed_at", "closed_at", "completion_date", "repair_completed_at"]) {
    const value = dates[key];
    if (typeof value === "string" && dateOnly(value)) return dateOnly(value);
  }
  return null;
}
