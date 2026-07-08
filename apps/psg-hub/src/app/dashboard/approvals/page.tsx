import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { ApprovalCard, type ApprovalCardRow } from "@/components/dashboard/approval-card";

// PSG-245 / Wave 2 (G-d) — per-shop approval queue. Lists the active shop's
// pending agent-proposed actions for an owner/manager to preview, confirm, then
// publish or reject. Failed publishes stay visible for retry. Read via the
// RLS-respecting server client: the SELECT policy on
// approval_queue (shop_id IN user_shop_ids()) is the tenant-isolation boundary —
// a user only ever sees their own shops' rows. Decisions run through the gated
// /api/approvals/[id]/{approve,reject} routes.
export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let pending: ApprovalCardRow[] = [];
  let recentCount = 0;

  if (user) {
    const { activeShopId } = await getActiveShopContext(user.id);
    if (activeShopId) {
      const { data } = await supabase
        .from("approval_queue")
        .select(
          "id, action_type, title, summary, payload_jsonb, status, proposed_by, created_at, publish_error"
        )
        .eq("shop_id", activeShopId)
        .in("status", ["pending", "publish_failed"])
        .order("created_at", { ascending: false });

      pending = (data ?? []).map((r) => ({
        id: r.id as string,
        actionType: r.action_type as string,
        title: r.title as string,
        summary: (r.summary as string | null) ?? null,
        payload: (r.payload_jsonb as Record<string, unknown> | null) ?? {},
        status: r.status as string,
        proposedBy: (r.proposed_by as string | null) ?? null,
        createdAt: r.created_at as string,
        publishError: (r.publish_error as string | null) ?? null,
      }));

      const { count } = await supabase
        .from("approval_queue")
        .select("*", { count: "exact", head: true })
        .eq("shop_id", activeShopId)
        .in("status", ["approved", "rejected", "published"]);
      recentCount = count ?? 0;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
        <p className="text-muted-foreground">
          Review agent-proposed actions before they go live. You will see the
          exact post and confirm before anything publishes publicly.
        </p>
        {recentCount > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {recentCount} already reviewed.
          </p>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing waiting for review. Proposed actions will appear here for approval.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((row) => (
            <ApprovalCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
