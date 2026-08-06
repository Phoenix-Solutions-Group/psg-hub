import type { DirectMailMetrics, DirectMailPieceSummary } from "@/lib/analytics/direct-mail";
import { formatNumber, formatShortDate } from "@/lib/analytics/aggregate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Home, Mail, Megaphone, TrendingUp, Users, type LucideIcon } from "lucide-react";

type DirectMailPanelProps = {
  metrics: DirectMailMetrics;
  scopeLabel: string;
};

export function DirectMailPanel({ metrics, scopeLabel }: DirectMailPanelProps) {
  const hasActivity = metrics.activity.lettersMailed > 0;
  const hasResults = metrics.results.status === "ready";
  const resultStatus = getResultStatus(metrics);
  const topPiece =
    metrics.results.bestPerformingPiece ?? metrics.activity.piecesByType[0] ?? null;

  return (
    <section aria-labelledby="direct-mail-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="direct-mail-heading"
            className="font-heading text-lg font-semibold tracking-tight"
          >
            Direct mail
          </h2>
          <p className="text-sm text-muted-foreground">
            Letters PSG mailed for {scopeLabel}, plus marketing reach signals when enough
            history is available.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 font-heading text-xs font-medium",
              resultStatus.className
            )}
          >
            {resultStatus.label}
          </span>
          <span className="text-muted-foreground">{formatLastUpdated(metrics)}</span>
        </div>
      </div>

      {!hasActivity && !hasResults ? (
        <Card>
          <CardHeader>
            <CardTitle>No direct-mail data imported yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Direct-mail activity and customer reach will appear here after PSG imports
              send history for this shop.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-heading text-sm font-medium text-muted-foreground">
                    Direct-mail reach
                  </p>
                  <p className="mt-2 text-4xl font-bold tracking-tight">
                    {formatNumber(metrics.activity.lettersMailedMonthToDate)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    letters mailed this month
                  </p>
                </div>
                <div className="rounded-full border border-border bg-muted/50 p-3 text-primary">
                  <Mail className="h-5 w-5" aria-hidden="true" />
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <SummaryStat
                  label="This year"
                  value={formatNumber(metrics.activity.lettersMailedYearToDate)}
                />
                <SummaryStat
                  label="Lifetime"
                  value={formatNumber(metrics.activity.lettersMailedLifetime)}
                />
                <SummaryStat
                  label="Est. people reached"
                  value={formatNumber(metrics.activity.estimatedReferralReach.monthToDate)}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/25 p-4">
              <p className="font-heading text-sm font-medium text-muted-foreground">
                Strongest signal
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tight">
                {topPiece ? formatPieceLabel(topPiece) : "Building history"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {hasResults
                  ? `${formatNumber(
                      metrics.results.responsesOrOutcomes
                    )} response signals across mailed pieces`
                  : metrics.results.message ?? "Results appear after enough mailed history"}
              </p>
              <div className="mt-4">
                <BarMeter
                  label="Response signal rate"
                  value={
                    metrics.results.responseRate === null
                      ? "Building history"
                      : formatPercent(metrics.results.responseRate)
                  }
                  percent={
                    metrics.results.responseRate === null
                      ? 0
                      : clampPercent(metrics.results.responseRate)
                  }
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={Mail}
              label="Letters mailed this month"
              value={formatNumber(metrics.activity.lettersMailedMonthToDate)}
              detail={
                metrics.activity.latestSentDate
                  ? `Latest send ${formatShortDate(metrics.activity.latestSentDate)}`
                  : "No send date available"
              }
            />
            <KpiCard
              icon={Megaphone}
              label="Letters mailed this year"
              value={formatNumber(metrics.activity.lettersMailedYearToDate)}
              detail={`${formatNumber(
                metrics.activity.estimatedReferralReach.yearToDate
              )} estimated people reached`}
            />
            <KpiCard
              icon={TrendingUp}
              label="Letters mailed lifetime"
              value={formatNumber(metrics.activity.lettersMailedLifetime)}
              detail={`${formatNumber(
                metrics.activity.estimatedReferralReach.lifetime
              )} estimated people reached`}
            />
            <KpiCard
              icon={Users}
              label="Estimated referral reach"
              value={formatNumber(metrics.activity.estimatedReferralReach.monthToDate)}
              detail="Estimate: each mailed letter leads to 3 people hearing about it"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={Home}
              label="Households reached"
              value={
                metrics.activity.householdsReached === null
                  ? "Waiting on history"
                  : formatNumber(metrics.activity.householdsReached)
              }
              detail="Counts households, not individual people"
            />
            <KpiCard
              icon={Users}
              label="Customer response signals"
              value={
                hasResults
                  ? formatNumber(metrics.results.responsesOrOutcomes)
                  : "Building history"
              }
              detail={metrics.results.message ?? "Repeat visits, referrals, and survey replies"}
            />
            <KpiCard
              icon={TrendingUp}
              label="Response signal rate"
              value={
                metrics.results.responseRate === null
                  ? "Building history"
                  : formatPercent(metrics.results.responseRate)
              }
              detail={
                metrics.results.bestPerformingPiece
                  ? `Best-performing letter: ${formatPieceLabel(metrics.results.bestPerformingPiece)}`
                  : "Best-performing letter appears after enough history"
              }
            />
            <KpiCard
              icon={TrendingUp}
              label="Post-repair sales share"
              value={
                metrics.postRepairSalesShare.share === null
                  ? "Not available yet"
                  : formatPercent(metrics.postRepairSalesShare.share)
              }
              detail={formatSalesShareDetail(metrics)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Letters by campaign type</CardTitle>
              </CardHeader>
              <CardContent>
                {metrics.activity.piecesByType.length === 0 ? (
                  <p className="text-muted-foreground">
                    Campaign type details will appear after send history is imported.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {metrics.activity.piecesByType.slice(0, 8).map((piece) => (
                      <BarMeter
                        key={`${piece.pieceCode}:${piece.variant ?? ""}`}
                        label={formatPieceLabel(piece)}
                        value={`${formatNumber(piece.sent)} mailed`}
                        detail={
                          piece.outcomes > 0
                            ? `${formatNumber(piece.outcomes)} response signals`
                            : "Response signals pending"
                        }
                        percent={shareOfMax(
                          piece.sent,
                          metrics.activity.piecesByType.map((item) => item.sent)
                        )}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Monthly mail-result trend</CardTitle>
              </CardHeader>
              <CardContent>
                {metrics.results.monthlyTrend.length === 0 ? (
                  <p className="text-muted-foreground">
                    Monthly direct-mail trends will appear after PSG imports dated send
                    history for this shop.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {metrics.results.monthlyTrend.slice(0, 6).map((month) => (
                      <BarMeter
                        key={month.month}
                        label={formatMonth(month.month)}
                        value={`${formatNumber(month.mailed)} mailed`}
                        detail={
                          month.outcomeRate === null
                            ? "Results pending"
                            : `${formatPercent(month.outcomeRate)} result rate`
                        }
                        percent={shareOfMax(
                          month.mailed,
                          metrics.results.monthlyTrend.map((item) => item.mailed)
                        )}
                      />
                    ))}
                    {metrics.results.monthlyTrend[0]?.message ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        {metrics.results.monthlyTrend[0].message}
                      </p>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent mail activity</CardTitle>
              </CardHeader>
              <CardContent>
                {metrics.activity.recentSendActivity.length === 0 ? (
                  <p className="text-muted-foreground">
                    Recent mail dates will appear after PSG imports mail activity.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {metrics.activity.recentSendActivity.slice(0, 6).map((day) => (
                      <div
                        key={day.date}
                        className="grid gap-3 border-b pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_7rem]"
                      >
                        <div>
                          <p className="font-heading text-sm font-medium">
                            {formatShortDate(day.date)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {day.pieces.slice(0, 3).map(formatPieceLabel).join(", ")}
                          </p>
                        </div>
                        <p className="text-left text-sm font-medium sm:text-right">
                          {formatNumber(day.sent)} mailed
                        </p>
                        <div className="sm:col-span-2">
                          <MeterBar
                            percent={shareOfMax(
                              day.sent,
                              metrics.activity.recentSendActivity.map((item) => item.sent)
                            )}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {label}
          </CardTitle>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="mt-2 min-h-10 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="font-heading text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function BarMeter({
  label,
  value,
  detail,
  percent,
}: {
  label: string;
  value: string;
  detail?: string;
  percent: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-heading text-sm font-medium">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
      <MeterBar percent={percent} />
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function MeterBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.max(4, percent)}%` }}
      />
    </div>
  );
}

function getResultStatus(metrics: DirectMailMetrics): {
  label: string;
  className: string;
} {
  if (metrics.results.status === "ready") {
    return {
      label: "Results ready",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (metrics.activity.lettersMailed > 0) {
    return {
      label: "Activity live",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  return {
    label: "Waiting on import",
    className: "border-border bg-background text-foreground",
  };
}

function shareOfMax(value: number, values: number[]): number {
  const max = Math.max(...values.filter((item) => Number.isFinite(item)), 0);
  if (max <= 0) return 0;
  return clampPercent(value / max);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value * 100));
}

function formatLastUpdated(metrics: DirectMailMetrics): string {
  const updated =
    metrics.activity.lastUpdatedAt ?? metrics.results.lastUpdatedAt ?? metrics.latestSentDate;
  return updated ? `Last updated ${formatShortDate(updated)}`
    : "Waiting on first update";
}

export function formatPieceLabel(piece: DirectMailPieceSummary): string {
  return piece.variant ? `${piece.label} (${piece.variant})` : piece.label;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${year}-${month}-01T00:00:00Z`));
}

function formatSalesShareDetail(metrics: DirectMailMetrics): string {
  if (metrics.postRepairSalesShare.status !== "ready") {
    return metrics.postRepairSalesShare.message ?? "Waiting on sales inputs";
  }

  return `${formatCurrencyFromCents(
    metrics.postRepairSalesShare.repairSalesCents
  )} post-repair sales from ${formatCurrencyFromCents(
    metrics.postRepairSalesShare.overallShopSalesCents
  )} package sales`;
}

function formatCurrencyFromCents(value: number | null): string {
  if (value === null) return "unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}
