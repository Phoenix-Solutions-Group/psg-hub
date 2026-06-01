"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MetricsSummary } from "./metrics-summary";
import { SyncButton } from "./sync-button";
import { CampaignsTable, type Campaign } from "./campaigns-table";
import { CreateCampaignModal } from "./create-campaign-modal";
import { CampaignDetailModal } from "./campaign-detail-modal";
import type { ShopRole } from "@/lib/ads/view-state";

type Props = {
  shopId: string;
  shopName: string;
  userRole: ShopRole;
  campaigns: Campaign[];
  maxDailyMicros: number;
};

export function CampaignsSection({
  shopId,
  shopName,
  userRole,
  campaigns,
  maxDailyMicros,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<Campaign | null>(null);

  const canCreate = userRole === "owner" || userRole === "manager";

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Campaigns</h2>
        <div className="flex gap-2">
          <SyncButton
            shopId={shopId}
            campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
          />
          {canCreate && (
            <Button onClick={() => setShowCreate(true)}>
              Create campaign
            </Button>
          )}
        </div>
      </div>

      <MetricsSummary campaigns={campaigns} />

      {campaigns.length === 0 ? (
        <div className="rounded-md border p-8">
          <p className="text-sm text-muted-foreground">
            No campaigns yet.
          </p>
          {canCreate && (
            <div className="mt-4">
              <Button onClick={() => setShowCreate(true)}>
                Create your first campaign
              </Button>
            </div>
          )}
        </div>
      ) : (
        <CampaignsTable campaigns={campaigns} onRowClick={setDetail} />
      )}

      {showCreate && (
        <CreateCampaignModal
          shopId={shopId}
          shopName={shopName}
          maxDailyMicros={maxDailyMicros}
          onClose={() => setShowCreate(false)}
        />
      )}

      {detail && (
        <CampaignDetailModal
          campaign={detail}
          userRole={userRole}
          maxDailyMicros={maxDailyMicros}
          onClose={() => setDetail(null)}
        />
      )}
    </section>
  );
}
