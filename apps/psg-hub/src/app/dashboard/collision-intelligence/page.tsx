import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChartCard, LineChartCard } from "@/components/analytics/charts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCollisionDashboard } from "@/lib/collision-intelligence/dashboard";
import { getActiveShopContext } from "@/lib/shop/context";
import { createClient } from "@/lib/supabase/server";

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

function formatDate(value: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export default async function CollisionIntelligencePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { activeShopId } = await getActiveShopContext(user.id);
  if (!activeShopId) redirect("/dashboard");

  const dashboard = await getCollisionDashboard(activeShopId);
  const { summary, baseline, operationalForecast, operationalForecasts } =
    dashboard;

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
        <Link
          href="/dashboard/analytics"
          className="rounded-md border border-border px-3 py-2 font-heading text-sm font-medium transition-colors hover:bg-secondary"
        >
          Marketing analytics
        </Link>
      </div>

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
                  ; repair arrivals end {formatDate(summary.latestWeek)};
                  weather extends through{" "}
                  {formatDate(dashboard.weather.latestMonth)}; completed-month
                  KDOT crashes extend through{" "}
                  {formatDate(dashboard.crashes.latestMonth)}.
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
                    ? "Repair feed current"
                    : "Repair feed stale"}
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
              detail={`${summary.insuredRepairOrders.toLocaleString()} repair orders`}
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
                detail: `${market.insuredRepairOrders.toLocaleString()} insurance-paid`,
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

          <div className="grid gap-4 lg:grid-cols-2">
            <LineChartCard
              title="Weekly repair arrivals"
              caption="Most recent 52 observed weeks; missing weeks are shown as zero."
              data={dashboard.weeklySeries}
              dataKey="orders"
              xKey="week"
              ariaLabel="Weekly repair-order arrivals over the latest 52 weeks"
            />
            <BarChartCard
              title="Crashes in customer ZIPs"
              caption="Official KDOT crashes across the repair-customer ZIP portfolio; the current partial month is excluded."
              data={dashboard.crashSeries}
              dataKey="crashes"
              xKey="month"
              ariaLabel="Monthly KDOT crashes in repair-customer ZIPs over the latest 12 complete months"
              color="var(--chart-3)"
            />
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

          <Card>
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
              <Badge variant="outline">Notifications off</Badge>
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
                              ? "High signal"
                              : "Review"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {eventTime.format(new Date(alert.eventAt))} ·{" "}
                          {alert.thresholdBasis}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {alert.historicalRepairOrders.toLocaleString()}{" "}
                        historical repair
                        {alert.historicalRepairOrders === 1 ? "" : "s"} from
                        this ZIP
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No preliminary SPC reports matched this customer ZIP portfolio
                  in the last 72 hours.
                </p>
              )}
            </CardContent>
          </Card>

          <section aria-labelledby="forecast-heading" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="forecast-heading" className="text-lg font-semibold">
                  Forecast baseline
                </h2>
                <p className="text-sm text-muted-foreground">
                  Chronological final-year holdout; lower error is better.
                </p>
              </div>
              {baseline?.beatsSeasonal ? (
                <Badge variant="success">
                  {baseline.maeImprovementPct.toFixed(1)}% lower MAE
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
                {operationalForecast?.status === "published" &&
                operationalForecast.predicted !== null ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {operationalForecasts.map((forecast) => (
                      <div
                        key={forecast.horizonWeeks}
                        className="rounded-lg border border-success/30 bg-background/70 p-4"
                      >
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Week {forecast.horizonWeeks} ·{" "}
                          {formatDate(forecast.week)}
                        </p>
                        {forecast.status === "published" &&
                        forecast.predicted !== null ? (
                          <>
                            <p className="mt-2 text-2xl font-bold tracking-tight">
                              {forecast.predicted.toFixed(1)} repairs
                            </p>
                            <p className="mt-1 text-sm text-foreground/75">
                              {forecast.intervalPct}% interval: {forecast.lower}
                              –{forecast.upper}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-sm text-foreground/75">
                            {forecast.reason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <p className="font-heading font-semibold">
                      Publication blocked by data freshness
                    </p>
                    <p className="mt-1 text-sm text-foreground/75">
                      {operationalForecast?.reason ??
                        "No forecast scoring run is available yet."}
                    </p>
                  </div>
                )}
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

            {dashboard.modelEvidence ? (
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle>Model promotion evidence</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Chronological shop holdout plus separate cross-shop
                      interval-policy validation.
                    </p>
                  </div>
                  <Badge variant="success">
                    {dashboard.modelEvidence.status}
                  </Badge>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <MetricCard
                    label="Selected model"
                    value={dashboard.modelEvidence.modelKey.replaceAll(
                      "_",
                      " ",
                    )}
                    detail={`${dashboard.modelEvidence.maeImprovementPct.toFixed(1)}% lower MAE than seasonal`}
                  />
                  <MetricCard
                    label="Holdout MAE"
                    value={dashboard.modelEvidence.modelMae.toFixed(2)}
                    detail={`Seasonal baseline: ${dashboard.modelEvidence.seasonalMae.toFixed(2)}`}
                  />
                  <MetricCard
                    label="Operating interval"
                    value={`±${dashboard.modelEvidence.intervalHalfWidth.toFixed(0)} repairs`}
                    detail={`${dashboard.modelEvidence.validationCoveragePct.toFixed(1)}% held-out-shop coverage after ${dashboard.modelEvidence.intervalMultiplier.toFixed(2)}× widening`}
                  />
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
                  At least 104 weeks of history are required for the seasonal
                  comparison.
                </CardContent>
              </Card>
            )}
          </section>

          <Card>
            <CardHeader>
              <CardTitle>How to use this dashboard</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm text-muted-foreground md:grid-cols-3">
              <p>
                <strong className="text-foreground">Staffing:</strong> use
                weekly arrivals and recent workload for short-range capacity
                conversations.
              </p>
              <p>
                <strong className="text-foreground">Market context:</strong> use
                KDOT crashes and storm exposure as watchlists, then confirm
                current conditions.
              </p>
              <p>
                <strong className="text-foreground">Limits:</strong> this pilot
                predicts repair demand for one shop, not individual crashes or
                insurer claims.
              </p>
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
