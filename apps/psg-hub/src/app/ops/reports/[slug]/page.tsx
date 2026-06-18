// v1.4 / PSG-28 — single operational report runner page (server component,
// gated by the layout). Resolves the definition and hands a serializable
// metadata subset to the client runner, which drives params + export via the
// shared API.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ReportRunner } from "@/components/ops/report-runner";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { getReport } from "@/lib/ops/reports/registry";

export const runtime = "nodejs";

/** First and last day of the previous calendar month, as YYYY-MM-DD. */
function lastFullMonth(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = user ? await getOpsAccess(user.id) : null;
  if (!access || !hasOpsFn(access, "manage_reports")) notFound();

  const { slug } = await params;
  const def = getReport(slug);
  if (!def) notFound();

  const { start, end } = lastFullMonth();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/ops/reports"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← All reports
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {def.title}
          </h1>
          {def.dataStatus === "pending-data" && (
            <Badge variant="secondary">Sample data</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{def.description}</p>
      </div>

      <ReportRunner
        slug={def.slug}
        hasDateRange={def.params.dateRange}
        filters={def.params.filters}
        columns={def.columns}
        defaultStart={start}
        defaultEnd={end}
        sample={def.dataStatus === "pending-data"}
      />
    </div>
  );
}
