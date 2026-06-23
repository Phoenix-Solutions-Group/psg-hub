// Wave 1A / PSG-258 — Production entry point: superadmin ops route for the sitemap run.
//
//   POST /api/ops/sitemap          { shopId }      → run the gated pipeline for a shop
//   GET  /api/ops/sitemap?shopId=… &format=html|json → render the latest persisted package
//
// Superadmin-gated (requireSuperadmin runs BEFORE any service client / spend — the run is
// metered + persists a client deliverable, so it sits at psg_superadmin, mirroring the intel
// competitor report). RLS is the authoritative backstop; this gate is fail-closed defense in
// depth. Every run is audited inside runSitemap so vendor spend + the deliverable are
// attributable to an actor + shop.
//
// runtime=nodejs: requireSuperadmin → getOpsAccess and the run orchestrator both use the
// server-only service client; the router + persistence are server-only too.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { runSitemap } from "@/lib/sitemap/run";
import { loadSitemapPackages } from "@/lib/sitemap/persistence";
import { renderSitemapDeliverable } from "@/lib/sitemap/render";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const shopId = (body as { shopId?: unknown } | null)?.shopId;
  if (typeof shopId !== "string" || !UUID_RE.test(shopId)) {
    return NextResponse.json(
      { error: "shopId is required and must be a UUID" },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const outcome = await runSitemap({ service, shopId, userId: gate.userId });

  switch (outcome.status) {
    case "no_shop":
      return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    case "awaiting_approval":
      return NextResponse.json(
        {
          status: "awaiting_approval",
          phase: outcome.stop.phase,
          contentHash: outcome.stop.contentHash,
          summary: outcome.stop.record.summary,
          message:
            "A checkpoint is queued for superadmin sign-off. Approve it, then re-run to advance.",
        },
        { status: 202 },
      );
    case "changes_requested":
      return NextResponse.json(
        {
          status: "changes_requested",
          phase: outcome.stop.phase,
          notes: outcome.stop.approval.notes ?? null,
        },
        { status: 409 },
      );
    case "complete":
      return NextResponse.json({
        status: "complete",
        artifactId: outcome.persisted.id,
        shopId: outcome.persisted.shopId,
        businessName: outcome.package.brief.businessName,
      });
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const search = request.nextUrl.searchParams;
  const shopId = search.get("shopId");
  if (!shopId || !UUID_RE.test(shopId)) {
    return NextResponse.json(
      { error: "shopId query parameter is required and must be a UUID" },
      { status: 400 },
    );
  }
  const format = (search.get("format") ?? "html").toLowerCase();
  if (format !== "html" && format !== "json") {
    return NextResponse.json({ error: 'format must be "html" or "json"' }, { status: 400 });
  }

  const service = createServiceClient();
  const packages = await loadSitemapPackages(service, shopId);
  if (packages.length === 0) {
    return NextResponse.json(
      { error: "No sitemap package found for this shop" },
      { status: 404 },
    );
  }

  const latest = packages[0].data.package;
  if (format === "json") {
    return NextResponse.json({ package: latest });
  }
  return new NextResponse(renderSitemapDeliverable(latest), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
