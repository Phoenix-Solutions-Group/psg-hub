import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import Link from "next/link";
import { ApprovalCard, type ApprovalCardRow } from "@/components/dashboard/approval-card";
import {
  ApprovedContentArchiveTable,
  type ApprovedContentArchiveRow,
} from "@/components/dashboard/approved-content-archive-table";
import { listApprovedContentArchiveRows } from "@/lib/bsm/approved-content-archive";

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
  let bsmContentReviews: Array<{
    id: string;
    title: string;
    status: string;
    content_type: string;
    admin_context_note: string | null;
    updated_at: string;
  }> = [];
  let recentCount = 0;
  let approvedArchive: ApprovedContentArchiveRow[] = [];

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

      const { data: reviewItems } = await supabase
        .from("bsm_content_review_items")
        .select("id, title, status, content_type, admin_context_note, updated_at")
        .eq("shop_id", activeShopId)
        .in("status", ["draft", "sent", "in_review", "updates_requested"])
        .order("updated_at", { ascending: false });
      bsmContentReviews = (reviewItems ?? []) as typeof bsmContentReviews;

      approvedArchive = await listApprovedContentArchiveRows(supabase, activeShopId);
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

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Content Review</h2>
          <p className="text-sm text-muted-foreground">
            Review BSM files and generated pages before PSG uses or publishes them.
          </p>
        </div>
        {bsmContentReviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">No BSM content is waiting for review.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bsmContentReviews.map((item) => (
              <Link
                key={item.id}
                href={`/dashboard/approvals/content/${item.id}`}
                className="block rounded-lg border border-border p-4 hover:border-ember"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-heading font-semibold">{item.title}</h3>
                    {item.admin_context_note && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {item.admin_context_note}
                      </p>
                    )}
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                    {item.status.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.content_type.replace(/_/g, " ")} · updated{" "}
                  {new Date(item.updated_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Approved Content Archive</h2>
          <p className="text-sm text-muted-foreground">
            Approved files and generated pages are kept here for reference and audit.
          </p>
        </div>
        <ApprovedContentArchiveTable rows={approvedArchive} />
      </section>
    </div>
  );
}
