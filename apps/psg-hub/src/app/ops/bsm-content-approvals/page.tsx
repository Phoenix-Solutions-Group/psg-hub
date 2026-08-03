import { redirect } from "next/navigation";
import { BsmContentApprovalManager, type BsmContentApprovalReviewerContact } from "@/components/ops/bsm-content-approval-manager";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import {
  listBsmContentApprovals,
  listBsmContentApprovalReviewerContacts,
  listBsmContentApprovalWorkspaces,
} from "@/lib/bsm/content-approvals";
import type { BsmContentApprovalListItem, BsmContentApprovalWorkspaceOption } from "@/lib/bsm/content-approvals-shared";
import { getActiveShopContext } from "@/lib/shop/context";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BsmContentApprovalsPageProps = {
  searchParams: Promise<{ shopId?: string; workspaceId?: string }>;
};

function mergeShopOptions(
  shopRows: Array<{ id: unknown; name: unknown }>,
  fallbackShops: Array<{ id: string; name: string }>,
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
    (a.name || a.id).localeCompare(b.name || b.id),
  );
}

function companyBackedShopOptions(
  companyRows: Array<{ shop_id: unknown; name: unknown }>,
): Array<{ id: string; name: string }> {
  const shopsById = new Map<string, { id: string; name: string }>();

  for (const row of companyRows) {
    if (typeof row.shop_id !== "string") continue;
    const name = typeof row.name === "string" && row.name.trim()
      ? row.name.trim()
      : row.shop_id;
    shopsById.set(row.shop_id, { id: row.shop_id, name });
  }

  return [...shopsById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function ensureShopOption(
  shops: Array<{ id: string; name: string }>,
  shopId: string | null | undefined,
): Array<{ id: string; name: string }> {
  if (!shopId || shops.some((shop) => shop.id === shopId)) return shops;
  return [...shops, { id: shopId, name: shopId }].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export default async function BsmContentApprovalsPage({ searchParams }: BsmContentApprovalsPageProps) {
  const { shopId: requestedShopId, workspaceId: requestedWorkspaceId } = await searchParams;
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
  let workspaces: BsmContentApprovalWorkspaceOption[] = [];
  let reviewerContacts: BsmContentApprovalReviewerContact[] = [];
  let shops: Array<{ id: string; name: string }> = [];
  let activeShopId: string | null = null;
  let loadError = false;
  const service = createServiceClient();

  try {
    approvals = await listBsmContentApprovals(service);
    workspaces = await listBsmContentApprovalWorkspaces(service, { actorProfileId: user.id });
    reviewerContacts = await listBsmContentApprovalReviewerContacts(service);
  } catch {
    loadError = true;
  }

  const requestedWorkspace = workspaces.find((workspace) => workspace.id === requestedWorkspaceId);
  const requestedWorkspaceShopId = requestedWorkspace?.shopId ?? null;

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
      .from("companies")
      .select("shop_id, name")
      .eq("status", "active")
      .not("shop_id", "is", null)
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw error;
    shops = ensureShopOption(
      mergeShopOptions(companyBackedShopOptions(data ?? []), contextShops),
      requestedWorkspaceShopId ?? requestedShopId,
    );
  } catch {
    loadError = true;
    shops = ensureShopOption(mergeShopOptions([], contextShops), requestedWorkspaceShopId ?? requestedShopId);
  }

  activeShopId =
    shops.find((shop) => shop.id === requestedWorkspaceShopId)?.id ??
    shops.find((shop) => shop.id === requestedShopId)?.id ??
    shops.find((shop) => shop.id === activeShopId)?.id ??
    shops[0]?.id ??
    null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="border-b border-border pb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Content Approvals
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Manage each customer approval as a Review Workspace. Create the workspace for one shop,
          add the files or generated pages reviewers need, and track comments, decisions, and
          requested updates from one place.
        </p>
      </section>

      {loadError ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
          The current file library could not be loaded. New uploads can still be attempted.
        </div>
      ) : null}

      <section className="space-y-4 border-t border-border pt-6">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">Documents</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add one or more documents to the selected Review Workspace. A one-document approval is
            still tracked as a workspace so reviewer progress and decisions stay auditable.
          </p>
        </div>
        <BsmContentApprovalManager
          initialApprovals={approvals}
          workspaces={workspaces}
          shops={shops}
          reviewerContacts={reviewerContacts}
          activeShopId={activeShopId}
          activeWorkspaceProjectId={requestedWorkspaceId ?? null}
        />
      </section>
    </div>
  );
}
