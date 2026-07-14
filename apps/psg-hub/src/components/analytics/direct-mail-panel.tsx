import type { DirectMailMetrics, DirectMailPieceSummary } from "@/lib/analytics/direct-mail";
import { formatNumber, formatShortDate } from "@/lib/analytics/aggregate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DirectMailPanelProps = {
  metrics: DirectMailMetrics;
  scopeLabel: string;
};

export function DirectMailPanel({ metrics, scopeLabel }: DirectMailPanelProps) {
  const hasActivity = metrics.activity.lettersMailed > 0;
  const hasResults = metrics.results.status === "ready";

  return (
    <section aria-labelledby="direct-mail-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
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
        <p className="text-sm text-muted-foreground">{formatLastUpdated(metrics)}</p>
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Letters mailed this month"
              value={formatNumber(metrics.activity.lettersMailedMonthToDate)}
              detail={
                metrics.activity.latestSentDate
                  ? `Latest send ${formatShortDate(metrics.activity.latestSentDate)}`
                  : "No send date available"
              }
            />
            <KpiCard
              label="Letters mailed this year"
              value={formatNumber(metrics.activity.lettersMailedYearToDate)}
              detail={`${formatNumber(
                metrics.activity.estimatedReferralReach.yearToDate
              )} estimated people reached`}
            />
            <KpiCard
              label="Letters mailed lifetime"
              value={formatNumber(metrics.activity.lettersMailedLifetime)}
              detail={`${formatNumber(
                metrics.activity.estimatedReferralReach.lifetime
              )} estimated people reached`}
            />
            <KpiCard
              label="Estimated referral reach"
              value={formatNumber(metrics.activity.estimatedReferralReach.monthToDate)}
              detail="Estimate: each mailed letter leads to 3 people hearing about it"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Households reached"
              value={
                metrics.activity.householdsReached === null
                  ? "Waiting on history"
                  : formatNumber(metrics.activity.householdsReached)
              }
              detail="Counts households, not individual people"
            />
            <KpiCard
              label="Customer response signals"
              value={
                hasResults
                  ? formatNumber(metrics.results.responsesOrOutcomes)
                  : "Building history"
              }
              detail={metrics.results.message ?? "Repeat visits, referrals, and survey replies"}
            />
            <KpiCard
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b text-muted-foreground">
                        <tr>
                          <th className="py-2 pr-3 font-heading font-medium">Piece</th>
                          <th className="py-2 pr-3 text-right font-heading font-medium">
                            Mailed
                          </th>
                          <th className="py-2 text-right font-heading font-medium">
                            Response signals
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {metrics.activity.piecesByType.slice(0, 8).map((piece) => (
                          <tr key={`${piece.pieceCode}:${piece.variant ?? ""}`}>
                            <td className="py-2 pr-3">{formatPieceLabel(piece)}</td>
                            <td className="py-2 pr-3 text-right">
                              {formatNumber(piece.sent)}
                            </td>
                            <td className="py-2 text-right">
                              {piece.outcomes > 0 ? formatNumber(piece.outcomes) : "n/a"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
                        className="flex items-start justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0"
                      >
                        <div>
                          <p className="font-heading text-sm font-medium">
                            {formatShortDate(day.date)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {day.pieces.slice(0, 3).map(formatPieceLabel).join(", ")}
                          </p>
                        </div>
                        <p className="text-right text-sm font-medium">
                          {formatNumber(day.sent)} mailed
                        </p>
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
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
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
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
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
