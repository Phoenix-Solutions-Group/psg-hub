import type { DirectMailMetrics, DirectMailPieceSummary } from "@/lib/analytics/direct-mail";
import { formatNumber, formatShortDate } from "@/lib/analytics/aggregate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  Home,
  ImageIcon,
  Info,
  Layers,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Send,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

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
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">
              Direct-mail activity and customer reach will appear here after PSG imports
              send history for this shop.
            </p>
            <PrivacyNote compact />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <SectionHeading icon={Mail} title="Activity" />
            <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_repeat(2,minmax(180px,0.7fr))]">
              <div className="rounded-md bg-primary p-5 text-primary-foreground">
                <div className="flex items-start justify-between gap-4">
                  <div className="rounded-md bg-primary-foreground/10 p-2">
                    <Mail className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <StatusBadge tone="measured">Measured</StatusBadge>
                </div>
                <p className="mt-5 font-heading text-xs font-medium uppercase text-primary-foreground/70">
                  Letters mailed this month
                </p>
                <p className="mt-2 text-4xl font-bold tracking-tight">
                  {formatNumber(metrics.activity.lettersMailedMonthToDate)}
                </p>
                <p className="mt-1 text-sm text-primary-foreground/75">
                  {metrics.activity.latestSentDate
                    ? `Latest send ${formatShortDate(metrics.activity.latestSentDate)}`
                    : "No send date available"}
                </p>
                <MiniActivityBars
                  values={metrics.activity.recentSendActivity.map((item) => item.sent)}
                />
              </div>
              <MetricTile
                icon={CalendarDays}
                badge="Measured"
                label="Letters mailed this year"
                value={formatNumber(metrics.activity.lettersMailedYearToDate)}
                detail={`${formatNumber(
                  metrics.activity.estimatedReferralReach.yearToDate
                )} estimated people reached`}
              />
              <MetricTile
                icon={Layers}
                badge="Measured"
                label="Letters mailed lifetime"
                value={formatNumber(metrics.activity.lettersMailedLifetime)}
                detail={`${formatNumber(
                  metrics.activity.estimatedReferralReach.lifetime
                )} estimated people reached`}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <SectionHeading icon={Users} title="Reach & results" />
            <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                icon={Users}
                badge="Estimate"
                label="Estimated referral reach"
                value={formatNumber(metrics.activity.estimatedReferralReach.monthToDate)}
                detail="Model: each mailed letter leads to 3 people hearing about it"
              />
              <MetricTile
                icon={Home}
                badge="Estimate"
                label="Households reached"
                value={
                  metrics.activity.householdsReached === null
                    ? "Waiting on history"
                    : formatNumber(metrics.activity.householdsReached)
                }
                detail="Counts households, not individual people"
              />
              <MetricTile
                icon={MessageSquare}
                badge={hasResults ? "Measured" : "Pending"}
                label="Customer response signals"
                value={
                  hasResults
                    ? formatNumber(metrics.results.responsesOrOutcomes)
                    : "Building history"
                }
                detail={metrics.results.message ?? "Repeat visits, referrals, and survey replies"}
              />
              <MetricTile
                icon={TrendingUp}
                badge={hasResults ? "Measured" : "Pending"}
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
              <MetricTile
                icon={Wallet}
                badge={
                  metrics.postRepairSalesShare.status === "ready" ? "Measured" : "Pending"
                }
                label="Post-repair sales share"
                value={
                  metrics.postRepairSalesShare.share === null
                    ? "Not available yet"
                    : formatPercent(metrics.postRepairSalesShare.share)
                }
                detail={formatSalesShareDetail(metrics)}
                className="sm:col-span-2 xl:col-span-2"
              />
              <div className="rounded-md border border-border bg-muted/25 p-4 sm:col-span-2">
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
          </div>

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <SectionHeading icon={MapPin} title="Where mail went" />
            <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
              <ServiceAreaView />
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
                          icon={iconForPiece(piece)}
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
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
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

          <div className="grid gap-3 lg:grid-cols-2">
            <InfoCallout />
            <PrivacyNote />
          </div>
        </>
      )}
    </section>
  );
}

function SectionHeading({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-primary">
        {title}
      </h3>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  badge,
  label,
  value,
  detail,
  className,
}: {
  icon: LucideIcon;
  badge: "Measured" | "Estimate" | "Pending";
  label: string;
  value: string;
  detail: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-background p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <StatusBadge tone={badge.toLowerCase() as StatusTone}>{badge}</StatusBadge>
      </div>
      <p className="mt-4 font-heading text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-2 min-h-10 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

type StatusTone = "measured" | "estimate" | "pending";

function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-wide",
        tone === "measured" && "border-primary bg-primary text-primary-foreground",
        tone === "estimate" && "border-border bg-background text-muted-foreground",
        tone === "pending" && "border-amber-200 bg-amber-50 text-amber-700"
      )}
    >
      {children}
    </span>
  );
}

function BarMeter({
  label,
  icon: Icon,
  value,
  detail,
  percent,
}: {
  label: string;
  icon?: LucideIcon;
  value: string;
  detail?: string;
  percent: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 font-heading text-sm font-medium">
          {Icon ? (
            <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-primary">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          ) : null}
          {label}
        </p>
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

function MiniActivityBars({ values }: { values: number[] }) {
  const bars = values.length > 0 ? values.slice(0, 6) : [1, 2, 1, 3, 2, 4];
  const max = Math.max(...bars, 1);
  return (
    <div
      className="mt-4 flex h-6 items-end gap-1"
      aria-label="Recent mailing activity"
      role="img"
    >
      {bars.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="block w-2 rounded-sm bg-primary-foreground/35 last:bg-primary-foreground"
          style={{ height: `${Math.max(6, (value / max) * 24)}px` }}
        />
      ))}
    </div>
  );
}

function ServiceAreaView() {
  return (
    <div className="rounded-md border border-border bg-muted/25 p-4">
      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
        <div
          className="relative my-2 h-56 w-56"
          aria-label="General service-area view, not an exact recipient map"
          role="img"
        >
          <span className="absolute inset-0 rounded-full border border-border bg-primary/5" />
          <span className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-primary/10" />
          <span className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary bg-primary/15" />
          <span className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <MapPin className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
        <p className="font-heading text-sm font-semibold">General service area</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This is a safe, map-like view around the shop. It does not show exact
          recipient locations.
        </p>
      </div>
      <div className="mt-4 space-y-2 text-sm">
        <ServiceAreaLegend dotClassName="bg-primary" label="Core service area" value="Closest repeat-customer radius" />
        <ServiceAreaLegend dotClassName="bg-primary/50" label="Extended reach" value="Nearby communities PSG can monitor" />
        <ServiceAreaLegend dotClassName="bg-border" label="Occasional reach" value="Shown only as grouped context" />
      </div>
    </div>
  );
}

function ServiceAreaLegend({
  dotClassName,
  label,
  value,
}: {
  dotClassName: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border pt-2">
      <span className="flex items-center gap-2 font-medium">
        <span className={cn("h-2 w-2 rounded-full", dotClassName)} />
        {label}
      </span>
      <span className="max-w-[13rem] text-right text-muted-foreground">{value}</span>
    </div>
  );
}

function InfoCallout() {
  return (
    <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="text-sm leading-6">
        <strong className="font-heading font-semibold">Some numbers are estimates.</strong>{" "}
        Reach and household counts use labeled estimates until enough mailed-piece history
        exists for measured results. The service-area view is general because past mail
        history does not include privacy-safe map zones.
      </p>
    </div>
  );
}

function PrivacyNote({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-md border border-border bg-background p-4",
        compact && "p-3"
      )}
    >
      <Lock className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <p className="text-sm leading-6 text-muted-foreground">
        <strong className="font-heading font-semibold text-foreground">Privacy:</strong>{" "}
        This screen shows only grouped counts and general area context. It does not show
        recipient names, exact locations, or raw mailing lists.
      </p>
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

function iconForPiece(piece: DirectMailPieceSummary): LucideIcon {
  const value = `${piece.pieceCode} ${piece.label} ${piece.variant ?? ""}`.toLowerCase();
  if (value.includes("postcard")) return ImageIcon;
  if (value.includes("self") || value.includes("mailer")) return Send;
  return Mail;
}
