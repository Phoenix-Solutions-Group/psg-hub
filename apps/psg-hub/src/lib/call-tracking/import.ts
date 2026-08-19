import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CallTrackingProvider = "callrail" | "whatconverts" | "other";

export type CallTrackingImportRecord = {
  shopId: string;
  provider: CallTrackingProvider;
  providerCallId?: string | null;
  providerAccountId?: string | null;
  startedAt: string;
  durationSeconds?: number | null;
  source?: string | null;
  campaign?: string | null;
  qualified?: boolean | null;
  trackingNumber?: string | null;
};

export type CallTrackingInsertRow = {
  shop_id: string;
  provider: CallTrackingProvider;
  provider_call_id: string | null;
  provider_account_id: string | null;
  idempotency_key: string;
  call_started_at: string;
  duration_seconds: number | null;
  source: string | null;
  campaign: string | null;
  qualified: boolean | null;
  tracking_number: string | null;
};

export type CallTrackingSummaryRow = {
  shopId: string;
  date: string;
  source: string;
  campaign: string;
  totalCalls: number;
  qualifiedCalls: number;
};

type CsvRow = Record<string, string | null | undefined>;

const TABLE = "call_tracking_calls";

function clean(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function pick(row: CsvRow, names: string[]): string | null {
  const normalized = new Map<string, string | null>();
  for (const [key, value] of Object.entries(row)) {
    normalized.set(key.toLowerCase().replace(/[^a-z0-9]/g, ""), clean(value));
  }
  for (const name of names) {
    const v = normalized.get(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (v) return v;
  }
  return null;
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function parseQualified(value: string | null): boolean | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (["true", "yes", "y", "qualified", "1", "lead"].includes(v)) return true;
  if (["false", "no", "n", "unqualified", "0", "not a lead"].includes(v)) return false;
  return null;
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

function stableKey(record: CallTrackingImportRecord): string {
  const providerId = clean(record.providerCallId);
  if (providerId) return providerId;

  const parts = [
    record.shopId,
    record.provider,
    record.startedAt,
    record.providerAccountId ?? "",
    record.trackingNumber ?? "",
    record.durationSeconds ?? "",
    record.source ?? "",
    record.campaign ?? "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function toCallTrackingInsertRow(
  record: CallTrackingImportRecord,
): CallTrackingInsertRow {
  const startedAt = clean(record.startedAt);
  if (!startedAt || Number.isNaN(Date.parse(startedAt))) {
    throw new Error("Call tracking import row is missing a valid call start date/time");
  }

  return {
    shop_id: record.shopId,
    provider: record.provider,
    provider_call_id: clean(record.providerCallId),
    provider_account_id: clean(record.providerAccountId),
    idempotency_key: stableKey(record),
    call_started_at: startedAt,
    duration_seconds: record.durationSeconds ?? null,
    source: clean(record.source),
    campaign: clean(record.campaign),
    qualified: record.qualified ?? null,
    tracking_number: normalizePhone(clean(record.trackingNumber)),
  };
}

export function mapCallRailRow(shopId: string, row: CsvRow): CallTrackingInsertRow {
  return toCallTrackingInsertRow({
    shopId,
    provider: "callrail",
    providerCallId: pick(row, ["Call ID", "ID", "call_id"]),
    providerAccountId: pick(row, ["Account ID", "Company ID", "company_id"]),
    startedAt:
      pick(row, ["Start Time", "Call Start Time", "Date/Time", "Created At"]) ?? "",
    durationSeconds: parseNumber(pick(row, ["Duration", "Duration (seconds)", "duration"])),
    source: pick(row, ["Source", "Source Name", "Referring Source"]),
    campaign: pick(row, ["Campaign", "Campaign Name", "utm_campaign"]),
    qualified: parseQualified(pick(row, ["Qualified", "Lead Status", "Value"])),
    trackingNumber: pick(row, ["Tracking Number", "Tracking Phone Number"]),
  });
}

export function mapWhatConvertsRow(shopId: string, row: CsvRow): CallTrackingInsertRow {
  return toCallTrackingInsertRow({
    shopId,
    provider: "whatconverts",
    providerCallId: pick(row, ["Lead ID", "lead_id", "ID"]),
    providerAccountId: pick(row, ["Account ID", "Profile ID", "profile_id"]),
    startedAt: pick(row, ["Date", "Date/Time", "Created", "Created At"]) ?? "",
    durationSeconds: parseNumber(pick(row, ["Call Duration", "Duration", "Duration Seconds"])),
    source: pick(row, ["Source", "Marketing Source", "Lead Source"]),
    campaign: pick(row, ["Campaign", "Campaign Name"]),
    qualified: parseQualified(pick(row, ["Quotable", "Qualified", "Lead Status"])),
    trackingNumber: pick(row, ["Tracking Number", "Tracking Phone Number"]),
  });
}

export function summarizeCallTrackingRows(
  rows: readonly CallTrackingInsertRow[],
): CallTrackingSummaryRow[] {
  const groups = new Map<string, CallTrackingSummaryRow>();
  for (const row of rows) {
    const date = row.call_started_at.slice(0, 10);
    const source = row.source ?? "Unknown";
    const campaign = row.campaign ?? "Unknown";
    const key = `${row.shop_id}|${date}|${source}|${campaign}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        shopId: row.shop_id,
        date,
        source,
        campaign,
        totalCalls: 0,
        qualifiedCalls: 0,
      };
      groups.set(key, group);
    }
    group.totalCalls += 1;
    if (row.qualified === true) group.qualifiedCalls += 1;
  }
  return Array.from(groups.values()).sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.source.localeCompare(b.source) ||
      a.campaign.localeCompare(b.campaign),
  );
}

export async function upsertCallTrackingCalls(
  service: SupabaseClient,
  rows: CallTrackingInsertRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await service
    .from(TABLE)
    .upsert(rows, {
      onConflict: "shop_id,provider,idempotency_key",
      ignoreDuplicates: false,
    });
  if (error) throw new Error(`upsertCallTrackingCalls failed: ${error.message}`);
  return rows.length;
}
