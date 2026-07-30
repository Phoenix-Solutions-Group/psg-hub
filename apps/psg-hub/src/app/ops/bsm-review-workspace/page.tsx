import { redirect } from "next/navigation";
import { ReviewWorkspaceConsole } from "@/app/ops/bsm-review-workspace/review-workspace-console";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { bsmReviewWorkspaceInternalEnabled } from "@/lib/bsm/review-workspace";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function normalizeCompanyShops(rows: Array<{ shop_id: unknown; name: unknown }>) {
  const shopsById = new Map<string, { id: string; name: string }>();

  for (const row of rows) {
    if (typeof row.shop_id !== "string" || !row.shop_id.trim()) continue;
    const id = row.shop_id;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id;
    const existing = shopsById.get(id);
    if (!existing || existing.name === id) {
      shopsById.set(id, { id, name });
    }
  }

  return [...shopsById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export default async function BsmReviewWorkspacePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_bsm_content_approvals")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">BSM Review Workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant access to manage BSM review workspaces.
        </p>
      </div>
    );
  }

  if (!bsmReviewWorkspaceInternalEnabled()) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">BSM Review Workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This internal QA surface is disabled in this environment.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const { data: shopRows } = await service
    .from("companies")
    .select("shop_id, name")
    .eq("status", "active")
    .not("shop_id", "is", null)
    .order("name", { ascending: true })
    .limit(500);
  const shops = normalizeCompanyShops(shopRows ?? []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="border-b border-border pb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">BSM Review Workspace</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Create and inspect private review projects for QA. This page does not send customer
          email or publish public links.
        </p>
      </section>

      {shops.length ? (
        <ReviewWorkspaceConsole shops={shops} defaultShopId={shops[0]?.id ?? null} />
      ) : (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
          No QA shop is available in this environment.
        </div>
      )}
    </div>
  );
}
