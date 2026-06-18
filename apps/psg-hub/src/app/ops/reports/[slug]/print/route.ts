// v1.4 / PSG-28 — print/PDF surface for an operational report.
// Returns a self-contained, print-styled HTML document (own <html>) so it
// bypasses the ops shell chrome. Staff open it in a new tab and use the browser
// "Save as PDF"; for the internal/pilot bar this is the PDF export path (no
// headless-Chromium dependency). A Route Handler (not a page) so no layout wraps it.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { getReport } from "@/lib/ops/reports/registry";
import { parseReportParams } from "@/lib/ops/reports/params";
import { runReport } from "@/lib/ops/reports/runner";
import { formatCell } from "@/lib/ops/reports/export";
import type { ReportColumn } from "@/lib/ops/reports/types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isNumeric(c: ReportColumn): boolean {
  return c.type === "number" || c.type === "currency" || c.type === "percent";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const gate = await requireOpsFn("manage_reports");
  if (!gate.ok) {
    // Plain-text for the print surface (this isn't a JSON client).
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { slug } = await params;
  const def = getReport(slug);
  if (!def) return new NextResponse("Unknown report", { status: 404 });

  const parsed = parseReportParams(def, request.nextUrl.searchParams);
  if (!parsed.ok) {
    return new NextResponse(`Invalid parameters: ${parsed.errors.join("; ")}`, {
      status: 400,
    });
  }

  const result = await runReport(def, parsed.params, {
    db: def.dataStatus === "available" ? createServiceClient() : null,
    shopIds: null,
    generatedAt: new Date().toISOString(),
  });

  const range =
    parsed.params.start && parsed.params.end
      ? `${parsed.params.start} → ${parsed.params.end}`
      : "All dates";

  const headCells = result.columns
    .map(
      (c) =>
        `<th class="${isNumeric(c) ? "num" : ""}">${esc(c.label)}</th>`,
    )
    .join("");

  const bodyRows = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map(
            (c) =>
              `<td class="${isNumeric(c) ? "num" : ""}">${esc(
                formatCell(row[c.key] ?? null, c.type),
              )}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(def.title)} — PSG Operational Report</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #18181b; margin: 32px; }
  header { margin-bottom: 16px; border-bottom: 2px solid #18181b; padding-bottom: 10px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #52525b; }
  .sample { display: inline-block; margin-left: 8px; padding: 1px 6px; border: 1px solid #a1a1aa; border-radius: 4px; font-size: 10px; color: #52525b; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e4e4e7; }
  th { text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; color: #52525b; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  footer { margin-top: 16px; font-size: 10px; color: #71717a; }
  .toolbar { margin-bottom: 16px; }
  button { font-size: 12px; padding: 6px 12px; cursor: pointer; }
  @media print { .toolbar { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
  <header>
    <h1>${esc(def.title)}${
      result.sample ? '<span class="sample">SAMPLE DATA</span>' : ""
    }</h1>
    <div class="meta">${esc(range)} · ${result.rows.length} row${
      result.rows.length === 1 ? "" : "s"
    } · generated ${esc(result.generatedAt)}</div>
  </header>
  <table>
    <thead><tr>${headCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <footer>Phoenix Solutions Group · Operational Reports · ${esc(def.slug)}</footer>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
