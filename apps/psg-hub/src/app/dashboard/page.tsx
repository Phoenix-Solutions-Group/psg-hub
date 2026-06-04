import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    }
  }

  const stats = [
    { label: "Content Items", value: total },
    { label: "Pending Review", value: pendingReview },
    { label: "Published", value: published },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {user?.email?.split("@")[0]}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
