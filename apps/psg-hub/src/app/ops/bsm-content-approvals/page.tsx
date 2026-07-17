import { redirect } from "next/navigation";
import { BsmContentApprovalManager } from "@/components/ops/bsm-content-approval-manager";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { listBsmContentApprovals } from "@/lib/bsm/content-approvals";
import type { BsmContentApprovalListItem } from "@/lib/bsm/content-approvals-shared";
import { getActiveShopContext } from "@/lib/shop/context";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mergeShopOptions(
  shopRows: Array<{ id: unknown; name: unknown }>,
  fallbackShops: Array<{ id: string; name: string }>
): Array<{ id: string; name: string }> {
  const shopsById = new Map<string, { id: string; name: string }>();

  for (const shop of fallbackShops) {
    shopsById.set(shop.id, { id: shop.id, name: shop.name || shop.id });
  }

  for (const row of shopRows) {
    if (typeof row.id !== "string") continue;
    shopsById.set(row.id, {
      id: row.id,
      name:
        typeof row.name === "string" && row.name.trim()
          ? row.name
          : shopsById.get(row.id)?.name ?? row.id,
    });
  }

  return [...shopsById.values()].sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id)
  );
}

export default async function BsmContentApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_bsm_content_approvals")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">BSM Content Approvals</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant access to manage BSM content approvals.
        </p>
      </div>
    );
  }

  let approvals: BsmContentApprovalListItem[] = [];
  let shops: Array<{ id: string; name: string }> = [];
  let activeShopId: string | null = null;
  let loadError = false;
  const service = createServiceClient();

  try {
    approvals = await listBsmContentApprovals(service);
  } catch {
    loadError = true;
  }

  let contextShops: Array<{ id: string; name: string }> = [];
  try {
    const shopContext = await getActiveShopContext(user.id);
    activeShopId = shopContext.activeShopId;
    contextShops = shopContext.shops;
  } catch {
    loadError = true;
  }

  try {
    const { data, error } = await service
      .from("shops")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw error;
    shops = mergeShopOptions(data ?? [], contextShops);
  } catch {
    loadError = true;
    shops = mergeShopOptions([], contextShops);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="border-b border-border pb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          BSM Content Approvals
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Attach a customer review file or generated page, add the note that explains what the
          customer should review, and track comments, decisions, and requested updates from the
          shared approval record.
        </p>
      </section>

      {loadError ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
          The current file library could not be loaded. New uploads can still be attempted.
        </div>
      ) : null}

      <BsmContentApprovalManager
        initialApprovals={approvals}
        shops={shops}
        activeShopId={activeShopId}
      />
    </div>
  );
}
