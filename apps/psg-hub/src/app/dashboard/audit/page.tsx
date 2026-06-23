// Wave 1C / PSG-227 — Baseline SEO audit page (the onboarding deliverable surface).
//
// Server component: resolves the caller's active shop, loads the latest persisted
// audit (if any) so the card shows it without a re-run, and mounts the interactive
// card. The audit itself runs through POST /api/onboarding/audit (membership-gated).

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { getLatestShopAudit } from "@/lib/seo-audit/run";
import { SeoAuditCard } from "@/components/dashboard/seo-audit-card";

export default async function SeoAuditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initial: Parameters<typeof SeoAuditCard>[0]["initial"] = null;
  if (user) {
    const { activeShopId } = await getActiveShopContext(user.id);
    if (activeShopId) {
      const latest = await getLatestShopAudit(createServiceClient(), activeShopId);
      if (latest) {
        initial = {
          mode: latest.report.mode,
          healthScore: latest.report.healthScore,
          grade: latest.report.grade,
          summary: latest.report.summary,
          generatedAt: latest.generatedAt,
        };
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">SEO audit</h1>
        <p className="text-muted-foreground">
          Your website&apos;s baseline SEO health — run it now, re-run it any time.
        </p>
      </div>
      <SeoAuditCard initial={initial} />
    </div>
  );
}
