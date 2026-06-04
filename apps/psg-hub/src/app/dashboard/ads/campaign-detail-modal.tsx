"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  dollarsToMicros,
  formatMicrosAsUsd,
  readMetrics,
  selectCampaignControls,
  validateBudgetDelta,
  type CampaignStatus,
} from "@/lib/ads/campaigns-client";
import { handleTabTrap } from "@/lib/ads/focus-trap";
import type { ShopRole } from "@/lib/ads/view-state";

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  daily_budget_micros: number;
  metrics?: unknown;
  metrics_synced_at?: string | null;
  updated_at?: string;
};

type Props = {
  campaign: Campaign;
  userRole: ShopRole;
  maxDailyMicros: number;
  onClose: () => void;
};

function relative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

export function CampaignDetailModal({
  campaign,
  userRole,
  maxDailyMicros,
  onClose,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [budgetDollars, setBudgetDollars] = useState(
    (campaign.daily_budget_micros / 1_000_000).toFixed(2)
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const controls = selectCampaignControls(userRole, campaign.status);
  const metrics = readMetrics(campaign);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    firstFocusRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openerRef.current?.focus();
    };
  }, [onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute("disabled"));
    const activeIndex = focusables.indexOf(
      document.activeElement as HTMLElement
    );
    const plan = handleTabTrap(
      { key: e.key, shiftKey: e.shiftKey },
      { activeIndex, count: focusables.length }
    );
    if (plan.prevent && plan.focusIndex !== null) {
      e.preventDefault();
      focusables[plan.focusIndex]?.focus();
    }
  }, []);

  async function putStatus(status: CampaignStatus) {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/ads/google/campaigns/${campaign.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(
          typeof data.error === "string" ? data.error : `Failed (${res.status})`
        );
        return;
      }
      router.refresh();
      onClose();
    });
  }

  async function saveBudget() {
    setMessage(null);
    const d2m = dollarsToMicros(Number(budgetDollars));
    if (!d2m.ok) {
      setMessage(
        d2m.reason === "precision_exceeded"
          ? "Budget must have at most 2 decimal places."
          : "Budget must be a positive number."
      );
      return;
    }
    const delta = validateBudgetDelta(campaign.daily_budget_micros, d2m.micros);
    if (!delta.ok) {
      setMessage("Budget change exceeds ±50% in a 24h window.");
      return;
    }
    if (d2m.micros > maxDailyMicros) {
      setMessage(`Budget exceeds cap (${formatMicrosAsUsd(maxDailyMicros)}).`);
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/ads/google/campaigns/${campaign.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_budget_micros: d2m.micros }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(
          typeof data.error === "string" ? data.error : `Failed (${res.status})`
        );
        return;
      }
      router.refresh();
      onClose();
    });
  }

  async function deleteCampaign() {
    const ok = window.confirm(
      `Delete campaign "${campaign.name}"? The campaign will be marked REMOVED in Google Ads and no longer appear in PSG. This cannot be undone.`
    );
    if (!ok) return;
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/ads/google/campaigns/${campaign.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(
          typeof data.error === "string" ? data.error : `Failed (${res.status})`
        );
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-detail-title"
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-md border bg-background p-6 shadow-lg"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="campaign-detail-title" className="text-lg font-semibold">
              {campaign.name}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-sm">
              <Badge variant="secondary">{campaign.status}</Badge>
              <span className="text-muted-foreground">
                Current budget: {formatMicrosAsUsd(campaign.daily_budget_micros)}/day
              </span>
            </div>
          </div>
          <button
            ref={firstFocusRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border px-2 py-1 text-sm hover:bg-accent"
          >
            Close
          </button>
        </div>

        <div className="mb-4 rounded-md border bg-muted/20 p-3 text-sm">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-xs text-muted-foreground">Impressions</div>
              <div className="font-semibold">{metrics.impressions.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Clicks</div>
              <div className="font-semibold">{metrics.clicks.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Spend</div>
              <div className="font-semibold">{formatMicrosAsUsd(metrics.cost_micros)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Conversions</div>
              <div className="font-semibold">{metrics.conversions.toLocaleString()}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Last sync: {relative(campaign.metrics_synced_at)}
            <button
              type="button"
              onClick={() => router.refresh()}
              className="ml-2 text-primary hover:underline"
            >
              Refresh
            </button>
          </div>
        </div>

        {controls.canEditBudget && (
          <div className="mb-4">
            <label className="text-sm font-medium">Daily budget (USD)</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="1"
                value={budgetDollars}
                onChange={(e) => setBudgetDollars(e.target.value)}
                className="w-40 rounded-md border bg-background p-2 text-sm"
              />
              <Button onClick={saveBudget} disabled={pending}>
                Save budget
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Cap: {formatMicrosAsUsd(maxDailyMicros)}. ±50% max change in 24h.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {controls.canPause && (
            <Button variant="outline" onClick={() => putStatus("paused")} disabled={pending}>
              Pause
            </Button>
          )}
          {controls.canEnable && (
            <Button onClick={() => putStatus("enabled")} disabled={pending}>
              Enable
            </Button>
          )}
          {controls.canDelete && (
            <Button variant="outline" onClick={deleteCampaign} disabled={pending}>
              Delete
            </Button>
          )}
        </div>

        {message && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
