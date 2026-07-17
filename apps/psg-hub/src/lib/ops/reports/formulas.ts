import type { ReportColumn, ReportRow } from "./types";

export type FormulaStatus = "live" | "deferred";
export type FormulaOutputType = ReportColumn["type"];

export type FormulaTolerance = {
  type: FormulaOutputType;
  tolerance: number;
  display: string;
};

export type ReportFormulaMapping = {
  reportSlug: string;
  fieldKey: string;
  fieldLabel: string;
  status: FormulaStatus;
  outputType: FormulaOutputType;
  sourceFields: string[];
  formula: string;
  tolerance: FormulaTolerance;
  reason?: string;
  estimateLabelRequired?: boolean;
};

export const FORMULA_TOLERANCES = {
  count: { type: "number", tolerance: 0, display: "exact whole count" },
  money: { type: "currency", tolerance: 0.01, display: "within one cent" },
  percent: { type: "percent", tolerance: 0.01, display: "within 0.01 percentage point" },
  score: { type: "number", tolerance: 0.1, display: "within 0.1 score point" },
  date: { type: "date", tolerance: 0, display: "same calendar date" },
  text: { type: "string", tolerance: 0, display: "exact text label" },
} as const satisfies Record<string, FormulaTolerance>;

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function recomputePercent(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return roundPercent((numerator / denominator) * 100);
}

export function recomputeAverage(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  precision: "currency" | "percent" = "currency",
): number | null {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  const raw = numerator / denominator;
  return precision === "currency" ? roundCurrency(raw) : roundPercent(raw);
}

const money = FORMULA_TOLERANCES.money;
const count = FORMULA_TOLERANCES.count;
const percent = FORMULA_TOLERANCES.percent;
const score = FORMULA_TOLERANCES.score;
const date = FORMULA_TOLERANCES.date;
const text = FORMULA_TOLERANCES.text;

const live = (
  reportSlug: string,
  fieldKey: string,
  fieldLabel: string,
  outputType: FormulaOutputType,
  sourceFields: string[],
  formula: string,
  tolerance: FormulaTolerance,
): ReportFormulaMapping => ({
  reportSlug,
  fieldKey,
  fieldLabel,
  status: "live",
  outputType,
  sourceFields,
  formula,
  tolerance,
});

const deferred = (
  reportSlug: string,
  fieldKey: string,
  fieldLabel: string,
  outputType: FormulaOutputType,
  sourceFields: string[],
  reason: string,
  tolerance: FormulaTolerance,
  estimateLabelRequired = false,
): ReportFormulaMapping => ({
  reportSlug,
  fieldKey,
  fieldLabel,
  status: "deferred",
  outputType,
  sourceFields,
  formula: "Deferred until a truthful source field exists.",
  reason,
  tolerance,
  estimateLabelRequired,
});

export const REPORT_FORMULA_MAPPINGS: ReportFormulaMapping[] = [
  live("processing-recap", "opened", "ROs Opened", "number", ["repair_orders.created_at"], "count repair_orders created inside the selected date range", count),
  live("processing-recap", "closed", "ROs Closed", "number", ["repair_orders.status"], "count selected repair_orders whose status is closed", count),
  live("processing-recap", "processed", "Processed", "currency", ["repair_orders.repair_amount_cents"], "sum known repair_amount_cents / 100; null when no amount is recorded", money),
  live("invoicing-recap", "amount", "Invoiced", "currency", ["repair_orders.repair_amount_cents", "repair_orders.pay_type"], "sum known repair_amount_cents / 100 by shop and pay type", money),
  live("invoicing-recap", "avgTicket", "Avg Ticket", "currency", ["repair_orders.repair_amount_cents"], "sum known repair dollars divided by count of amount-bearing repair orders", money),
  live("reprint-recap", "count", "Reprints", "number", ["production_reprint_log.reprinted_at"], "count reprint log rows by shop, batch, and reason", count),
  live("recap-trailing", "trend", "MoM %", "percent", ["repair_orders.repair_amount_cents", "repair_orders.created_at"], "(current-month dollars - prior-month dollars) / prior-month dollars * 100", percent),
  live("audit", "amount", "Amount", "currency", ["repair_orders.repair_amount_cents"], "repair_amount_cents / 100 for each repair order; null when missing", money),
  live("performance-dashboard", "responseRate", "Response Rate", "percent", ["survey_responses", "survey_dispatches"], "returned survey count divided by sent survey count, recomputed from raw counts", percent),
  live("performance-dashboard", "recommend", "Would Recommend", "percent", ["survey_responses.would_recommend"], "recommended survey count divided by answered recommendation count, recomputed from raw counts", percent),
  live("market-dashboard", "delta", "Delta", "number", ["survey_responses.scale_emi_pct", "survey_responses.q05_*"], "selected-shop metric average minus network metric average over the same raw rows", score),
  live("monthly-csi-display", "csi", "CSI", "number", ["survey_responses.scale_emi_pct"], "average EMI fraction * 100 by shop and month", score),
  live("estimator-csi", "recommend", "Would Recommend", "percent", ["survey_responses.would_recommend", "repair_order_employees"], "recommended attributed surveys divided by answered attributed surveys", percent),
  live("body-tech-performance", "comebackRate", "Comeback Rate", "percent", ["repair_order_employees.rework"], "rework job count divided by raw attributed job count", percent),
  live("painter-performance", "redoRate", "Redo Rate", "percent", ["repair_order_employees.rework"], "redo job count divided by raw attributed job count", percent),
  live("survey-alert-recap", "score", "Score", "number", ["survey_responses.scale_emi_pct"], "EMI fraction * 100 for each below-threshold survey", score),
  live("rental-car-analysis", "cycleTime", "Cycle Time (days)", "number", ["repair_orders.dates_json.date_in", "repair_orders.dates_json.date_out"], "average valid date_out - date_in days by shop and insurer", score),
  live("pay-type-analysis", "share", "Share", "percent", ["repair_orders.payload_jsonb", "repair_orders.insurance_company_id"], "pay-type dollars divided by total known dollars, recomputed from raw dollar sums", percent),
  live("vehicle-analysis-make", "avgSeverity", "Avg Severity", "currency", ["repair_orders.payload_jsonb['bms.totals.grandTotal']"], "sum known repair dollars divided by count of amount-bearing repair orders by make", money),
  live("vehicle-analysis-model", "avgSeverity", "Avg Severity", "currency", ["repair_orders.payload_jsonb['bms.totals.grandTotal']"], "sum known repair dollars divided by count of amount-bearing repair orders by make and model", money),
  live("referral-directory", "amount", "Captured", "currency", ["repair_orders.payload_jsonb['bms.totals.grandTotal']", "insurance_agents", "insurance_companies"], "sum known repair dollars by derived referral category and source", money),
  live("agent-capture", "firstSeen", "First Seen", "date", ["repair_orders.created_at", "insurance_agents"], "earliest repair-order created date for each insurance agent", date),
  live("agent-sales", "sales", "Sales", "currency", ["repair_orders.payload_jsonb['bms.totals.grandTotal']", "insurance_agents"], "sum known repair dollars for each insurance agent", money),
  live("claims-review", "amount", "Claim $", "currency", ["repair_orders.payload_jsonb['bms.totals.grandTotal']", "insurance_companies"], "sum known repair dollars for repair orders with an insurer", money),
  live("name-recap-by-shop", "amount", "Amount", "currency", ["repair_orders.payload_jsonb['bms.totals.grandTotal']", "repair_customers"], "sum known repair dollars by shop and customer name", money),
  live("perfect-score", "date", "Received", "date", ["survey_responses.survey_date", "survey_responses.scale_emi_pct"], "survey received date for surveys whose scored fields meet the perfect-score rule", date),
  live("mis-fire", "subScore", "Sub Value", "number", ["survey_responses.scale_emi_pct", "survey_responses.q05_*"], "lowest sub-score when a strong overall score masks a weak sub-score", score),
  live("hot-spot", "avgScore", "Avg Score", "number", ["survey_responses.q05_*"], "average raw survey score for the repeated issue theme", score),
  deferred(
    "unresolved-issue",
    "daysOpen",
    "Days Open",
    "number",
    ["service recovery resolution state"],
    "The current survey and repair-order spine has no resolution timestamp or typed issue state. Showing days open would be an estimate, so the report remains sample-only until that source lands.",
    count,
    true,
  ),
  live("referral-noted", "source", "Source Named", "string", ["repair_orders.insurance_agent_id", "repair_orders.insurance_company_id"], "derived referral source name from agent, insurer, or direct edge", text),
  live("referral-comparison", "delta", "Change", "percent", ["repair_orders referral categories across current and prior periods"], "(current raw referral count - prior raw referral count) / prior raw referral count * 100", percent),
];

export const REPORT_FORMULAS_BY_SLUG = REPORT_FORMULA_MAPPINGS.reduce(
  (acc, formula) => {
    const list = acc.get(formula.reportSlug) ?? [];
    list.push(formula);
    acc.set(formula.reportSlug, list);
    return acc;
  },
  new Map<string, ReportFormulaMapping[]>(),
);

export function formulasForReport(reportSlug: string): ReportFormulaMapping[] {
  return REPORT_FORMULAS_BY_SLUG.get(reportSlug) ?? [];
}

export type ParityFixture = {
  name: string;
  reportSlug: string;
  expected: ReportRow[];
  run: () => ReportRow[];
};

export const REPORT_PARITY_FIXTURES: ParityFixture[] = [
  {
    name: "Monthly Processing Invoicing Recap recomputes average ticket from amount-bearing invoices",
    reportSlug: "invoicing-recap",
    expected: [{ shop: "Fixture Shop", payType: "insurance", invoices: 3, amount: 3000, avgTicket: 1500 }],
    run: () => {
      const knownAmounts = [1000, 2000];
      const amount = knownAmounts.reduce((sum, value) => sum + value, 0);
      return [{
        shop: "Fixture Shop",
        payType: "insurance",
        invoices: 3,
        amount,
        avgTicket: recomputeAverage(amount, knownAmounts.length),
      }];
    },
  },
  {
    name: "Performance Dashboard recomputes response rate from raw returned and sent counts",
    reportSlug: "performance-dashboard",
    expected: [{ shop: "Fixture Shop", returned: 17, sent: 40, responseRate: 42.5 }],
    run: () => [{
      shop: "Fixture Shop",
      returned: 17,
      sent: 40,
      responseRate: recomputePercent(17, 40),
    }],
  },
  {
    name: "Pay Type Analysis recomputes share from raw dollar totals",
    reportSlug: "pay-type-analysis",
    expected: [
      { payType: "Customer Pay", amount: 1200, share: 30 },
      { payType: "Insurance", amount: 2800, share: 70 },
    ],
    run: () => {
      const customer = 1200;
      const insurance = 2800;
      const total = customer + insurance;
      return [
        { payType: "Customer Pay", amount: customer, share: recomputePercent(customer, total) },
        { payType: "Insurance", amount: insurance, share: recomputePercent(insurance, total) },
      ];
    },
  },
  {
    name: "Recap trailing recomputes month-over-month percent from month dollar sums",
    reportSlug: "recap-trailing",
    expected: [{ shop: "Fixture Shop", m1: 12500, current: 15000, trend: 20 }],
    run: () => [{
      shop: "Fixture Shop",
      m1: 12500,
      current: 15000,
      trend: recomputePercent(15000 - 12500, 12500),
    }],
  },
];
