import { redirect } from "next/navigation";
import { BsmContentApprovalManager, type BsmContentApprovalReviewerContact } from "@/components/ops/bsm-content-approval-manager";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import {
  listBsmContentApprovals,
  listBsmContentApprovalReviewerContacts,
  listBsmContentApprovalWorkspaces,
} from "@/lib/bsm/content-approvals";
import type { BsmContentApprovalListItem, BsmContentApprovalWorkspaceOption } from "@/lib/bsm/content-approvals-shared";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { filterCleanDemoShops } from "@/lib/ops/demo-user-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BsmContentApprovalsPageProps = {
  searchParams: Promise<{ shopId?: string; workspaceId?: string }>;
};

function companyBackedShopOptions(
  companyRows: Array<{ shop_id: unknown; name: unknown }>
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
  return [...shops, { id: shopId, name: shopId }].sort((a, b) => a.name.localeCompare(b.name));
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

  try {
    const { data, error } = await service
      .from("companies")
      .select("shop_id, name")
      .eq("status", "active")
      .not("shop_id", "is", null)
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw error;
    shops = companyBackedShopOptions(data ?? []);
    const requestedWorkspace = workspaces.find((workspace) => workspace.id === requestedWorkspaceId);
    const requestedWorkspaceShopId = requestedWorkspace?.shopId ?? null;
    shops = ensureShopOption(shops, requestedWorkspaceShopId ?? requestedShopId);
    shops = filterCleanDemoShops(shops, user.email);
    shops = ensureShopOption(shops, requestedWorkspaceShopId ?? requestedShopId);
    activeShopId =
      shops.find((shop) => shop.id === requestedWorkspaceShopId)?.id ??
      shops.find((shop) => shop.id === requestedShopId)?.id ??
      shops[0]?.id ??
      null;
  } catch {
    loadError = true;
    shops = [];
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">Client collaboration</p>
        <h1 className="mt-1 font-heading text-3xl font-semibold tracking-tight text-[#142838]">
          Review Workspace
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Upload proofs, invite clients, collect precise feedback, and keep every approval together.
        </p>
      </section>

      {loadError ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
          The current file library could not be loaded. New uploads can still be attempted.
        </div>
      ) : null}

      <section>
        <BsmContentApprovalManager
          initialApprovals={approvals}
          workspaces={workspaces}
          shops={shops}
          reviewerContacts={reviewerContacts}
          activeShopId={activeShopId}
          activeWorkspaceProjectId={requestedWorkspaceId ?? null}
          canManageWorkspaces={access.role === "psg_superadmin"}
        />
      </section>
    </div>
  );
}
