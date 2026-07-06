// PSG-594 — Sales Pipeline export endpoint (board access to open-pipeline-$).
// GET /api/ops/sales-pipeline?format=csv|json
//   • csv  (default) → the finished RFC-4180 export from dealsExportToCSV (reused verbatim);
//   • json           → dealsExportToJSON (the same summary the page renders).
// Gated by the `view_sales_pipeline` ops capability (app-level defense-in-depth); the
// in-DB RLS on pipedrive_deals / pipedrive_sync_runs is the authoritative backstop.
//
// runtime=nodejs: requireOpsFn -> getOpsAccess uses the server-only service client.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createClient } from "@/lib/supabase/server";
import { loadSalesPipeline } from "@/lib/pipedrive/sales-pipeline-server";
import { dealsExportToCSV, dealsExportToJSON } from "@/lib/pipedrive/export";

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("view_sales_pipeline");
  if (!gate.ok) return gate.response;

  // User-scoped client so RLS (view_sales_pipeline) authoritatively gates the mirror read.
  const supabase = await createClient();
  const { export: exp, dataError } = await loadSalesPipeline(supabase, new Date());

  if (!exp) {
    // Pre go-live (PSG-592) the mirror tables may not exist yet.
    return NextResponse.json(
      { error: "Sales pipeline data is not available yet.", detail: dataError },
      { status: 503 },
    );
  }

  const format = (request.nextUrl.searchParams.get("format") ?? "csv").toLowerCase();
  const stamp = exp.generatedAt.slice(0, 10);

  if (format === "json") {
    return NextResponse.json(dealsExportToJSON(exp));
  }

  return new NextResponse(dealsExportToCSV(exp), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-pipeline-${stamp}.csv"`,
    },
  });
}
