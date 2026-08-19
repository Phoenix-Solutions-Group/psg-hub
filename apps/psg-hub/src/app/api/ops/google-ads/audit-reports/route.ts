export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  createGoogleAdsAuditReportId,
  decodePdfBase64,
  uploadGoogleAdsAuditReportPdf,
  type GoogleAdsAuditReportInsert,
} from "@/lib/google-ads/audit-reports";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_RE = /^\d{4}-\d{2}$/;

type PublishPayload = {
  shopId?: unknown;
  title?: unknown;
  periodMonth?: unknown;
  pdfBase64?: unknown;
  originalFilename?: unknown;
  metadata?: unknown;
};

function safeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  if (title.length < 1 || title.length > 160) return null;
  return title;
}

function safeOptionalString(value: unknown, max: number): string | null {
  if (value == null || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireOpsFn("manage_reports");
  if (!gate.ok) return gate.response;

  let payload: PublishPayload;
  try {
    payload = (await request.json()) as PublishPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const shopId = typeof payload.shopId === "string" ? payload.shopId : "";
  const title = safeTitle(payload.title);
  const periodMonth =
    typeof payload.periodMonth === "string" && PERIOD_RE.test(payload.periodMonth)
      ? payload.periodMonth
      : null;

  if (!UUID_RE.test(shopId) || !title || typeof payload.pdfBase64 !== "string") {
    return NextResponse.json(
      { error: "shopId, title, and pdfBase64 are required" },
      { status: 400 }
    );
  }
  if (payload.periodMonth != null && periodMonth === null) {
    return NextResponse.json({ error: "periodMonth must use YYYY-MM" }, { status: 400 });
  }

  let bytes: Uint8Array;
  try {
    bytes = decodePdfBase64(payload.pdfBase64);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid PDF" },
      { status: 400 }
    );
  }

  const reportId = createGoogleAdsAuditReportId();
  const { path } = await uploadGoogleAdsAuditReportPdf(shopId, reportId, bytes);
  const row: GoogleAdsAuditReportInsert = {
    id: reportId,
    shop_id: shopId,
    title,
    period_month: periodMonth,
    storage_path: path,
    original_filename: safeOptionalString(payload.originalFilename, 240),
    content_type: "application/pdf",
    byte_size: bytes.byteLength,
    published_by_profile_id: gate.userId,
    metadata_jsonb: safeMetadata(payload.metadata),
  };

  const service = createServiceClient();
  const { data, error } = await service
    .from("google_ads_optimization_audit_reports")
    .insert(row)
    .select("id, shop_id, title, period_month, storage_path, published_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not publish report" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "google_ads.audit_report.publish",
    targetShopId: shopId,
    payload: {
      reportId,
      periodMonth,
      storagePath: path,
      byteSize: bytes.byteLength,
      title,
    },
  });

  return NextResponse.json({ report: data }, { status: 201 });
}
