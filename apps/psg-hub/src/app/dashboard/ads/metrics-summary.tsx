"use client";

import { Card } from "@/components/ui/card";
import {
  formatMicrosAsUsd,
  readMetrics,
} from "@/lib/ads/campaigns-client";

type Campaign = {
  id: string;
  status: "paused" | "enabled" | "removed";
  metrics?: unknown;
};

type Props = { campaigns: Campaign[] };

export function MetricsSummary({ campaigns }: Props) {
  const enabled = campaigns.filter((c) => c.status === "enabled");

  if (enabled.length === 0) {
    return (
      <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        No enabled campaigns — metrics appear after enable + sync.
      </div>
    );
  }

  const totals = enabled.reduce(
    (acc, c) => {
      const m = readMetrics(c);
      acc.impressions += m.impressions;
      acc.clicks += m.clicks;
      acc.cost_micros += m.cost_micros;
      acc.conversions += m.conversions;
      return acc;
    },
    { impressions: 0, clicks: 0, cost_micros: 0, conversions: 0 }
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Impressions" value={totals.impressions.toLocaleString()} />
      <StatCard label="Clicks" value={totals.clicks.toLocaleString()} />
      <StatCard label="Spend (30d)" value={formatMicrosAsUsd(totals.cost_micros)} />
      <StatCard label="Conversions" value={totals.conversions.toLocaleString()} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
}
