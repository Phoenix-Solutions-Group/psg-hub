// PSG-594 — Self-serve Sales Pipeline review screen (board access to open-pipeline-$).
// Read-only superadmin surface that renders the finished Pipedrive open-pipeline export
// for a human: open-deal count + total open-pipeline $, the S0–S8 per-stage breakdown,
// the DISTINCT won/booked reconciled line (kept visually separate — never folded into the
// open totals), a last-synced freshness line, and a Download CSV button (reuses the
// export lib's CSV output). All values come straight from buildDealsExport (PSG-446); this
// page NEVER recomputes forecast math.
//
// Gating: view_sales_pipeline capability (psg_superadmin passes implicitly). RLS on the
// mirror tables is the authoritative backstop. Pre go-live (PSG-592) the tables may be
// absent/empty → we render an "awaiting first sync" state instead of failing.
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { loadSalesPipeline } from "@/lib/pipedrive/sales-pipeline-server";
import {
  formatCount,
  formatMoney,
  formatSyncedAgo,
} from "@/lib/pipedrive/view";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";
export const metadata = { title: "Sales Pipeline · PSG" };

export default async function SalesPipelinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = user ? await getOpsAccess(user.id) : null;
  // Fail closed — a non-authorized user must not learn this surface exists.
  if (!access || !hasOpsFn(access, "view_sales_pipeline")) notFound();

  const now = new Date();
  const { view, dataError } = await loadSalesPipeline(supabase, now);

  const currency = view?.currency ?? "USD";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Sales Pipeline
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Live view of our open sales pipeline from Pipedrive — how many deals are
            in play and what they&apos;re worth, broken down by stage. Won deals are
            shown as a separate line so they&apos;re never counted as open pipeline.
          </p>
        </div>
        <a
          href="/api/ops/sales-pipeline?format=csv"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Download CSV
        </a>
      </div>

      {/* Freshness line. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Last synced:{" "}
          <span className="font-medium text-foreground">
            {formatSyncedAgo(view?.freshness.lastSyncedAt ?? null, now)}
          </span>
        </span>
        {view?.freshness.totalDeals != null && (
          <span>· {formatCount(view.freshness.totalDeals)} deals mirrored</span>
        )}
        {view?.freshness.ok === false && (
          <Badge variant="destructive">Last sync failed</Badge>
        )}
      </div>

      {(dataError || !view) && (
        <Card>
          <CardHeader>
            <CardTitle>Awaiting first sync</CardTitle>
            <CardDescription>
              The Pipedrive pipeline data hasn&apos;t landed yet. Once the deals-sync
              go-live completes, real numbers appear here automatically — nothing else
              to do.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {view && (
        <>
          {/* Open-pipeline headline stats. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Open deals"
              value={formatCount(view.openDealCount)}
              hint="Deals still in play"
            />
            <StatCard
              label="Total open pipeline"
              value={formatMoney(view.totalOpenPipeline, currency)}
              hint="Best case — full value of all open deals"
            />
            <StatCard
              label="Weighted (expected)"
              value={formatMoney(view.weightedValue, currency)}
              hint="Value adjusted for each deal's win chance"
            />
            <StatCard
              label="Committed"
              value={formatMoney(view.committedValue, currency)}
              hint={`Near-certain deals (${formatCount(
                view.committedDealCount,
              )} at contract stage)`}
            />
          </div>

          {/* Per-stage S0–S8 breakdown. */}
          <Card>
            <CardHeader>
              <CardTitle>By stage (S0–S8)</CardTitle>
              <CardDescription>
                Open deals grouped by where they are in the sales process.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Deals</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Win %</TableHead>
                    <TableHead className="text-right">Weighted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.perStage.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-sm text-muted-foreground"
                      >
                        No open deals.
                      </TableCell>
                    </TableRow>
                  )}
                  {view.perStage.map((s) => (
                    <TableRow key={`${s.stageId ?? "none"}-${s.stageName ?? ""}`}>
                      <TableCell className="font-medium">
                        {s.stageName ?? "Unstaged"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(s.count)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(s.value, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.probabilityPct}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(s.weightedValue, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Won/booked DISTINCT reconciled line — kept visually separate. */}
          <Card size="sm" className="border-l-4 border-l-ember">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Won / booked
                <Badge variant="secondary">Separate from open pipeline</Badge>
              </CardTitle>
              <CardDescription>
                Deals already closed-won in the reconcile window (
                {view.wonBooked.window.start} to {view.wonBooked.window.end}). Shown for
                context only — <span className="font-medium">not</span> part of the open
                totals above.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatInline
                label="Won deals"
                value={formatCount(view.wonBooked.count)}
              />
              <StatInline
                label="Won total"
                value={formatMoney(view.wonBooked.total, currency)}
              />
              <StatInline
                label="Recurring (monthly)"
                value={formatMoney(view.wonBooked.recurringMonthlyTotal, currency)}
              />
              <StatInline
                label="One-time"
                value={formatMoney(view.wonBooked.oneTime, currency)}
              />
            </CardContent>
            {view.wonBooked.unknownCount > 0 && (
              <CardContent className="pt-0 text-xs text-muted-foreground">
                {formatCount(view.wonBooked.unknownCount)} won deal
                {view.wonBooked.unknownCount === 1 ? "" : "s"} (
                {formatMoney(view.wonBooked.unknown, currency)}) still need a
                recurring/one-time label before final reconciliation.
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function StatInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-heading text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
