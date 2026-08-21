import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChartCard, LineChartCard } from "@/components/analytics/charts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCollisionDashboard } from "@/lib/collision-intelligence/dashboard";
import { getActiveShopContext } from "@/lib/shop/context";
import { createClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ weather_review?: string | string[] }>;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const eventTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const eventLabels: Record<string, string> = {
  hail: "Hail",
  tornado: "Tornado",
  "thunderstorm wind": "Thunderstorm wind",
};

const weatherReviewNotices: Record<string, string> = {
  acknowledged:
    "Weather signal acknowledged. It now has an owner and remains review-only.",
  closed: "Weather follow-up closed with an observed repair-demand outcome.",
  release_pending:
    "Weather review decisions stay read-only until the reviewed database migration is applied.",
  evidence_incomplete:
    "Keep this follow-up open. Four complete weeks and repair history spanning the prior 52 weeks are required before an observed outcome can be recorded.",
  stale:
    "That weather signal or follow-up changed before it could be saved. The dashboard has been refreshed.",
  error: "The weather review could not be saved. No review state changed.",
};

function formatDate(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatChange(changePct: number | null) {
  if (changePct === null) return "No prior-period baseline";
  if (changePct === 0) return "Flat vs prior period";
  return `${changePct > 0 ? "Up" : "Down"} ${Math.abs(changePct).toFixed(1)}% vs prior period`;
}

export default async function CollisionIntelligencePage({
  searchParams,
}: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { shops, activeShopId } = await getActiveShopContext(user.id);
  if (!activeShopId) redirect("/dashboard");

  const params = await searchParams;
  const weatherReviewResult =
    typeof params.weather_review === "string" ? params.weather_review : "";
  const weatherReviewNotice = weatherReviewNotices[weatherReviewResult];
  const activeShop = shops.find((shop) => shop.id === activeShopId);
  const canReviewWeather =
    activeShop?.role === "owner" || activeShop?.role === "manager";
  const dashboard = await getCollisionDashboard(activeShopId);
  const { summary, baseline, operationalForecast, operationalForecasts } =
    dashboard;
  const openWeatherReviewCases = dashboard.weatherReviewCases.filter(
    (reviewCase) => reviewCase.status === "acknowledged",
  );
  const closedWeatherReviewCases = dashboard.weatherReviewCases.filter(
    (reviewCase) => reviewCase.status === "closed",
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Collision intelligence
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {dashboard.companyName ?? "Repair demand"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Repair history, insurance mix, weather exposure, and forecast
            readiness.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dashboard.companyName ? (
            <a
              href="/api/collision-intelligence/export"
              className="rounded-md border border-border px-3 py-2 font-heading text-sm font-medium transition-colors hover:bg-secondary"
            >
              Download CSV report
            </a>
          ) : null}
          <Link
            href="/dashboard/analytics"
            className="rounded-md border border-border px-3 py-2 font-heading text-sm font-medium transition-colors hover:bg-secondary"
          >
            Marketing analytics
          </Link>
        </div>
      </div>

      {weatherReviewNotice ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm"
        >
          {weatherReviewNotice}
        </p>
      ) : null}

      {!dashboard.companyName ? (
        <Card>
          <CardHeader>
            <CardTitle>No repair history linked</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            This shop does not yet have mapped repair-order history.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div>
                <p className="font-heading font-semibold">
                  Pilot data coverage
                </p>
                <p className="text-sm text-muted-foreground">
                  Repair feed exported{" "}
                  {dashboard.repairFeed?.fileModifiedAt
                    ? eventTime.format(
                        new Date(dashboard.repairFeed.fileModifiedAt),
                      )
                    : "not available"}
                  ; repair arrivals end{" "}
                  {formatDate(
                    dashboard.repairFeed?.latestArrivalDate ??
                      summary.latestWeek,
                  )}
                  ; weather extends through{" "}
                  {formatDate(dashboard.weather.latestMonth)};{" "}
                  {dashboard.crashes.coverageStatus === "covered"
                    ? `completed-month KDOT crashes extend through ${formatDate(dashboard.crashes.latestMonth)}.`
                    : dashboard.crashes.coverageStatus ===
                        "national_fatal_context"
                      ? `official NHTSA FARS ${dashboard.crashes.nationalYear} fatal-crash context is available for ${dashboard.crashes.nationalState}; it is not total crashes or claim volume.`
                      : dashboard.crashes.coverageStatus ===
                          "outside_kansas_portfolio"
                        ? "the KDOT source is loaded, but this shop has no qualifying Kansas customer ZIPs."
                        : "the local crash source is unavailable."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={
                    dashboard.repairFeed && !dashboard.repairFeed.isStale
                      ? "success"
                      : "warning"
                  }
                >
                  {dashboard.repairFeed && !dashboard.repairFeed.isStale
                    ? "Source snapshot current"
                    : "Source snapshot stale"}
                </Badge>
                <Badge
                  variant={
                    operationalForecast &&
                    operationalForecast.sourceAgeDays <= 14
                      ? "success"
                      : "warning"
                  }
                >
                  {!operationalForecast
                    ? "Shop arrivals unavailable"
                    : operationalForecast.sourceAgeDays <= 14
                      ? "Shop arrivals current"
                      : "Shop arrivals stale"}
                </Badge>
                <Badge
                  variant={
                    operationalForecast?.status === "published"
                      ? "success"
                      : "warning"
                  }
                >
                  {operationalForecast?.status === "published"
                    ? "Forecast live"
                    : "Forecast paused"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Repair orders"
              value={summary.repairOrders.toLocaleString()}
            />
            <MetricCard
              label="Insurance-paid"
              value={`${summary.insuredSharePct.toFixed(1)}%`}
              detail={`${summary.insuredRepairOrders.toLocaleString()} repair orders${summary.unknownPaymentRepairOrders ? ` · ${summary.unknownPaymentRepairOrders.toLocaleString()} with unknown payment type` : ""}`}
            />
            <MetricCard
              label="Repair value"
              value={currency.format(summary.repairValue)}
              detail={`${currency.format(summary.averageRepairAmount)} average RO`}
            />
            <MetricCard
              label="Average cycle time"
              value={
                summary.averageCycleDays === null
                  ? "—"
                  : `${summary.averageCycleDays.toFixed(1)} days`
              }
            />
          </div>

          {dashboard.recentPerformance ? (
            <section
              aria-labelledby="recent-performance-heading"
              className="space-y-3"
            >
              <div>
                <h2
                  id="recent-performance-heading"
                  className="text-lg font-semibold"
                >
                  Recent operating trend
                </h2>
                <p className="text-sm text-muted-foreground">
                  {dashboard.recentPerformance.windowWeeks} completed source
                  weeks, {formatDate(dashboard.recentPerformance.currentStart)}–
                  {formatDate(dashboard.recentPerformance.currentEnd)}, compared
                  with {formatDate(dashboard.recentPerformance.priorStart)}–
                  {formatDate(dashboard.recentPerformance.priorEnd)}. The newest
                  potentially partial source week is excluded.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Workload"
                  value={`${dashboard.recentPerformance.workload.current.toLocaleString()} ROs`}
                  detail={`${formatChange(dashboard.recentPerformance.workload.changePct)} · ${dashboard.recentPerformance.workload.prior.toLocaleString()} prior`}
                />
                <MetricCard
                  label="Insurance-paid workload"
                  value={`${dashboard.recentPerformance.insuredWorkload.current.toLocaleString()} ROs`}
                  detail={`${formatChange(dashboard.recentPerformance.insuredWorkload.changePct)} · ${dashboard.recentPerformance.insuredWorkload.prior.toLocaleString()} prior`}
                />
                <MetricCard
                  label="Repair value"
                  value={currency.format(
                    dashboard.recentPerformance.repairValue.current,
                  )}
                  detail={`${formatChange(dashboard.recentPerformance.repairValue.changePct)} · ${currency.format(dashboard.recentPerformance.repairValue.prior)} prior`}
                />
                <MetricCard
                  label="Average cycle time"
                  value={
                    dashboard.recentPerformance.cycleTime.current === null
                      ? "—"
                      : `${dashboard.recentPerformance.cycleTime.current.toFixed(1)} days`
                  }
                  detail={`${formatChange(dashboard.recentPerformance.cycleTime.changePct)} · ${dashboard.recentPerformance.cycleTime.currentObservations.toLocaleString()} completed ROs`}
                />
              </div>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <InsightListCard
              title="Top insurers"
              caption="Carrier-tagged repairs, not claim counts. Canonical merges require explicit alias approval."
              items={dashboard.topInsurers.map((insurer) => ({
                label: insurer.name,
                detail: `${currency.format(insurer.repairValue)} repair value · ${insurer.aliasStatus === "approved" ? "canonical alias" : "unreviewed label"}`,
                value: `${insurer.repairOrders.toLocaleString()} ROs`,
              }))}
            />
            <InsightListCard
              title="Leading customer ZIPs"
              caption="Historical customer markets for repair demand and weather exposure."
              items={dashboard.topCustomerZips.map((market) => ({
                label: `ZIP ${market.zipCode}${market.state ? ` · ${market.state}` : ""}`,
                detail: `${currency.format(market.repairValue)} repair value · ${market.insuredRepairOrders.toLocaleString()} insurance-paid`,
                value: `${market.repairOrders.toLocaleString()} ROs`,
              }))}
            />
            <InsightListCard
              title="Most common vehicles"
              caption="Repair volume by normalized make and model."
              items={dashboard.topVehicles.map((vehicle) => ({
                label: vehicle.label,
                detail: `${currency.format(vehicle.repairValue)} repair value`,
                value: `${vehicle.repairOrders.toLocaleString()} ROs`,
              }))}
            />
            <InsightListCard
              title="Data quality watchlist"
              caption="Source issues are retained as flags instead of silently guessed."
              items={dashboard.dataQuality.map((quality) => ({
                label: quality.issue.replaceAll("_", " "),
                detail: `${quality.affectedPercent.toFixed(2)}% of this shop's repairs`,
                value: quality.affectedRepairs.toLocaleString(),
              }))}
            />
          </div>

          {dashboard.seasonality ? (
            <section
              aria-labelledby="seasonality-heading"
              className="space-y-3"
            >
              <div>
                <h2 id="seasonality-heading" className="text-lg font-semibold">
                  Seasonal demand and revenue
                </h2>
                <p className="text-sm text-muted-foreground">
                  Average calendar-month performance across{" "}
                  {dashboard.seasonality.yearCount} complete source years (
                  {dashboard.seasonality.firstYear}–
                  {dashboard.seasonality.latestYear}). Partial boundary years
                  are excluded.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <BarChartCard
                  title="Average repairs by month"
                  caption="Average monthly repair arrivals across the complete-year comparison window."
                  data={dashboard.seasonality.series}
                  dataKey="averageRepairOrders"
                  xKey="month"
                  ariaLabel={`Average monthly repair arrivals from ${dashboard.seasonality.firstYear} through ${dashboard.seasonality.latestYear}`}
                />
                <InsightListCard
                  title="Seasonal revenue leaders"
                  caption="Average repair value by calendar month across the same complete years."
                  items={dashboard.seasonality.revenueLeaders.map((month) => ({
                    label: month.month,
                    detail: `${month.averageRepairOrders.toFixed(1)} average ROs · ${month.insuredSharePct.toFixed(1)}% insurance-paid`,
                    value: `${currency.format(month.averageRepairValue)} avg`,
                  }))}
                />
              </div>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <LineChartCard
              title="Weekly repair arrivals"
              caption="Most recent 52 observed weeks; missing weeks are shown as zero."
              data={dashboard.weeklySeries}
              dataKey="orders"
              xKey="week"
              ariaLabel="Weekly repair-order arrivals over the latest 52 weeks"
            />
            {dashboard.crashes.coverageStatus === "covered" ||
            dashboard.crashes.coverageStatus === "national_fatal_context" ? (
              <BarChartCard
                title={
                  dashboard.crashes.coverageStatus === "covered"
                    ? "Crashes in customer ZIPs"
                    : "State fatal-crash context"
                }
                caption={
                  dashboard.crashes.coverageStatus === "covered"
                    ? `Official KDOT crashes across ${dashboard.crashes.activeZipCount} of ${dashboard.crashes.customerZipCount} qualifying Kansas customer ZIPs; the current partial month is excluded.`
                    : `Official NHTSA FARS fatal crashes in ${dashboard.crashes.nationalState} by month for ${dashboard.crashes.nationalYear}. This is a fatal-crash census—not total crashes or claim volume.`
                }
                data={dashboard.crashSeries}
                dataKey="crashes"
                xKey="month"
                ariaLabel={
                  dashboard.crashes.coverageStatus === "covered"
                    ? "Monthly KDOT crashes in repair-customer ZIPs over the latest 12 complete months"
                    : `Monthly NHTSA fatal crashes in ${dashboard.crashes.nationalState} during ${dashboard.crashes.nationalYear}`
                }
                color="var(--chart-3)"
              />
            ) : (
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle>Local crash trend unavailable</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {dashboard.crashes.coverageStatus ===
                      "outside_kansas_portfolio"
                        ? "The current local crash source covers Kansas customer ZIPs only. This shop has no qualifying Kansas ZIPs, so no crash chart is shown. This is unavailable data—not zero crashes."
                        : "The KDOT source has not completed a loaded sync. No crash chart is shown; unavailable data does not mean zero crashes."}
                    </p>
                  </div>
                  <Badge variant="warning">
                    {dashboard.crashes.coverageStatus ===
                    "outside_kansas_portfolio"
                      ? "Kansas-only source"
                      : "Source unavailable"}
                  </Badge>
                </CardHeader>
              </Card>
            )}
            <BarChartCard
              title="Customer-market storm exposure"
              caption="Historical-repair-weighted NOAA storm score; exposure is not a claim count."
              data={dashboard.weatherSeries}
              dataKey="score"
              xKey="month"
              ariaLabel="Monthly weighted storm exposure over the latest 12 months"
              color="var(--chart-2)"
            />
          </div>

          <Card id="weather-alerts">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Recent severe-weather signals</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  NOAA SPC preliminary reports matched to repair-customer ZIPs
                  in the last 72 hours. Review before acting.
                  {dashboard.alertFeed?.refreshedAt
                    ? ` Feed refreshed ${eventTime.format(new Date(dashboard.alertFeed.refreshedAt))}.`
                    : " Feed has not completed a scheduled refresh."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Notifications off</Badge>
                {!dashboard.alertReviewAvailable ? (
                  <Badge variant="warning">Review lifecycle pending</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {dashboard.alerts.length ? (
                <ul className="divide-y divide-border">
                  {dashboard.alerts.map((alert) => (
                    <li
                      key={`${alert.sourceEventId}-${alert.zipCode}`}
                      className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-heading font-semibold">
                            {eventLabels[alert.eventType] ?? alert.eventType} ·
                            ZIP {alert.zipCode}
                          </p>
                          <Badge
                            variant={
                              alert.alertLevel === "high"
                                ? "destructive"
                                : "warning"
                            }
                          >
                            {alert.alertLevel === "high"
                              ? "Severe threshold met"
                              : "Below severe threshold"}
                          </Badge>
                          {alert.reviewCase ? (
                            <Badge variant="outline">
                              {alert.reviewCase.status === "closed"
                                ? "Follow-up closed"
                                : "Acknowledged"}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {alert.reportCount > 1
                            ? `${alert.reportCount} reports · Latest `
                            : ""}
                          {eventTime.format(new Date(alert.eventAt))} ·{" "}
                          {alert.magnitude !== null
                            ? `${alert.reportCount > 1 ? "Peak " : ""}${alert.magnitude.toLocaleString()} ${alert.magnitudeUnit ?? ""} · `
                            : ""}
                          {alert.thresholdBasis}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {alert.historicalRepairOrders.toLocaleString()}{" "}
                        historical repair
                        {alert.historicalRepairOrders === 1 ? "" : "s"} from
                        this ZIP
                      </p>
                      {dashboard.alertReviewAvailable &&
                      canReviewWeather &&
                      alert.alertLevel === "high" &&
                      !alert.reviewCase ? (
                        <form
                          action="/api/collision-intelligence/weather-alert-review"
                          method="post"
                        >
                          <input
                            type="hidden"
                            name="action"
                            value="acknowledge"
                          />
                          <input
                            type="hidden"
                            name="zip_code"
                            value={alert.zipCode}
                          />
                          <input
                            type="hidden"
                            name="event_type"
                            value={alert.eventType}
                          />
                          <input
                            type="hidden"
                            name="event_date"
                            value={alert.eventDate}
                          />
                          <button
                            type="submit"
                            className="rounded-md border border-border px-3 py-2 font-heading text-sm font-medium hover:bg-secondary"
                          >
                            Acknowledge and own
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No preliminary SPC reports matched this customer ZIP portfolio
                  in the last 72 hours.
                </p>
              )}
              {openWeatherReviewCases.length ? (
                <div className="mt-5 space-y-3 border-t border-border pt-4">
                  <div>
                    <h3 className="font-heading font-semibold">
                      Owned follow-ups
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Compare the next four weeks of repair arrivals with this
                      ZIP&apos;s prior 52 weeks, then record what PSG observed.
                      This does not prove the weather caused the repairs.
                    </p>
                  </div>
                  {openWeatherReviewCases.map((reviewCase) => (
                    <form
                      key={reviewCase.id}
                      action="/api/collision-intelligence/weather-alert-review"
                      method="post"
                      className="space-y-3 rounded-md border border-border p-3"
                    >
                      <input type="hidden" name="action" value="close" />
                      <input
                        type="hidden"
                        name="case_id"
                        value={reviewCase.id}
                      />
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-heading text-sm font-semibold">
                            {eventLabels[reviewCase.eventType] ??
                              reviewCase.eventType}{" "}
                            · ZIP {reviewCase.zipCode}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Signal date {formatDate(reviewCase.eventDate)} ·{" "}
                            {reviewCase.reportCount} preliminary{" "}
                            {reviewCase.reportCount === 1
                              ? "report"
                              : "reports"}
                          </p>
                        </div>
                        <Badge variant="outline">Acknowledged</Badge>
                      </div>
                      <div className="space-y-2 rounded-md bg-secondary/40 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">
                            {reviewCase.evidence.followUpWeeksComplete} of 4
                            follow-up weeks complete
                          </p>
                          <span className="text-xs text-muted-foreground">
                            Repair data through{" "}
                            {formatDate(
                              reviewCase.evidence.sourceLatestArrivalDate,
                            )}
                          </span>
                        </div>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                          {reviewCase.evidence.weeklyRepairOrders.map(
                            (repairOrders, index) => (
                              <div key={index}>
                                <dt className="text-xs text-muted-foreground">
                                  Week {index + 1}
                                </dt>
                                <dd className="font-heading font-semibold">
                                  {index <
                                  reviewCase.evidence.followUpWeeksComplete
                                    ? `${repairOrders} repairs`
                                    : "Waiting for data"}
                                </dd>
                              </div>
                            ),
                          )}
                        </dl>
                        <p className="text-xs leading-5 text-muted-foreground">
                          Prior 52 weeks:{" "}
                          {reviewCase.evidence.baselineSourceSpanComplete
                            ? `${reviewCase.evidence.prior52WeekRepairOrders} repairs (${(
                                reviewCase.evidence.prior52WeekRepairOrders / 52
                              ).toFixed(1)} per week)`
                            : "repair history does not span the prior 52 weeks; observed outcomes cannot be evaluated"}
                          . Same-day arrivals are excluded.
                        </p>
                      </div>
                      {canReviewWeather ? (
                        <div className="grid gap-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] md:items-end">
                          {reviewCase.evidence.matureForClose ? (
                            <div className="text-sm">
                              <input
                                type="hidden"
                                name="outcome"
                                value={
                                  reviewCase.evidence.derivedOutcome ??
                                  "not_evaluable"
                                }
                              />
                              <p className="font-medium">
                                Measured repair-arrival outcome
                              </p>
                              <p className="mt-1 font-heading font-semibold">
                                {reviewCase.evidence.derivedOutcome ===
                                "observed_follow_through"
                                  ? "Above historical repair pace"
                                  : "At or below historical repair pace"}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {
                                  reviewCase.evidence
                                    .observedFourWeekRepairOrders
                                }{" "}
                                repairs observed; follow-through requires{" "}
                                {
                                  reviewCase.evidence
                                    .followThroughThresholdRepairOrders
                                }{" "}
                                or more.
                              </p>
                            </div>
                          ) : (
                            <label className="flex items-start gap-2 text-sm leading-5">
                              <input
                                type="checkbox"
                                name="outcome"
                                value="not_evaluable"
                                required
                                aria-describedby={`weather-evidence-${reviewCase.id}`}
                                className="mt-1"
                              />
                              <span>
                                <strong className="block font-medium">
                                  Close as not evaluable
                                </strong>
                                Use only when the missing source span cannot be
                                recovered.
                              </span>
                            </label>
                          )}
                          <label className="text-sm font-medium">
                            Outcome evidence
                            <textarea
                              name="outcome_notes"
                              required
                              minLength={20}
                              maxLength={2000}
                              rows={2}
                              placeholder="Describe the follow-up window, observed arrivals, and limitations."
                              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                            />
                          </label>
                          <button
                            type="submit"
                            className="rounded-md bg-primary px-3 py-2 font-heading text-sm font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            {reviewCase.evidence.matureForClose
                              ? "Record measured outcome"
                              : "Close as not evaluable"}
                          </button>
                          <p
                            id={`weather-evidence-${reviewCase.id}`}
                            className="text-xs leading-5 text-muted-foreground md:col-span-3"
                          >
                            {reviewCase.evidence.matureForClose
                              ? "The four-week window and 52-week baseline are complete. The database derives the outcome from repair arrivals; use the note for booked-work context and limitations."
                              : "Keep this follow-up open until all four weeks are complete. Close it only if the missing source span cannot be recovered."}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          A shop owner or manager must record the outcome.
                        </p>
                      )}
                    </form>
                  ))}
                </div>
              ) : null}
              {closedWeatherReviewCases.length ? (
                <details className="mt-4 rounded-md border border-border p-3">
                  <summary className="cursor-pointer font-heading text-sm font-semibold">
                    Recent closed follow-ups · {closedWeatherReviewCases.length}
                  </summary>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {closedWeatherReviewCases.map((reviewCase) => (
                      <li key={reviewCase.id}>
                        {eventLabels[reviewCase.eventType] ??
                          reviewCase.eventType}{" "}
                        · ZIP {reviewCase.zipCode} ·{" "}
                        {reviewCase.outcome === "observed_follow_through"
                          ? "above historical repair pace"
                          : reviewCase.outcome === "no_observed_follow_through"
                            ? "at or below historical repair pace"
                            : "not evaluable"}{" "}
                        · weeks 1–4:{" "}
                        {reviewCase.evidence.weeklyRepairOrders.join(" / ")}{" "}
                        repairs · four-week threshold{" "}
                        {reviewCase.evidence.followThroughThresholdRepairOrders}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                A severe threshold describes the weather report, not predicted
                repair demand. Acknowledgement creates an owned review case; it
                does not send a notification or justify an operational change.
                Historical testing does not yet support automated customer
                notifications.
              </p>
            </CardContent>
          </Card>

          <section aria-labelledby="forecast-heading" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="forecast-heading" className="text-lg font-semibold">
                  Historical baseline check
                </h2>
                <p className="text-sm text-muted-foreground">
                  Exploratory final-year holdout after a 52-week calibration
                  window. Approval uses the governed evaluator below.
                </p>
              </div>
              {baseline?.beatsSeasonal ? (
                <Badge variant="success">
                  Preliminary · {baseline.maeImprovementPct.toFixed(1)}% lower
                  MAE
                </Badge>
              ) : null}
            </div>

            <Card
              className={
                operationalForecast?.status === "published"
                  ? "border-success/40 bg-success/5"
                  : "border-warning/40 bg-warning/5"
              }
            >
              <CardHeader>
                <CardTitle>Four-week operating forecast</CardTitle>
              </CardHeader>
              <CardContent>
                {operationalForecasts.length ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {operationalForecasts.map((forecast) => {
                      const evidence = dashboard.modelEvidence.find(
                        (candidate) =>
                          candidate.horizonWeeks === forecast.horizonWeeks &&
                          candidate.modelKey === forecast.modelKey,
                      );

                      return (
                        <div
                          key={forecast.horizonWeeks}
                          className={
                            forecast.status === "published"
                              ? "rounded-lg border border-success/30 bg-background/70 p-4"
                              : "rounded-lg border border-warning/40 bg-background/70 p-4"
                          }
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Week {forecast.horizonWeeks} ·{" "}
                              {formatDate(forecast.week)}
                            </p>
                            <Badge
                              variant={
                                forecast.status === "published"
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {forecast.status.replaceAll("_", " ")}
                            </Badge>
                          </div>
                          {forecast.status === "published" &&
                          forecast.predicted !== null ? (
                            <>
                              <p className="mt-2 text-2xl font-bold tracking-tight">
                                {forecast.predicted.toFixed(1)} repairs
                              </p>
                              <p className="mt-1 text-sm text-foreground/75">
                                {forecast.intervalPct}% interval:{" "}
                                {forecast.lower}–{forecast.upper}
                              </p>
                            </>
                          ) : null}
                          <p className="mt-3 text-xs leading-5 text-muted-foreground">
                            Origin {formatDate(forecast.originWeek)} · Model{" "}
                            {forecast.modelKey.replaceAll("_", " ")}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Source arrivals through{" "}
                            {forecast.sourceLatestArrivalDate
                              ? formatDate(forecast.sourceLatestArrivalDate)
                              : "unknown"}
                            {forecast.sourceLatestArrivalDate
                              ? ` · ${forecast.sourceAgeDays} days old`
                              : ""}
                          </p>
                          {evidence ? (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              Held-out evidence:{" "}
                              {evidence.maeImprovementPct.toFixed(1)}% lower MAE
                              · {evidence.validationCoveragePct.toFixed(1)}%
                              interval coverage · {evidence.status}
                            </p>
                          ) : null}
                          <p className="mt-2 text-xs leading-5 text-foreground/75">
                            {forecast.reason}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div>
                    <p className="font-heading font-semibold">
                      Forecast not ready
                    </p>
                    <p className="mt-1 text-sm text-foreground/75">
                      {operationalForecast?.reason ??
                        "No forecast scoring run is available yet."}
                    </p>
                  </div>
                )}
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  These estimates predict aggregate shop repair arrivals—not
                  individual crashes or insurer claim volume. Use the interval,
                  source freshness, and held-out evidence before changing
                  operations.
                </p>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <div>
                <h3 className="font-heading font-semibold">
                  Planning guidance
                </h3>
                <p className="text-sm text-muted-foreground">
                  Decision checkpoints grounded in observed history, governed
                  forecasts, and preliminary weather—not automatic actions.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {dashboard.planningGuidance.map((guidance) => (
                  <Card key={guidance.area}>
                    <CardHeader className="flex flex-row items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {guidance.area}
                        </p>
                        <CardTitle className="mt-1 text-base">
                          {guidance.title}
                        </CardTitle>
                      </div>
                      <Badge
                        variant={
                          guidance.status === "ready"
                            ? "success"
                            : guidance.status === "blocked"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {guidance.status}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      {guidance.week ? (
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Week of {formatDate(guidance.week)}
                        </p>
                      ) : null}
                      <p className="text-sm text-foreground/75">
                        {guidance.detail}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {dashboard.modelEvidence.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Confidence by forecast week</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Each week is promoted separately against the seasonal
                    baseline, then its operating interval is checked on held-out
                    shops.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {dashboard.modelEvidence.map((evidence) => (
                    <div
                      key={evidence.horizonWeeks}
                      className="rounded-lg border border-border p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-heading font-semibold">
                          Week {evidence.horizonWeeks}
                        </p>
                        <Badge
                          variant={
                            evidence.status === "approved"
                              ? "success"
                              : "warning"
                          }
                        >
                          {evidence.status}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm capitalize text-foreground/75">
                        {evidence.modelKey.replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        MAE {evidence.modelMae.toFixed(2)} vs seasonal{" "}
                        {evidence.seasonalMae.toFixed(2)} (
                        {evidence.maeImprovementPct.toFixed(1)}% lower)
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        80% range ±{evidence.intervalHalfWidth.toFixed(0)}{" "}
                        repairs · {evidence.validationCoveragePct.toFixed(1)}%
                        held-out coverage after{" "}
                        {evidence.intervalMultiplier.toFixed(2)}× widening
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {dashboard.forecastMonitoring.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Live forecast scorecard</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Rolling 13-observation monitoring by horizon. Review states
                    never change model approval automatically.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {dashboard.forecastMonitoring.map((monitoring) => (
                    <div
                      key={monitoring.horizonWeeks}
                      className="rounded-lg border border-border p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-heading font-semibold">
                          Week {monitoring.horizonWeeks}
                        </p>
                        <Badge
                          variant={
                            monitoring.status === "within_policy"
                              ? "success"
                              : monitoring.status === "awaiting_actuals"
                                ? "secondary"
                                : "warning"
                          }
                        >
                          {monitoring.status.replaceAll("_", " ")}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-foreground/75">
                        {monitoring.observations}/{monitoring.windowWeeks}{" "}
                        observed weeks
                      </p>
                      {monitoring.liveMae === null ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {monitoring.reason}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          MAE {monitoring.liveMae.toFixed(2)} · WAPE{" "}
                          {monitoring.liveWapePct?.toFixed(1)}% · coverage{" "}
                          {monitoring.liveCoveragePct?.toFixed(1)}%
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {baseline ? (
              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard
                  label="Seasonal 52-week MAE"
                  value={baseline.models.seasonal52.mae.toFixed(2)}
                  detail={`${baseline.models.seasonal52.wapePct.toFixed(1)}% WAPE`}
                />
                <MetricCard
                  label="Trailing 4-week MAE"
                  value={baseline.models.trailing4.mae.toFixed(2)}
                  detail={`${baseline.models.trailing4.wapePct.toFixed(1)}% WAPE`}
                />
                <MetricCard
                  label="Holdout"
                  value="52 weeks"
                  detail={`${baseline.holdoutRepairs.toLocaleString()} repair orders`}
                />
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6 text-muted-foreground">
                  At least 156 calendar weeks are required before this
                  exploratory seasonal comparison is shown. Long coverage gaps
                  can require more history in the governed evaluator.
                </CardContent>
              </Card>
            )}
          </section>

          <Card>
            <CardHeader>
              <CardTitle>How to use and interpret this data</CardTitle>
              <p className="text-sm text-muted-foreground">
                Operational guidance first; expand the data guide for exact
                definitions, sources, freshness rules, and limits.
              </p>
            </CardHeader>
            <CardContent className="space-y-5 text-sm text-muted-foreground">
              <div className="grid gap-4 md:grid-cols-3">
                <p>
                  <strong className="text-foreground">Staffing:</strong> use
                  weekly arrivals and recent workload for short-range capacity
                  conversations.
                </p>
                <p>
                  <strong className="text-foreground">Market context:</strong>{" "}
                  use KDOT crashes and storm exposure as watchlists, then
                  confirm current conditions.
                </p>
                <p>
                  <strong className="text-foreground">Limits:</strong> this
                  pilot predicts shop repair demand, not individual crashes or
                  insurer claim volume.
                </p>
              </div>

              <details className="rounded-lg border border-border p-4">
                <summary className="cursor-pointer font-heading font-semibold text-foreground">
                  Definitions, sources, privacy, and limits
                </summary>
                <dl className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <dt className="font-heading font-semibold text-foreground">
                      Repair arrivals
                    </dt>
                    <dd className="mt-1">
                      Accepted FileMaker repair records for the confirmed shop,
                      grouped into Monday-start weeks by arrival date. A repair
                      is counted once in the reconciled source snapshot.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-heading font-semibold text-foreground">
                      Insurance-paid
                    </dt>
                    <dd className="mt-1">
                      Derived only from explicit FileMaker pay-type categories.
                      Unknown values remain in total repairs but are never
                      guessed as insured work or insurer claim volume.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-heading font-semibold text-foreground">
                      Repair value and cycle time
                    </dt>
                    <dd className="mt-1">
                      Repair value sums source repair dollars. Cycle time is
                      completion date minus arrival date and averages only rows
                      with valid observations.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-heading font-semibold text-foreground">
                      Insurer, ZIP, vehicle, and season
                    </dt>
                    <dd className="mt-1">
                      PII-free aggregates from the loaded repair snapshot.
                      Insurer names are normalized and human-reviewed; ZIPs are
                      reduced to five digits; seasons compare complete years.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-heading font-semibold text-foreground">
                      Weather and ZIP alerts
                    </dt>
                    <dd className="mt-1">
                      NOAA storm exposure is weighted by historical repairs in
                      customer ZIPs. The 72-hour queue uses preliminary SPC
                      reports and NWS severe thresholds. Same-day reports are
                      grouped by ZIP and event type, with the peak measurement
                      shown; each group is a review signal, not proof of damage
                      or a claim.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-heading font-semibold text-foreground">
                      Crash context
                    </dt>
                    <dd className="mt-1">
                      Official KDOT crashes cover qualifying Kansas customer
                      ZIPs and exclude the current partial month. Outside that
                      coverage, official NHTSA FARS provides state-level 2024
                      fatal-crash context only; it is not total crashes or claim
                      volume. Missing coverage is shown as unavailable, never as
                      zero crashes.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-heading font-semibold text-foreground">
                      Four-week forecast
                    </dt>
                    <dd className="mt-1">
                      Predicts weekly shop repair arrivals. Each horizon must
                      beat its seasonal historical MAE before approval and
                      carries an 80% operating interval. Publication pauses when
                      the shop&apos;s latest arrival is more than 14 days old.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-heading font-semibold text-foreground">
                      Privacy and freshness
                    </dt>
                    <dd className="mt-1">
                      Stored facts exclude names, street addresses, email,
                      phone, birthdates, claim numbers, raw repair-order
                      numbers, and raw serials. The source snapshot is stale
                      after 36 hours; shop-arrival freshness is tracked
                      separately.
                    </dd>
                  </div>
                </dl>
              </details>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {detail ? (
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InsightListCard({
  title,
  caption,
  items,
}: {
  title: string;
  caption: string;
  items: Array<{ label: string; detail: string; value: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{caption}</p>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ol className="divide-y divide-border">
            {items.map((item) => (
              <li
                key={item.label}
                className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div>
                  <p className="font-heading font-medium capitalize">
                    {item.label}
                  </p>
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold">
                  {item.value}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No mapped data yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
