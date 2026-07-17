import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { upsertSnapshots } from "@/lib/analytics/snapshots";
import type { AnalyticsSnapshotInsert, GoogleAdsMetrics } from "@/lib/analytics/types";
import { sanitizeLastError } from "./sanitize";

const IMPORT_SOURCE = "google_ads_import";

const metricValue = z.union([z.number(), z.string(), z.null()]).optional();

const importRowSchema = z
  .object({
    shop_id: z.string().uuid(),
    date: z.string().trim().min(1),
    spend: metricValue,
    cost: metricValue,
    clicks: metricValue,
    impressions: metricValue,
    conversions: metricValue,
    leads: metricValue,
    cost_per_lead: metricValue,
    cpl: metricValue,
    data_freshness: z.string().trim().min(1).optional(),
    data_freshness_at: z.string().trim().min(1).optional(),
  })
  .passthrough();

export const googleAdsImportPayloadSchema = z.object({
  idempotency_key: z.string().trim().min(8).max(160),
  imported_at: z.string().datetime().optional(),
  rows: z.array(importRowSchema).min(1),
});

export type GoogleAdsImportPayload = z.infer<typeof googleAdsImportPayloadSchema>;
export type GoogleAdsImportInput = z.input<typeof googleAdsImportPayloadSchema>;

export type GoogleAdsImportSummary = {
  idempotencyKey: string;
  duplicate: boolean;
  rowsReceived: number;
  rowsWritten: number;
  rowsSkipped: number;
};

type ImportLedger = { id: string } | null;

type ImportMetricRow = {
  shop_id: string;
  date: string;
  spend?: string | number | null;
  cost?: string | number | null;
  clicks?: string | number | null;
  impressions?: string | number | null;
  conversions?: string | number | null;
  leads?: string | number | null;
  cost_per_lead?: string | number | null;
  cpl?: string | number | null;
  data_freshness?: string;
  data_freshness_at?: string;
};

export function buildGoogleAdsImportRows(
  rawPayload: GoogleAdsImportInput | unknown
): {
  idempotencyKey: string;
  rowsReceived: number;
  rowsSkipped: number;
  snapshots: AnalyticsSnapshotInsert[];
} {
  const payload = googleAdsImportPayloadSchema.parse(rawPayload);
  const snapshots: AnalyticsSnapshotInsert[] = [];
  let rowsSkipped = 0;

  for (const row of payload.rows) {
    const snapshot = parseImportRow(row);
    if (snapshot) {
      snapshots.push(snapshot);
    } else {
      rowsSkipped += 1;
    }
  }

  return {
    idempotencyKey: payload.idempotency_key,
    rowsReceived: payload.rows.length,
    rowsSkipped,
    snapshots,
  };
}

export async function importGoogleAdsMetricsFallback(
  service: SupabaseClient,
  rawPayload: unknown,
  options: { importedByProfileId?: string | null } = {}
): Promise<GoogleAdsImportSummary> {
  const rows = buildGoogleAdsImportRows(rawPayload);

  const existing = await findImportBatch(service, rows.idempotencyKey);
  if (existing?.status === "success") {
    return {
      idempotencyKey: rows.idempotencyKey,
      duplicate: true,
      rowsReceived: rows.rowsReceived,
      rowsWritten: Number(existing.rows_written ?? 0),
      rowsSkipped: rows.rowsReceived,
    };
  }

  const ledger = await openImportBatch(service, {
    idempotencyKey: rows.idempotencyKey,
    importedByProfileId: options.importedByProfileId ?? null,
    rowsReceived: rows.rowsReceived,
    rowsSkipped: rows.rowsSkipped,
  });

  try {
    const rowsWritten = await upsertSnapshots(service, rows.snapshots);
    await closeImportBatch(service, ledger, {
      status: "success",
      rowsWritten,
      rowsSkipped: rows.rowsSkipped,
    });
    return {
      idempotencyKey: rows.idempotencyKey,
      duplicate: false,
      rowsReceived: rows.rowsReceived,
      rowsWritten,
      rowsSkipped: rows.rowsSkipped,
    };
  } catch (error) {
    await closeImportBatch(service, ledger, {
      status: "error",
      rowsWritten: 0,
      rowsSkipped: rows.rowsSkipped,
      error: sanitizeLastError(error instanceof Error ? error.message : String(error)),
    });
    throw error;
  }
}

function parseImportRow(row: ImportMetricRow): AnalyticsSnapshotInsert | null {
  const spend = parseNumber(row.spend ?? row.cost);
  const clicks = parseNumber(row.clicks);
  const impressions = parseNumber(row.impressions);
  const conversions = parseNumber(row.conversions ?? row.leads);
  const providedCpl = parseNumber(row.cost_per_lead ?? row.cpl);
  const date = normalizeDate(row.date);

  if (!date || spend === null || clicks === null || impressions === null || conversions === null) {
    return null;
  }

  const cpl =
    providedCpl ??
    (conversions > 0 ? roundCurrency(spend / conversions) : null);
  const costMicros = Math.round(spend * 1_000_000);
  const metrics: GoogleAdsMetrics & {
    leads: number;
    data_freshness_at: string | null;
    import_source: typeof IMPORT_SOURCE;
  } = {
    spend: roundCurrency(spend),
    clicks: Math.round(clicks),
    impressions: Math.round(impressions),
    conversions,
    leads: conversions,
    cpl,
    cost_micros: costMicros,
    data_freshness_at: row.data_freshness_at ?? row.data_freshness ?? null,
    import_source: IMPORT_SOURCE,
  };

  return {
    shop_id: row.shop_id,
    source: "google_ads",
    period: "daily",
    date,
    metrics,
  };
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[$,%\s]/g, "").replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

async function findImportBatch(
  service: SupabaseClient,
  idempotencyKey: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await service
    .from("google_ads_import_batches")
    .select("id,status,rows_written,rows_skipped")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error(`google_ads_import_batches read failed: ${error.message}`);
  }
  return (data as Record<string, unknown> | null) ?? null;
}

async function openImportBatch(
  service: SupabaseClient,
  input: {
    idempotencyKey: string;
    importedByProfileId: string | null;
    rowsReceived: number;
    rowsSkipped: number;
  }
): Promise<ImportLedger> {
  const { data, error } = await service
    .from("google_ads_import_batches")
    .upsert(
      {
        idempotency_key: input.idempotencyKey,
        source: IMPORT_SOURCE,
        status: "running",
        rows_received: input.rowsReceived,
        rows_written: 0,
        rows_skipped: input.rowsSkipped,
        error: null,
        imported_by_profile_id: input.importedByProfileId,
        imported_at: new Date().toISOString(),
        finished_at: null,
      },
      { onConflict: "idempotency_key" }
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`google_ads_import_batches open failed: ${error?.message ?? "no row"}`);
  }
  return { id: data.id as string };
}

async function closeImportBatch(
  service: SupabaseClient,
  ledger: ImportLedger,
  patch: {
    status: "success" | "error";
    rowsWritten: number;
    rowsSkipped: number;
    error?: string;
  }
): Promise<void> {
  if (!ledger) return;
  const { error } = await service
    .from("google_ads_import_batches")
    .update({
      status: patch.status,
      rows_written: patch.rowsWritten,
      rows_skipped: patch.rowsSkipped,
      error: patch.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", ledger.id);
  if (error) {
    throw new Error(`google_ads_import_batches close failed: ${error.message}`);
  }
}
