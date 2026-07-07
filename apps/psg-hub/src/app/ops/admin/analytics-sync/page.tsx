import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { AnalyticsSyncPanel } from "@/components/ops/analytics-sync-panel";

// PSG-645: superadmin "Sync now" surface. Lets an operator trigger the analytics ingest
// syncs and/or the monthly-report generator on demand (POST /api/ops/admin/analytics/
// sync) instead of waiting for the daily/monthly Vercel crons. Superadmin-only — matches
// the route's requireSuperadmin gate.

export default async function AnalyticsSyncAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Sync now</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <a href="/ops/admin" className="text-sm text-muted-foreground hover:text-ember">
          ← Superadmin
        </a>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">Sync now</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trigger analytics data syncs and monthly reports on demand. Each run uses the same
          jobs the scheduled crons run and is recorded to the analytics sync ledger.
        </p>
      </div>

      <AnalyticsSyncPanel />
    </div>
  );
}
