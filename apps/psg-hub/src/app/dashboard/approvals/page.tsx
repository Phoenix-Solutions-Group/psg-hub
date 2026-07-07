import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { ApprovalCard, type ApprovalCardRow } from "@/components/dashboard/approval-card";

// PSG-245 / Wave 2 (G-d) — per-shop approval queue. Lists the active shop's
// pending agent-proposed actions for an owner/manager to approve (→ publish) or
// reject. Read via the RLS-respecting server client: the SELECT policy on
// approval_queue (shop_id IN user_shop_ids()) is the tenant-isolation boundary —
// a user only ever sees their own shops' rows. Decisions run through the gated
// /api/approvals/[id]/{approve,reject,retry} routes.
//
// PSG-768 (B3/A1): also surface `publish_failed` rows so a failed publish is
// never silently dropped — it stays in the queue with a Retry across reloads. And
// select payload_jsonb so the card can preview the EXACT text that will publish.

/** Best-effort extraction of the exact text that will publish, from the action's
 *  payload, so the confirm-step preview matches what posts. Falls back to null
 *  (the card then shows the human summary) for shapes we don't recognise. */
function extractPreviewBody(actionType: string, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v : null;

  switch (actionType) {
    case "gbp_post":
      // The GBP local post body — exactly what posts to the public page.
      return str(p.summary);
    case "content":
      return str(p.body) ?? str(p.content) ?? str(p.summary);
    case "review_solicitation": {
      const draft = (p.draft ?? {}) as Record<string, unknown>;
      const email = (draft.email ?? {}) as Record<string, unknown>;
      const sms = (draft.sms ?? {}) as Record<string, unknown>;
      return str(email.text) ?? str(sms.body) ?? null;
    }
    default:
      return str(p.summary) ?? str(p.body);
  }
}

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let queue: ApprovalCardRow[] = [];
  let recentCount = 0;

  if (user) {
    const { activeShopId } = await getActiveShopContext(user.id);
    if (activeShopId) {
      const { data } = await supabase
        .from("approval_queue")
        .select(
          "id, action_type, title, summary, status, proposed_by, created_at, payload_jsonb, publish_error"
        )
        .eq("shop_id", activeShopId)
        .in("status", ["pending", "publish_failed"])
        .order("created_at", { ascending: false });

      queue = (data ?? []).map((r) => ({
        id: r.id as string,
        actionType: r.action_type as string,
        title: r.title as string,
        summary: (r.summary as string | null) ?? null,
        status: r.status as string,
        proposedBy: (r.proposed_by as string | null) ?? null,
        createdAt: r.created_at as string,
        previewBody: extractPreviewBody(r.action_type as string, r.payload_jsonb),
        publishError: (r.publish_error as string | null) ?? null,
      }));

      // publish_failed rows are surfaced as actionable (retry) above, so they are
      // NOT counted here as "already reviewed" — only settled outcomes are.
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
          Review agent-proposed actions before they go live. You&apos;ll see the exact
          post and confirm before anything reaches the public page.
        </p>
        {recentCount > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {recentCount} already reviewed.
          </p>
        )}
      </div>

      {queue.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing waiting for review. Proposed actions will appear here for approval.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((row) => (
            <ApprovalCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
