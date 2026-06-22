import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { CompetitorIntel, type IntelShopOption } from "@/components/ops/competitor-intel";

// v1.6 / PSG-210 — Competitor Intelligence ops surface (page).
// Makes the backend-complete competitor report (PSG-177/PSG-179) reachable without a
// hand-typed URL. Superadmin-only to MATCH the API route's gate (requireSuperadmin) — the
// report is the metered, G5-gated intel surface, so it sits at psg_superadmin, not a
// per-capability flag. The page only lists the shops that actually have scored competitors
// (so the picker is never a dead dropdown) and hands them to the client Studio, which calls
// the existing /api/ops/intel/competitor-report route to render the report inline.
//
// runtime=nodejs: getOpsAccess + the shop listing both use the server-only service client.
export const runtime = "nodejs";

/**
 * Shops that have at least one scored competitor, resolved to display names. RLS on
 * competitor_scores / shops is service-role-only (default-deny), matching the report
 * route's read path — the page is the superadmin-gated caller.
 */
async function listScoredShops(): Promise<IntelShopOption[]> {
  const service = createServiceClient();

  const { data: scoreRows, error } = await service
    .from("competitor_scores")
    .select("shop_id");
  if (error) {
    throw new Error(`listScoredShops: competitor_scores read failed: ${error.message}`);
  }

  const shopIds = [...new Set((scoreRows ?? []).map((r) => r.shop_id as string))];
  if (shopIds.length === 0) return [];

  const { data: shops } = await service
    .from("shops")
    .select("id, name")
    .in("id", shopIds);

  return (shops ?? [])
    .map((s) => ({ id: s.id as string, name: (s.name as string) ?? "" }))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export default async function CompetitorIntelPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Competitor Intel</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  const shops = await listScoredShops();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Competitor Intel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a shop and run its competitor intelligence report — the ranked competitor set,
          threat scoring, and a grounded market narrative. The narrative is metered (a paid model)
          and spend-cap-gated; the deterministic score table always renders.
        </p>
      </div>
      <CompetitorIntel shops={shops} />
    </div>
  );
}
