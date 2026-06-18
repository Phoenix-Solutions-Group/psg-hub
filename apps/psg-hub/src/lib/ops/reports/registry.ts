// v1.4 / PSG-28 — Operational Reports registry.
//
// The 26 named operational reports (+ Referral Comparison) from the Advantage
// Program, in the 5 milestone-v1.4 batches. Each is declared once with its
// metadata, parameter spec, columns and deterministic sample rows.
//
// B1 (PSG-25 v1.1 Ops Foundation) has landed: companies / repair_orders /
// estimates / survey_responses are live. Wiring each report's real data is the
// mechanical fast-follow — flip its `dataStatus` to "available" and add a
// `run()` (see ./live/*); the rest of the framework (params, runner, export,
// routes, UI) is already wired and needs no change. A report stays
// "pending-data" only while a column it needs has no real source yet (e.g.
// invoiced $ line items, estimator/tech attribution, survey response-rate /
// recommend fields) — those land with the invoicing + attribution work. Slugs
// are frozen by PLANNING.md and are the public report ids; do not rename them.

import {
  marketDashboardRun,
  monthlyCsiDisplayRun,
  surveyAlertRecapRun,
} from "./live/survey";
import {
  category,
  customerName,
  estimator,
  insurer,
  make,
  model,
  payType,
  roNumber,
  sampleDate,
  seeded,
  shopName,
  tech,
} from "./sample";
import type {
  ReportBatchId,
  ReportColumn,
  ReportDefinition,
  ReportParams,
  ReportRow,
} from "./types";

const N = 8; // sample rows per report

function build(n: number, fn: (i: number) => ReportRow): ReportRow[] {
  return Array.from({ length: n }, (_, i) => fn(i));
}

// Filters reused across reports.
const PAY_TYPE_FILTER = {
  key: "payType",
  label: "Pay Type",
  type: "enum" as const,
  options: [
    { value: "insurance", label: "Insurance" },
    { value: "customer", label: "Customer Pay" },
    { value: "internal", label: "Internal" },
    { value: "warranty", label: "Warranty" },
  ],
};
const SHOP_FILTER = { key: "shopId", label: "Shop", type: "shop" as const };

const col = (
  key: string,
  label: string,
  type: ReportColumn["type"],
): ReportColumn => ({ key, label, type });

const definitions: ReportDefinition[] = [
  // ───────────────────────── Volume & Invoicing (5) ─────────────────────────
  {
    slug: "processing-recap",
    title: "Processing Recap",
    batch: "volume-invoicing",
    description:
      "RO processing volume by shop over the period: ROs opened, closed, and total processed dollars.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("shop", "Shop", "string"),
      col("opened", "ROs Opened", "number"),
      col("closed", "ROs Closed", "number"),
      col("processed", "Processed", "currency"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(6, (i) => ({
        shop: shopName(i),
        opened: seeded(i + 1, 18, 64),
        closed: seeded(i + 7, 16, 60),
        processed: seeded(i + 3, 42000, 188000),
      })),
  },
  {
    slug: "invoicing-recap",
    title: "Monthly Processing Invoicing Recap",
    batch: "volume-invoicing",
    description:
      "Invoiced totals by shop and pay type for the period, with counts and average ticket.",
    params: { dateRange: true, filters: [SHOP_FILTER, PAY_TYPE_FILTER] },
    columns: [
      col("shop", "Shop", "string"),
      col("payType", "Pay Type", "string"),
      col("invoices", "Invoices", "number"),
      col("amount", "Invoiced", "currency"),
      col("avgTicket", "Avg Ticket", "currency"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(N, (i) => {
        const invoices = seeded(i + 2, 8, 40);
        const amount = seeded(i + 5, 18000, 96000);
        return {
          shop: shopName(i),
          payType: payType(i),
          invoices,
          amount,
          avgTicket: Math.round(amount / invoices),
        };
      }),
  },
  {
    slug: "reprint-recap",
    title: "Re-Print Recap",
    batch: "volume-invoicing",
    description:
      "Production re-prints in the period — original batch, reprint reason, and count.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("shop", "Shop", "string"),
      col("batch", "Original Batch", "string"),
      col("reason", "Reprint Reason", "string"),
      col("count", "Reprints", "number"),
      col("date", "Reprinted", "date"),
    ],
    dataStatus: "pending-data",
    sampleRows: (p) =>
      build(N, (i) => ({
        shop: shopName(i),
        batch: `BATCH-${2200 + i}`,
        reason: pick(["Address change", "Mail returned", "Damaged", "Reissue"], i),
        count: seeded(i + 4, 1, 9),
        date: sampleDate(p.start, i * 2),
      })),
  },
  {
    slug: "recap-trailing",
    title: "Recap (Trailing 2 mo + Current)",
    batch: "volume-invoicing",
    description:
      "Three-month trailing volume/invoicing comparison by shop (prior-2, prior-1, current).",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("shop", "Shop", "string"),
      col("m2", "2 Mo Ago", "currency"),
      col("m1", "Last Mo", "currency"),
      col("current", "Current", "currency"),
      col("trend", "MoM %", "percent"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(6, (i) => {
        const m1 = seeded(i + 6, 40000, 120000);
        const current = seeded(i + 9, 40000, 130000);
        return {
          shop: shopName(i),
          m2: seeded(i + 3, 40000, 110000),
          m1,
          current,
          trend: Math.round(((current - m1) / m1) * 1000) / 10,
        };
      }),
  },
  {
    slug: "audit",
    title: "Audit",
    batch: "volume-invoicing",
    description:
      "Line-level audit of ROs/invoices in the period for reconciliation: RO, shop, pay type, amount, status.",
    params: { dateRange: true, filters: [SHOP_FILTER, PAY_TYPE_FILTER] },
    columns: [
      col("ro", "RO #", "string"),
      col("shop", "Shop", "string"),
      col("payType", "Pay Type", "string"),
      col("amount", "Amount", "currency"),
      col("status", "Status", "string"),
      col("date", "Closed", "date"),
    ],
    dataStatus: "pending-data",
    sampleRows: (p) =>
      build(N, (i) => ({
        ro: roNumber(i),
        shop: shopName(i),
        payType: payType(i),
        amount: seeded(i + 1, 850, 9200),
        status: pick(["Invoiced", "Open", "Adjusted", "Voided"], i),
        date: sampleDate(p.start, i),
      })),
  },

  // ───────────────────────── Survey & CSI (8) ─────────────────────────
  {
    slug: "performance-dashboard",
    title: "Performance Dashboard",
    batch: "survey-csi",
    description:
      "Headline CSI + volume KPIs by shop: surveys returned, CSI score, response rate, recommend rate.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("shop", "Shop", "string"),
      col("returned", "Surveys", "number"),
      col("csi", "CSI", "number"),
      col("responseRate", "Response Rate", "percent"),
      col("recommend", "Would Recommend", "percent"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(6, (i) => ({
        shop: shopName(i),
        returned: seeded(i + 2, 20, 90),
        csi: seeded(i + 5, 88, 99),
        responseRate: seeded(i + 1, 28, 62),
        recommend: seeded(i + 4, 86, 100),
      })),
  },
  {
    slug: "market-dashboard",
    title: "Market Dashboard",
    batch: "survey-csi",
    description:
      "Shop CSI vs. market/region benchmark by metric, with delta to benchmark.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("metric", "Metric", "string"),
      col("shop", "Shop Score", "number"),
      col("market", "Market Avg", "number"),
      col("delta", "Delta", "number"),
    ],
    // B1 landed: per-metric shop avg vs. network ("market") avg over the same
    // range, derived from survey_responses. Overall CSI is EMI×100; the q05
    // sub-scores are native scale (matches public.shop_detail).
    dataStatus: "available",
    run: marketDashboardRun,
    sampleRows: () =>
      ["Overall CSI", "Quality", "Timeliness", "Communication", "Cleanliness"].map(
        (metric, i) => {
          const shop = seeded(i + 3, 88, 99);
          const market = seeded(i + 7, 85, 96);
          return { metric, shop, market, delta: shop - market };
        },
      ),
  },
  {
    slug: "monthly-csi-display",
    title: "Monthly CSI Display",
    batch: "survey-csi",
    description: "Month-by-month CSI trend by shop for the selected range.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("month", "Month", "string"),
      col("shop", "Shop", "string"),
      col("csi", "CSI", "number"),
      col("surveys", "Surveys", "number"),
    ],
    // B1 landed: survey_responses is live. CSI = avg(scale_emi_pct) × 100.
    dataStatus: "available",
    run: monthlyCsiDisplayRun,
    sampleRows: () =>
      build(6, (i) => ({
        month: pick(
          ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
          i,
        ),
        shop: shopName(0),
        csi: seeded(i + 5, 90, 99),
        surveys: seeded(i + 2, 18, 70),
      })),
  },
  {
    slug: "estimator-csi",
    title: "Estimator CSI",
    batch: "survey-csi",
    description:
      "CSI and survey volume attributed to each estimator over the period.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("estimator", "Estimator", "string"),
      col("surveys", "Surveys", "number"),
      col("csi", "CSI", "number"),
      col("recommend", "Would Recommend", "percent"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(5, (i) => ({
        estimator: estimator(i),
        surveys: seeded(i + 3, 10, 48),
        csi: seeded(i + 6, 86, 99),
        recommend: seeded(i + 2, 84, 100),
      })),
  },
  {
    slug: "body-tech-performance",
    title: "Body Tech Performance",
    batch: "survey-csi",
    description:
      "Body technician performance: jobs, comeback rate, and quality CSI sub-score.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("tech", "Body Tech", "string"),
      col("jobs", "Jobs", "number"),
      col("comebackRate", "Comeback Rate", "percent"),
      col("quality", "Quality CSI", "number"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(5, (i) => ({
        tech: tech(i),
        jobs: seeded(i + 4, 12, 56),
        comebackRate: Math.round(seeded(i + 1, 0, 80) / 10) / 10,
        quality: seeded(i + 7, 88, 99),
      })),
  },
  {
    slug: "painter-performance",
    title: "Painter Performance",
    batch: "survey-csi",
    description:
      "Painter performance: jobs, redo rate, and finish-quality CSI sub-score.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("painter", "Painter", "string"),
      col("jobs", "Jobs", "number"),
      col("redoRate", "Redo Rate", "percent"),
      col("finish", "Finish CSI", "number"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(5, (i) => ({
        painter: tech(i + 2),
        jobs: seeded(i + 5, 12, 50),
        redoRate: Math.round(seeded(i + 2, 0, 70) / 10) / 10,
        finish: seeded(i + 8, 87, 99),
      })),
  },
  {
    slug: "survey-alert-recap",
    title: "Survey Alert Recap",
    batch: "survey-csi",
    description:
      "Surveys that tripped an alert threshold in the period (low score / negative flag), pending follow-up.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      // Survey rows are not yet linked to a repair order, so this column shows
      // the survey response_id, not an RO# (see PSG-80). Relabel when the join lands.
      col("ro", "Survey #", "string"),
      col("shop", "Shop", "string"),
      col("score", "Score", "number"),
      col("alert", "Alert", "string"),
      col("date", "Received", "date"),
    ],
    // B1 landed: surveys below the 88% CSI alert threshold, newest first. Score/
    // shop/date/alert derive from live survey_responses; identifier = response_id.
    dataStatus: "available",
    run: surveyAlertRecapRun,
    sampleRows: (p) =>
      build(N, (i) => ({
        ro: roNumber(i + 30),
        shop: shopName(i),
        score: seeded(i + 1, 1, 6),
        alert: pick(
          ["Low overall", "Quality issue", "Delay complaint", "Communication"],
          i,
        ),
        date: sampleDate(p.start, i),
      })),
  },
  {
    slug: "rental-car-analysis",
    title: "Rental Car Analysis",
    batch: "survey-csi",
    description:
      "Rental days and cost by shop/insurer relative to cycle time over the period.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("shop", "Shop", "string"),
      col("insurer", "Insurer", "string"),
      col("rentalDays", "Rental Days", "number"),
      col("cycleTime", "Cycle Time (days)", "number"),
      col("cost", "Rental Cost", "currency"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(N, (i) => {
        const days = seeded(i + 3, 3, 18);
        return {
          shop: shopName(i),
          insurer: insurer(i),
          rentalDays: days,
          cycleTime: seeded(i + 6, 4, 21),
          cost: days * seeded(i + 1, 38, 55),
        };
      }),
  },

  // ───────────────────────── Customer & Insurance (8) ─────────────────────────
  {
    slug: "pay-type-analysis",
    title: "Pay Type Analysis",
    batch: "customer-insurance",
    description:
      "RO count and dollars by pay type for the period, with share of total.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("payType", "Pay Type", "string"),
      col("ros", "ROs", "number"),
      col("amount", "Amount", "currency"),
      col("share", "Share", "percent"),
    ],
    dataStatus: "pending-data",
    sampleRows: () => {
      const base = build(4, (i) => ({
        payType: payType(i),
        ros: seeded(i + 2, 20, 140),
        amount: seeded(i + 5, 60000, 320000),
      }));
      const total = base.reduce((s, r) => s + (r.amount as number), 0);
      return base.map((r) => ({
        ...r,
        share: Math.round(((r.amount as number) / total) * 1000) / 10,
      }));
    },
  },
  {
    slug: "vehicle-analysis-make",
    title: "Vehicle Analysis (Make)",
    batch: "customer-insurance",
    description: "RO volume and average severity grouped by vehicle make.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("make", "Make", "string"),
      col("ros", "ROs", "number"),
      col("avgSeverity", "Avg Severity", "currency"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(6, (i) => ({
        make: make(i),
        ros: seeded(i + 3, 8, 70),
        avgSeverity: seeded(i + 5, 1800, 7200),
      })),
  },
  {
    slug: "vehicle-analysis-model",
    title: "Vehicle Analysis (Model)",
    batch: "customer-insurance",
    description: "RO volume and average severity grouped by make + model.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("make", "Make", "string"),
      col("model", "Model", "string"),
      col("ros", "ROs", "number"),
      col("avgSeverity", "Avg Severity", "currency"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(6, (i) => ({
        make: make(i),
        model: model(i),
        ros: seeded(i + 2, 4, 40),
        avgSeverity: seeded(i + 6, 1600, 6800),
      })),
  },
  {
    slug: "referral-directory",
    title: "Referral Directory by Category",
    batch: "customer-insurance",
    description:
      "Referral sources grouped by category with RO count and captured dollars.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("category", "Category", "string"),
      col("source", "Referral Source", "string"),
      col("ros", "ROs", "number"),
      col("amount", "Captured", "currency"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(N, (i) => ({
        category: category(i),
        source: i % 2 === 0 ? insurer(i) : customerName(i),
        ros: seeded(i + 3, 2, 26),
        amount: seeded(i + 5, 6000, 88000),
      })),
  },
  {
    slug: "agent-capture",
    title: "Agent Capture",
    batch: "customer-insurance",
    description:
      "New/active insurance agents referring work in the period, with RO counts.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("agent", "Agent", "string"),
      col("insurer", "Insurer", "string"),
      col("ros", "ROs Referred", "number"),
      col("firstSeen", "First Seen", "date"),
    ],
    dataStatus: "pending-data",
    sampleRows: (p) =>
      build(N, (i) => ({
        agent: customerName(i + 4),
        insurer: insurer(i),
        ros: seeded(i + 2, 1, 18),
        firstSeen: sampleDate(p.start, i * 3),
      })),
  },
  {
    slug: "agent-sales",
    title: "Agent Sales",
    batch: "customer-insurance",
    description:
      "Captured sales dollars by insurance agent over the period, ranked.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("agent", "Agent", "string"),
      col("insurer", "Insurer", "string"),
      col("ros", "ROs", "number"),
      col("sales", "Sales", "currency"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(N, (i) => ({
        agent: customerName(i + 4),
        insurer: insurer(i),
        ros: seeded(i + 3, 2, 24),
        sales: seeded(i + 6, 12000, 160000),
      })),
  },
  {
    slug: "claims-review",
    title: "Claims Review",
    batch: "customer-insurance",
    description:
      "Open/closed claims by insurer with total-loss flags and supplement counts.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("insurer", "Insurer", "string"),
      col("claims", "Claims", "number"),
      col("totalLoss", "Total Loss", "number"),
      col("supplements", "Supplements", "number"),
      col("amount", "Claim $", "currency"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(6, (i) => ({
        insurer: insurer(i),
        claims: seeded(i + 2, 6, 60),
        totalLoss: seeded(i + 4, 0, 9),
        supplements: seeded(i + 1, 2, 40),
        amount: seeded(i + 7, 40000, 280000),
      })),
  },
  {
    slug: "name-recap-by-shop",
    title: "Name Recap by Shop",
    batch: "customer-insurance",
    description:
      "Repair customers (names) and their RO counts/dollars, grouped by shop.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("shop", "Shop", "string"),
      col("customer", "Customer", "string"),
      col("ros", "ROs", "number"),
      col("amount", "Amount", "currency"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(N, (i) => ({
        shop: shopName(i),
        customer: customerName(i),
        ros: seeded(i + 2, 1, 6),
        amount: seeded(i + 5, 1200, 24000),
      })),
  },

  // ───────────────── Individual Survey Responses (5 + Referral Comparison) ─────────────────
  {
    slug: "perfect-score",
    title: "Perfect Score",
    batch: "individual-survey",
    description:
      "Individual surveys returned with a perfect score — recognition + testimonial source.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("ro", "RO #", "string"),
      col("shop", "Shop", "string"),
      col("customer", "Customer", "string"),
      col("estimator", "Estimator", "string"),
      col("date", "Received", "date"),
    ],
    dataStatus: "pending-data",
    sampleRows: (p) =>
      build(N, (i) => ({
        ro: roNumber(i + 60),
        shop: shopName(i),
        customer: customerName(i + 1),
        estimator: estimator(i),
        date: sampleDate(p.start, i),
      })),
  },
  {
    slug: "mis-fire",
    title: "Mis-Fire",
    batch: "individual-survey",
    description:
      "Surveys where a high overall score masks a low sub-score (a 'mis-fire' to coach on).",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("ro", "RO #", "string"),
      col("shop", "Shop", "string"),
      col("overall", "Overall", "number"),
      col("lowSub", "Low Sub-Score", "string"),
      col("subScore", "Sub Value", "number"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(N, (i) => ({
        ro: roNumber(i + 70),
        shop: shopName(i),
        overall: seeded(i + 8, 9, 10),
        lowSub: pick(["Timeliness", "Communication", "Cleanliness"], i),
        subScore: seeded(i + 1, 3, 6),
      })),
  },
  {
    slug: "hot-spot",
    title: "Hot Spot",
    batch: "individual-survey",
    description:
      "Surveys clustering a recurring negative theme by shop/estimator — emerging hot spots.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("shop", "Shop", "string"),
      col("theme", "Theme", "string"),
      col("count", "Mentions", "number"),
      col("avgScore", "Avg Score", "number"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(6, (i) => ({
        shop: shopName(i),
        theme: pick(
          ["Wait time", "Paint match", "Detail/cleanliness", "Updates"],
          i,
        ),
        count: seeded(i + 2, 2, 12),
        avgScore: seeded(i + 5, 4, 7),
      })),
  },
  {
    slug: "unresolved-issue",
    title: "Unresolved Issue",
    batch: "individual-survey",
    description:
      "Surveys flagging an issue with no logged resolution — open service-recovery items.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("ro", "RO #", "string"),
      col("shop", "Shop", "string"),
      col("issue", "Issue", "string"),
      col("daysOpen", "Days Open", "number"),
      col("date", "Reported", "date"),
    ],
    dataStatus: "pending-data",
    sampleRows: (p) =>
      build(N, (i) => ({
        ro: roNumber(i + 80),
        shop: shopName(i),
        issue: pick(
          ["Paint defect", "Missed part", "Billing dispute", "Rework needed"],
          i,
        ),
        daysOpen: seeded(i + 3, 2, 30),
        date: sampleDate(p.start, i),
      })),
  },
  {
    slug: "referral-noted",
    title: "Referral Noted",
    batch: "individual-survey",
    description:
      "Surveys where the customer named a referral source — feeds the referral directory.",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("ro", "RO #", "string"),
      col("customer", "Customer", "string"),
      col("category", "Referral Category", "string"),
      col("source", "Source Named", "string"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      build(N, (i) => ({
        ro: roNumber(i + 90),
        customer: customerName(i),
        category: category(i),
        source: i % 2 === 0 ? insurer(i) : customerName(i + 3),
      })),
  },
  {
    slug: "referral-comparison",
    title: "Referral Comparison",
    batch: "individual-survey",
    description:
      "Period-over-period comparison of referral volume by category (current vs. prior).",
    params: { dateRange: true, filters: [SHOP_FILTER] },
    columns: [
      col("category", "Category", "string"),
      col("prior", "Prior Period", "number"),
      col("current", "Current Period", "number"),
      col("delta", "Change", "percent"),
    ],
    dataStatus: "pending-data",
    sampleRows: () =>
      ["Insurance Agent", "Repeat Customer", "Dealership", "Web/Search", "Word of Mouth"].map(
        (cat, i) => {
          const prior = seeded(i + 3, 5, 40);
          const current = seeded(i + 7, 5, 44);
          return {
            category: cat,
            prior,
            current,
            delta: Math.round(((current - prior) / prior) * 1000) / 10,
          };
        },
      ),
  },
];

// Local pick (sample.ts `pick` is generic; re-declare a tiny string helper to
// avoid importing the generic where only string arrays are used inline above).
function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

// Frozen registry, indexed by slug. Build-time integrity is asserted in tests.
export const REPORTS: ReportDefinition[] = definitions;

export const REPORTS_BY_SLUG: Map<string, ReportDefinition> = new Map(
  definitions.map((d) => [d.slug, d]),
);

export function getReport(slug: string): ReportDefinition | undefined {
  return REPORTS_BY_SLUG.get(slug);
}

export function reportsForBatch(batch: ReportBatchId): ReportDefinition[] {
  return definitions.filter((d) => d.batch === batch);
}

// Re-export for callers that build default params.
export type { ReportParams };
