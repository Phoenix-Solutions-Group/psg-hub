import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const GOOGLE_ADS_AUDIT_REPORTS_BUCKET = "google-ads-audit-reports";

export type AuditReportStorage = {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array,
      options?: { upsert?: boolean; contentType?: string }
    ): Promise<{ data: unknown; error: { message: string } | null }>;
    download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
  };
};

export type GoogleAdsAuditReportInsert = {
  id: string;
  shop_id: string;
  title: string;
  period_month: string | null;
  storage_path: string;
  original_filename: string | null;
  content_type: "application/pdf";
  byte_size: number;
  published_by_profile_id: string;
  metadata_jsonb: Record<string, unknown>;
};

export function googleAdsAuditReportPdfKey(shopId: string, reportId: string): string {
  return `${shopId}/${reportId}.pdf`;
}

export function createGoogleAdsAuditReportId(): string {
  return randomUUID();
}

export function decodePdfBase64(pdfBase64: string): Uint8Array {
  const normalized = pdfBase64.includes(",") ? pdfBase64.split(",").at(-1) ?? "" : pdfBase64;
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.byteLength === 0) {
    throw new Error("PDF file is empty");
  }
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error("Uploaded file must be a PDF");
  }
  return new Uint8Array(bytes);
}

export async function uploadGoogleAdsAuditReportPdf(
  shopId: string,
  reportId: string,
  bytes: Uint8Array,
  deps: { storage?: AuditReportStorage } = {}
): Promise<{ path: string }> {
  const storage =
    deps.storage ?? (createServiceClient().storage as unknown as AuditReportStorage);
  const path = googleAdsAuditReportPdfKey(shopId, reportId);
  const { error } = await storage.from(GOOGLE_ADS_AUDIT_REPORTS_BUCKET).upload(path, bytes, {
    upsert: false,
    contentType: "application/pdf",
  });
  if (error) {
    throw new Error(`uploadGoogleAdsAuditReportPdf failed: ${error.message}`);
  }
  return { path };
}
