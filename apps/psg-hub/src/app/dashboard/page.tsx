import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getLatestShopAudit } from "@/lib/seo-audit/run";
import {
  buildFirstLoginValueState,
  type FirstLoginValueState,
} from "@/lib/bsm/first-login-value";
import { recordBsmPilotEvent } from "@/lib/bsm/pilot-events";

type DashboardStat = {
  label: string;
  value: number;
  emptyLabel: string;
  helper: string;
};

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
  let firstLoginValue: FirstLoginValueState | null = null;

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
      const [all, pend, pub] = await Promise.all([
        countFor(),
        countFor("pending_review"),
        countFor("published"),
      ]);
      total = all.count ?? 0;
      pendingReview = pend.count ?? 0;
      published = pub.count ?? 0;
      const latestAudit = await getLatestShopAudit(service, activeShopId);
      firstLoginValue = buildFirstLoginValueState(latestAudit?.report ?? null);
      await recordBsmPilotEvent(service, {
        eventName: "first_login_card_viewed",
        shopId: activeShopId,
        userId: user.id,
        properties: { state: firstLoginValue.status },
      });
    } else {
      firstLoginValue = buildFirstLoginValueState(null);
    }
  }

  const stats: DashboardStat[] = [
    {
      label: "Content Items",
      value: total,
      emptyLabel: "Not started yet",
      helper: "Drafts will appear after BSM has enough shop signals to create them.",
    },
    {
      label: "Pending Review",
      value: pendingReview,
      emptyLabel: "None waiting",
      helper: "New content will land here for approval before anything is published.",
    },
    {
      label: "Published",
      value: published,
      emptyLabel: "Nothing live yet",
      helper: "Approved work will show here after it has been published.",
    },
  ];

  const displayName = user?.email?.split("@")[0] ?? "there";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome, {displayName}.
        </p>
      </div>

      {firstLoginValue && (
        <Card>
          <CardHeader>
            <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
              {firstLoginValue.eyebrow}
            </p>
            <CardTitle>{firstLoginValue.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {firstLoginValue.detail}
            </p>
            <Link
              className={buttonVariants()}
              href={firstLoginValue.nextStepHref}
            >
              {firstLoginValue.nextStepLabel}
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((s) => {
          const isEmpty = s.value === 0;
          return (
            <Card key={s.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {s.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-2xl font-bold">
                  {isEmpty ? s.emptyLabel : s.value}
                </p>
                {isEmpty && (
                  <p className="text-sm leading-5 text-muted-foreground">
                    {s.helper}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
