import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { getLatestShopAudit } from "@/lib/seo-audit/run";
import { buildFirstWinCard, type FirstWinAudit } from "@/lib/seo-audit/first-win";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Real content-pipeline counts scoped to the active shop. (The old "Agent Runs"
  // card read a phantom agent_runs table — agents are deferred to v1.6 — and every
  // card was hardcoded 0; both are removed here.) Service-role read scoped by
  // shop_id, mirroring the 07-03 page scoping; activeShopId is already validated
  // against membership by getActiveShopContext.
  let total = 0;
  let pendingReview = 0;
  let published = 0;
  // PSG-767 — the latest SEO audit powers the "first win" card above the metrics,
  // so the owner sees a real result on first load instead of three zeros.
  let audit: FirstWinAudit = null;

  if (user) {
    const { activeShopId } = await getActiveShopContext(user.id);
    if (activeShopId) {
      const service = createServiceClient();
      const countFor = (status?: string) => {
        let q = service
          .from("content_items")
          .select("*", { count: "exact", head: true })
          .eq("shop_id", activeShopId);
        if (status) q = q.eq("status", status);
        return q;
      };
      const [all, pend, pub, latestAudit] = await Promise.all([
        countFor(),
        countFor("pending_review"),
        countFor("published"),
        getLatestShopAudit(service, activeShopId),
      ]);
      total = all.count ?? 0;
      pendingReview = pend.count ?? 0;
      published = pub.count ?? 0;
      if (latestAudit) {
        audit = {
          mode: latestAudit.report.mode,
          healthScore: latestAudit.report.healthScore,
          grade: latestAudit.report.grade,
          summary: latestAudit.report.summary,
        };
      }
    }
  }

  const firstWin = buildFirstWinCard(audit);

  // Honest empties (PSG-767): a zero count reads as PENDING with a plain reason —
  // "—", never a fabricated 0. Real counts show as-is once the pipeline produces work.
  const stats = [
    {
      label: "Content Items",
      value: total,
      pendingReason: "Starts once your content plan runs",
    },
    {
      label: "Pending Review",
      value: pendingReview,
      pendingReason: "Appears when there's a post to approve",
    },
    {
      label: "Published",
      value: published,
      pendingReason: "Counts your posts once they go live",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {user?.email?.split("@")[0]}.
        </p>
      </div>

      {/* First win — the free website health check result, shown above the numbers. */}
      {firstWin.state === "ready" ? (
        <Card className="border-ember bg-ember/5">
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <span className="inline-flex w-fit items-center rounded-full bg-ember px-2.5 py-0.5 text-xs font-medium text-white">
                {firstWin.badge}
              </span>
              <p className="max-w-prose text-sm text-foreground">
                <span className="font-semibold">{firstWin.headline}</span>{" "}
                {firstWin.detail}
              </p>
            </div>
            <Link
              href="/dashboard/audit"
              className={buttonVariants({ variant: "accent" })}
            >
              See my report
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-3 pt-6">
            <span className="inline-flex size-2 shrink-0 animate-pulse rounded-full bg-ember" />
            <p className="text-sm text-muted-foreground">{firstWin.detail}</p>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-sm font-medium text-muted-foreground">
          Your numbers{" "}
          <span className="font-normal">— filling in as data arrives</span>
        </h2>
        <div className="mt-2 grid gap-4 md:grid-cols-3">
          {stats.map((s) => {
            const pending = s.value === 0;
            return (
              <Card key={s.label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {s.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    {pending ? "—" : s.value}
                  </p>
                  {pending && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.pendingReason}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* One obvious next step (PSG-767). */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">
            <span className="font-semibold">Next step:</span> connect your Google
            profile so we can track calls and reviews{" "}
            <span className="text-muted-foreground">(about 2 minutes)</span>.
          </p>
          <Link
            href="/dashboard/analytics"
            className={buttonVariants({ variant: "outline" })}
          >
            Connect
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
