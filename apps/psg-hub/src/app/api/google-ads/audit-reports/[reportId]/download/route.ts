export const runtime = "nodejs";

import { NextResponse } from "next/server";
import {
  GOOGLE_ADS_AUDIT_REPORTS_BUCKET,
  type AuditReportStorage,
} from "@/lib/google-ads/audit-reports";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReportRow = {
  shop_id: string;
  title: string;
  storage_path: string;
};

function safeFilename(title: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${stem || "google-ads-audit-report"}.pdf`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> }
): Promise<Response> {
  const { reportId } = await params;
  if (!UUID_RE.test(reportId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: report, error: reportError } = await service
    .from("google_ads_optimization_audit_reports")
    .select("shop_id, title, storage_path")
    .eq("id", reportId)
    .maybeSingle();

  if (reportError) {
    return NextResponse.json({ error: "Could not load report" }, { status: 500 });
  }
  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = report as ReportRow;
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", row.shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storage = service.storage as unknown as AuditReportStorage;
  const { data, error } = await storage
    .from(GOOGLE_ADS_AUDIT_REPORTS_BUCKET)
    .download(row.storage_path);

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFilename(row.title)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
