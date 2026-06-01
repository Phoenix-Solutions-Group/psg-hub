"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatMicrosAsUsd,
  readMetrics,
  type CampaignStatus,
} from "@/lib/ads/campaigns-client";

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  daily_budget_micros: number;
  metrics?: unknown;
  metrics_synced_at?: string | null;
};

type Props = {
  campaigns: Campaign[];
  onRowClick: (c: Campaign) => void;
  softCap?: number;
};

function statusBadge(s: CampaignStatus) {
  if (s === "enabled")
    return <Badge className="bg-green-100 text-green-800">Enabled</Badge>;
  if (s === "paused") return <Badge variant="secondary">Paused</Badge>;
  return <Badge className="bg-muted text-muted-foreground">Removed</Badge>;
}

export function CampaignsTable({ campaigns, onRowClick, softCap = 50 }: Props) {
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Budget / day</TableHead>
            <TableHead>Impressions</TableHead>
            <TableHead>Clicks</TableHead>
            <TableHead>Spend</TableHead>
            <TableHead>Conversions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.map((c) => {
            const m = readMetrics(c);
            return (
              <TableRow
                key={c.id}
                tabIndex={0}
                onClick={() => onRowClick(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(c);
                  }
                }}
                className="cursor-pointer focus-visible:bg-accent"
              >
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{statusBadge(c.status)}</TableCell>
                <TableCell>{formatMicrosAsUsd(c.daily_budget_micros)}</TableCell>
                <TableCell>{m.impressions.toLocaleString()}</TableCell>
                <TableCell>{m.clicks.toLocaleString()}</TableCell>
                <TableCell>{formatMicrosAsUsd(m.cost_micros)}</TableCell>
                <TableCell>{m.conversions.toLocaleString()}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {campaigns.length >= softCap && (
        <p className="text-xs text-muted-foreground">
          Showing first {softCap} — contact support if you need more.
        </p>
      )}
    </div>
  );
}
