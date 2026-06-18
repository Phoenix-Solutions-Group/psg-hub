// v1.4 / PSG-28 — /ops/reports index. Lists all 26 (+1) named operational
// reports grouped by batch. Server component: the parent /ops layout gates the
// shell to staff; here we additionally require the manage_reports capability.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { BATCHES } from "@/lib/ops/reports/types";
import { REPORTS, reportsForBatch } from "@/lib/ops/reports/registry";

export const runtime = "nodejs";
export const metadata = { title: "Operational Reports · PSG" };

export default async function OpsReportsIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = user ? await getOpsAccess(user.id) : null;
  if (!access || !hasOpsFn(access, "manage_reports")) notFound();

  const pending = REPORTS.filter((r) => r.dataStatus === "pending-data").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Operational Reports
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {REPORTS.length} named reports across {BATCHES.length} batches. Each is
          parameterized by date range + filters and exports to CSV, Excel and PDF.
        </p>
        {pending > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Sample data</Badge> {pending} report
            {pending === 1 ? "" : "s"} are running on illustrative sample data
            until the ops data foundation (companies / ROs / surveys) lands.
          </p>
        )}
      </div>

      {BATCHES.map((batch) => {
        const reports = reportsForBatch(batch.id);
        return (
          <section key={batch.id} className="space-y-3">
            <h2 className="font-heading text-sm font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {batch.label}{" "}
              <span className="text-muted-foreground/60">({reports.length})</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {reports.map((r) => (
                <Link key={r.slug} href={`/ops/reports/${r.slug}`} className="block">
                  <Card size="sm" className="h-full transition-colors hover:border-primary">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between gap-2">
                        <span>{r.title}</span>
                        {r.dataStatus === "pending-data" && (
                          <Badge variant="outline" className="shrink-0">
                            Sample
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>{r.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      {r.params.dateRange ? "Date range" : "Snapshot"}
                      {r.params.filters.length > 0 &&
                        ` · ${r.params.filters.length} filter${
                          r.params.filters.length === 1 ? "" : "s"
                        }`}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
