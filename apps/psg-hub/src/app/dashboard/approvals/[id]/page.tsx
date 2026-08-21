import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ApprovalCard, type ApprovalCardRow } from "@/components/dashboard/approval-card";
import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { customerApprovalPreviewPayload } from "@/lib/ops/approval-queue/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QuickApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { shops, activeShopId } = await getActiveShopContext(user.id);
  const activeRole = shops.find((shop) => shop.id === activeShopId)?.role;
  if (!activeShopId || (activeRole !== "owner" && activeRole !== "manager")) {
    notFound();
  }

  const { data } = await supabase
    .from("approval_queue")
    .select(
      "id, action_type, title, summary, payload_jsonb, status, proposed_by, created_at, publish_error"
    )
    .eq("id", id)
    .eq("shop_id", activeShopId)
    .in("status", ["pending", "publish_failed"])
    .maybeSingle();

  if (!data) notFound();

  const row: ApprovalCardRow = {
    id: data.id as string,
    actionType: data.action_type as string,
    title: data.title as string,
    summary: (data.summary as string | null) ?? null,
    payload: customerApprovalPreviewPayload(
      data.action_type as string,
      (data.payload_jsonb as Record<string, unknown> | null) ?? {},
    ),
    status: data.status as string,
    proposedBy: (data.proposed_by as string | null) ?? null,
    createdAt: data.created_at as string,
    publishError: (data.publish_error as string | null) ?? null,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href="/dashboard/approvals"
          className="font-heading text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Back to Review Requests
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Review and decide</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Check the exact content and consequence before you confirm this action.
        </p>
      </div>
      <ApprovalCard row={row} />
    </div>
  );
}
