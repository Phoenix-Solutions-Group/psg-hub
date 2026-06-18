// v1.4 / PSG-28 — Operational Reports API: run + export endpoint.
// GET /api/ops/reports/{slug}?start=&end=&<filters>&format=json|csv|xls
// Gated by the manage_reports ops capability (PSG-25 ops-access; RLS is the
// authoritative backstop). format=json (default) returns the runner result for
// the UI; csv/xls stream a downloadable export.
//
// runtime=nodejs: requireOpsFn -> getOpsAccess uses the server-only service client.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { getReport } from "@/lib/ops/reports/registry";
import { parseReportParams } from "@/lib/ops/reports/params";
import { runReport } from "@/lib/ops/reports/runner";
import {
  EXPORT_CONTENT_TYPES,
  exportFilename,
  toCSV,
  toSpreadsheetXml,
} from "@/lib/ops/reports/export";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const gate = await requireOpsFn("manage_reports");
  if (!gate.ok) return gate.response;

  const { slug } = await params;
  const def = getReport(slug);
  if (!def) {
    return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  }

  const search = request.nextUrl.searchParams;
  const parsed = parseReportParams(def, search);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "Invalid parameters", details: parsed.errors },
      { status: 400 },
    );
  }

  // Per-shop scoping for psg_internal is applied by each report's live run()
  // when its backing data lands (it reads memberships then); superadmins span
  // all shops. Today every report is sample-backed, so scope is unused -> null.
  const result = await runReport(def, parsed.params, {
    db: def.dataStatus === "available" ? createServiceClient() : null,
    shopIds: null,
    generatedAt: new Date().toISOString(),
  });

  const format = (search.get("format") ?? "json").toLowerCase();

  if (format === "csv") {
    return new NextResponse(toCSV(result), {
      status: 200,
      headers: {
        "Content-Type": EXPORT_CONTENT_TYPES.csv,
        "Content-Disposition": `attachment; filename="${exportFilename(
          slug,
          "csv",
          parsed.params.start,
          parsed.params.end,
        )}"`,
      },
    });
  }

  if (format === "xls" || format === "excel" || format === "xlsx") {
    return new NextResponse(toSpreadsheetXml(result, def.title), {
      status: 200,
      headers: {
        "Content-Type": EXPORT_CONTENT_TYPES.xls,
        "Content-Disposition": `attachment; filename="${exportFilename(
          slug,
          "xls",
          parsed.params.start,
          parsed.params.end,
        )}"`,
      },
    });
  }

  return NextResponse.json({
    slug: def.slug,
    title: def.title,
    batch: def.batch,
    dataStatus: def.dataStatus,
    params: parsed.params,
    ...result,
  });
}
