import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { SitemapStudio, type SitemapShopOption } from "@/components/ops/sitemap-studio";

// Wave 1A / PSG-258 — Sitemap & Content Architecture ops surface (page).
// Makes the gated sitemap pipeline (PSG-225 engine + PSG-236 adapters) reachable behind the
// superadmin gate. Superadmin-only to MATCH the API route's gate (requireSuperadmin) — the run
// is metered, G5-gated, and persists a client deliverable, so it sits at psg_superadmin, not a
// per-capability flag. The page lists the shops to run for and hands them to the client Studio,
// which drives the POST /api/ops/sitemap route + its two human checkpoints.
//
// runtime=nodejs: getOpsAccess + the shop listing both use the server-only service client.
export const runtime = "nodejs";

/** All shops, resolved to display names (any shop can have a sitemap built). */
async function listShops(): Promise<SitemapShopOption[]> {
  const service = createServiceClient();
  const { data, error } = await service.from("shops").select("id, name");
  if (error) throw new Error(`listShops: shops read failed: ${error.message}`);
  return (data ?? [])
    .map((s) => ({ id: s.id as string, name: (s.name as string) ?? "" }))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export default async function SitemapStudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Sitemap &amp; Content Architecture</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  const shops = await listShops();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Sitemap &amp; Content Architecture
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a shop and run its sitemap pipeline — keyword universe, baseline audit, SERP
          clustering, site architecture, and a content calendar, all gated by two human sign-offs
          before the client deliverable is produced.
        </p>
      </div>
      <SitemapStudio shops={shops} />
    </div>
  );
}
