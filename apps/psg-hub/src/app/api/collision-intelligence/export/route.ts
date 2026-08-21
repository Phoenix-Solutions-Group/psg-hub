export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getCollisionDashboard } from "@/lib/collision-intelligence/dashboard";
import { resolveCollisionDemoScope } from "@/lib/collision-intelligence/demo-scope";
import { EXPORT_CONTENT_TYPES, toCSV } from "@/lib/ops/reports/export";
import type { ReportResult, ReportRow } from "@/lib/ops/reports/types";
import { getActiveShopContext } from "@/lib/shop/context";
import { createClient } from "@/lib/supabase/server";

type CollisionDashboard = Awaited<ReturnType<typeof getCollisionDashboard>>;

const columns = [
  { key: "section", label: "Section", type: "string" as const },
  { key: "metric", label: "Metric", type: "string" as const },
  { key: "period", label: "Period", type: "string" as const },
  { key: "value", label: "Value", type: "string" as const },
  { key: "lower", label: "Lower", type: "number" as const },
  { key: "upper", label: "Upper", type: "number" as const },
  { key: "status", label: "Status", type: "string" as const },
  { key: "detail", label: "Detail", type: "string" as const },
];

function buildExport(
  dashboard: CollisionDashboard,
  generatedAt: string,
): ReportResult {
  const rows: ReportRow[] = [
    {
      section: "Scope",
      metric: "Shop",
      period: "",
      value: dashboard.companyName,
      lower: null,
      upper: null,
      status: "",
      detail: "Aggregate, privacy-safe collision repair intelligence.",
    },
    {
      section: "Scope",
      metric: "Generated at",
      period: generatedAt,
      value: generatedAt,
      lower: null,
      upper: null,
      status: "generated",
      detail: "UTC export time.",
    },
    {
      section: "Repair history",
      metric: "Repair orders",
      period: `${dashboard.summary.firstWeek ?? "unknown"} through ${dashboard.summary.latestWeek ?? "unknown"}`,
      value: dashboard.summary.repairOrders,
      lower: null,
      upper: null,
      status: "observed",
      detail: "Repair arrivals linked to this shop.",
    },
    {
      section: "Repair history",
      metric: "Insurance-paid repair share (%)",
      period: "All observed repairs",
      value: dashboard.summary.insuredSharePct,
      lower: null,
      upper: null,
      status: "observed",
      detail: `${dashboard.summary.insuredRepairOrders} insurance-paid repairs; denominator includes all ${dashboard.summary.repairOrders} repairs, including ${dashboard.summary.unknownPaymentRepairOrders} with unknown payment type. Carrier labels are repair records, not insurer claim counts.`,
    },
    {
      section: "Repair history",
      metric: "Unknown payment type repairs",
      period: "All observed repairs",
      value: dashboard.summary.unknownPaymentRepairOrders,
      lower: null,
      upper: null,
      status: dashboard.summary.unknownPaymentRepairOrders
        ? "disclosed"
        : "none",
      detail: "Unknown payment types are retained instead of guessed.",
    },
    {
      section: "Repair history",
      metric: "Repair value (USD)",
      period: "All observed repairs",
      value: dashboard.summary.repairValue,
      lower: null,
      upper: null,
      status: "observed",
      detail: `Average repair order: $${dashboard.summary.averageRepairAmount.toFixed(2)}.`,
    },
    {
      section: "Repair history",
      metric: "Average cycle time (days)",
      period: "Completed repairs",
      value: dashboard.summary.averageCycleDays,
      lower: null,
      upper: null,
      status:
        dashboard.summary.averageCycleDays === null
          ? "unavailable"
          : "observed",
      detail: "Uses repair orders with a valid arrival and completion date.",
    },
    {
      section: "Source health",
      metric: "Repair feed",
      period:
        dashboard.repairFeed?.latestArrivalDate ??
        dashboard.summary.latestWeek ??
        "unknown",
      value: dashboard.repairFeed?.sourceAgeHours ?? null,
      lower: null,
      upper: null,
      status: dashboard.repairFeed
        ? dashboard.repairFeed.isStale
          ? "stale"
          : "current"
        : "unavailable",
      detail: dashboard.repairFeed
        ? `Source age in hours; file modified ${dashboard.repairFeed.fileModifiedAt ?? "unknown"}.`
        : "No governed repair-feed status is available.",
    },
    {
      section: "Source health",
      metric: "Weather boundary coverage (%)",
      period: dashboard.weather.latestMonth ?? "unknown",
      value: dashboard.weather.latestCoveragePct,
      lower: null,
      upper: null,
      status: dashboard.weather.latestMonth ? "observed" : "unavailable",
      detail:
        "NOAA storm exposure is weighted by historical repair ZIPs; it is not vehicle damage or claim volume.",
    },
    {
      section: "Source health",
      metric: "Crash context",
      period: dashboard.crashes.latestMonth ?? "unknown",
      value: dashboard.crashes.latestTotal,
      lower: null,
      upper: null,
      status: dashboard.crashes.coverageStatus,
      detail:
        dashboard.crashes.coverageStatus === "covered"
          ? "Official KDOT crashes in qualifying customer ZIPs; reporting is delayed and this is not claim volume."
          : dashboard.crashes.coverageStatus === "national_fatal_context"
            ? `Official NHTSA FARS fatal-crash context for ${dashboard.crashes.nationalState ?? "the shop state"}; not total crashes or claim volume.`
            : "Local crash context is unavailable; unavailable does not mean zero crashes.",
    },
  ];

  if (dashboard.operationalForecasts.length) {
    for (const forecast of dashboard.operationalForecasts) {
      const evidence = dashboard.modelEvidence.find(
        (candidate) =>
          candidate.horizonWeeks === forecast.horizonWeeks &&
          candidate.modelKey === forecast.modelKey,
      );
      rows.push({
        section: "Forecast",
        metric: `Week ${forecast.horizonWeeks} aggregate repair arrivals`,
        period: forecast.week,
        value: forecast.predicted,
        lower: forecast.lower,
        upper: forecast.upper,
        status: forecast.status,
        detail: `${forecast.intervalPct}% operating interval; model ${forecast.modelKey}; source arrivals through ${forecast.sourceLatestArrivalDate ?? "unknown"} (${forecast.sourceAgeDays} day${forecast.sourceAgeDays === 1 ? "" : "s"} old).${evidence ? ` Held-out MAE improvement ${evidence.maeImprovementPct.toFixed(1)}%; interval coverage ${evidence.validationCoveragePct.toFixed(1)}%; model ${evidence.status}.` : " No governed model evidence is available."} ${forecast.reason}`,
      });
    }
  } else {
    rows.push({
      section: "Forecast",
      metric: "Aggregate repair arrivals",
      period: "",
      value: null,
      lower: null,
      upper: null,
      status: "unavailable",
      detail: "No forecast scoring run is available.",
    });
  }

  for (const alert of dashboard.alerts) {
    rows.push({
      section: "Weather signal",
      metric: `${alert.eventType} · ZIP ${alert.zipCode}`,
      period: alert.eventAt,
      value: alert.historicalRepairOrders,
      lower: null,
      upper: null,
      status:
        alert.alertLevel === "high"
          ? "severe_threshold_met"
          : "below_severe_threshold",
      detail: `${alert.isProvisional ? "Preliminary" : "Final"} NOAA report${alert.magnitude === null ? "" : `; ${alert.magnitude} ${alert.magnitudeUnit ?? ""}`}; ${alert.thresholdBasis}. Historical repair orders are market exposure, not storm damage or claims.`,
    });
  }

  for (const reviewCase of dashboard.weatherReviewCases) {
    rows.push({
      section: "Weather follow-up",
      metric: `${reviewCase.eventType} · ZIP ${reviewCase.zipCode} · signal`,
      period: reviewCase.eventDate,
      value: reviewCase.evidence.observedFourWeekRepairOrders,
      lower: null,
      upper: null,
      status: reviewCase.status === "closed" ? reviewCase.outcome : "pending",
      detail: `Weeks 1–4: ${reviewCase.evidence.weeklyRepairOrders.join(" / ")} repairs; prior 52 weeks: ${reviewCase.evidence.prior52WeekRepairOrders}; follow-through threshold: ${reviewCase.evidence.followThroughThresholdRepairOrders}; evidence ${reviewCase.evidence.matureForClose ? "complete" : "incomplete"}; repair arrivals through ${reviewCase.evidence.sourceLatestArrivalDate ?? "unknown"}. This records shop repair arrivals and does not prove weather caused demand.`,
    });
    rows.push({
      section: "Weather follow-up",
      metric: `${reviewCase.eventType} · ZIP ${reviewCase.zipCode} · matched control`,
      period: reviewCase.control.eventDate ?? "unavailable",
      value:
        reviewCase.control.matchStatus === "matched"
          ? reviewCase.control.observedFourWeekRepairOrders
          : null,
      lower: null,
      upper: null,
      status:
        reviewCase.control.matchStatus === "matched"
          ? (reviewCase.control.derivedOutcome ?? "pending")
          : "unavailable",
      detail:
        reviewCase.control.matchStatus === "matched"
          ? `Pre-registered ${reviewCase.control.yearsBack} year${reviewCase.control.yearsBack === 1 ? "" : "s"} earlier; weeks 1–4: ${reviewCase.control.weeklyRepairOrders.join(" / ")} repairs; prior 52 weeks: ${reviewCase.control.prior52WeekRepairOrders}; follow-through threshold: ${reviewCase.control.followThroughThresholdRepairOrders}. Official final NCEI years and ZIP coverage were required, with no overlapping severe threshold.`
          : "No eligible prior one-to-five-year period had complete repair/weather coverage without an overlapping severe threshold. This case cannot enter prospective matched-control monitoring.",
    });
  }

  if (dashboard.weatherAlertMonitoring.length) {
    for (const monitoring of dashboard.weatherAlertMonitoring) {
      rows.push({
        section: "Weather validation",
        metric: `${monitoring.cohort} matched-control difference (percentage points)`,
        period: "Closed evaluable cases",
        value: monitoring.liftPctPoints,
        lower: null,
        upper: null,
        status: "descriptive_only",
        detail: `${monitoring.matchedCaseCount} matched case${monitoring.matchedCaseCount === 1 ? "" : "s"}; signal follow-through ${monitoring.signalFollowThroughRatePct.toFixed(1)}%; control follow-through ${monitoring.controlFollowThroughRatePct.toFixed(1)}%. PSG has not approved a minimum sample, economic lift, or false-positive tolerance; this cannot enable notifications or operational changes.`,
      });
    }
  } else {
    rows.push({
      section: "Weather validation",
      metric: "Prospective matched-control evidence",
      period: "",
      value: null,
      lower: null,
      upper: null,
      status: dashboard.alertReviewAvailable
        ? "awaiting_evaluable_cases"
        : "release_pending",
      detail: dashboard.alertReviewAvailable
        ? "No closed evaluable matched cases are available yet. Notifications remain disabled."
        : "The reviewed weather lifecycle migration is not applied. Notifications remain disabled.",
    });
  }

  rows.push(
    {
      section: "Limitations",
      metric: "Forecast target",
      period: "",
      value: "Aggregate weekly shop repair arrivals",
      lower: null,
      upper: null,
      status: "disclosure",
      detail:
        "The model does not predict individual crashes or insurer claim volume.",
    },
    {
      section: "Limitations",
      metric: "Operational use",
      period: "",
      value: "Decision support",
      lower: null,
      upper: null,
      status: "disclosure",
      detail:
        "Review forecast intervals, source freshness, held-out evidence, booked work, and shop capacity before changing staffing, scheduling, parts, or marketing.",
    },
  );

  return { columns, rows, sample: false, generatedAt };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shops, activeShopId } = await getActiveShopContext(user.id);
  if (!activeShopId)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const demoScope = resolveCollisionDemoScope(user.email, shops);
    const dashboard = demoScope
      ? await getCollisionDashboard(activeShopId, demoScope)
      : await getCollisionDashboard(activeShopId);
    if (!dashboard.companyName) {
      return NextResponse.json(
        { error: "No linked repair history" },
        { status: 404 },
      );
    }

    const generatedAt = new Date().toISOString();
    const filenameDate = generatedAt.slice(0, 10);
    return new NextResponse(toCSV(buildExport(dashboard, generatedAt)), {
      headers: {
        "Content-Type": EXPORT_CONTENT_TYPES.csv,
        "Content-Disposition": `attachment; filename="collision-intelligence-${filenameDate}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[collision-intelligence-export] failed", error);
    return NextResponse.json(
      { error: "Collision intelligence export unavailable" },
      { status: 500 },
    );
  }
}
