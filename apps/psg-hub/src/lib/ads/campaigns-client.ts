import type { ShopRole } from "@/lib/ads/view-state";

export type ValidateResult = { ok: true } | { ok: false; reason: string };
export type CampaignStatus = "paused" | "enabled" | "removed";

export function validateCampaignCreate(input: {
  name: string;
  dailyBudgetMicros: number;
  maxDailyMicros: number;
}): ValidateResult {
  const n = input.name.trim();
  if (n.length === 0) return { ok: false, reason: "name_empty" };
  if (n.length > 255) return { ok: false, reason: "name_too_long" };
  if (!Number.isFinite(input.dailyBudgetMicros) || input.dailyBudgetMicros <= 0) {
    return { ok: false, reason: "budget_invalid" };
  }
  if (input.dailyBudgetMicros > input.maxDailyMicros) {
    return { ok: false, reason: "budget_over_cap" };
  }
  return { ok: true };
}

export function validateBudgetDelta(
  current: number,
  next: number
): ValidateResult {
  if (!Number.isFinite(next) || next < 0) {
    return { ok: false, reason: "budget_invalid" };
  }
  if (current === 0) return { ok: true };
  const delta = Math.abs(next - current) / current;
  if (delta > 0.5) return { ok: false, reason: "delta_exceeds_50" };
  return { ok: true };
}

export function selectCampaignControls(
  role: ShopRole,
  status: CampaignStatus
): {
  canPause: boolean;
  canEnable: boolean;
  canEditBudget: boolean;
  canDelete: boolean;
} {
  const isOwner = role === "owner";
  const isOwnerOrManager = role === "owner" || role === "manager";
  return {
    canPause: isOwnerOrManager && status === "enabled",
    canEnable: isOwner && status === "paused",
    canEditBudget:
      isOwnerOrManager && (status === "paused" || status === "enabled"),
    canDelete: isOwner && status !== "removed",
  };
}

export function formatMicrosAsUsd(
  micros: number | null | undefined
): string {
  if (micros === null || micros === undefined || !Number.isFinite(micros)) {
    return "$0.00";
  }
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export function dollarsToMicros(
  dollars: number
):
  | { ok: true; micros: number }
  | { ok: false; reason: string } {
  if (!Number.isFinite(dollars)) return { ok: false, reason: "not_finite" };
  if (dollars <= 0) return { ok: false, reason: "non_positive" };
  // Reject more than 2 decimal places
  const cents = dollars * 100;
  if (Math.abs(cents - Math.round(cents)) > 1e-9) {
    return { ok: false, reason: "precision_exceeded" };
  }
  return { ok: true, micros: Math.round(cents) * 10_000 };
}

export function readMetrics(campaign: { metrics?: unknown }): {
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
} {
  const m =
    campaign.metrics && typeof campaign.metrics === "object"
      ? (campaign.metrics as Record<string, unknown>)
      : {};
  function num(v: unknown): number {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }
  return {
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    cost_micros: num(m.cost_micros),
    conversions: num(m.conversions),
  };
}

export function formatSyncErrors(
  errors: Array<{ id: string; code?: string; message?: string }>,
  campaigns: Array<{ id: string; name: string }>,
  maxItems = 2
): string[] {
  const lookup = new Map(campaigns.map((c) => [c.id, c.name]));
  return errors.slice(0, maxItems).map((e) => {
    const name = lookup.get(e.id) ?? `campaign ${e.id.slice(0, 8)}`;
    return `${name}: ${e.message ?? e.code ?? "failed"}`;
  });
}
