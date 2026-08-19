import { type NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { importGoogleAdsMetricsFallback } from "@/lib/google-ads/import-fallback";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_reports");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const summary = await importGoogleAdsMetricsFallback(createServiceClient(), body, {
      importedByProfileId: gate.userId,
    });
    return NextResponse.json({ imported: summary });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.flatten() },
        { status: 422 }
      );
    }
    console.error("[google-ads/import] failed:", (err as Error).message);
    return NextResponse.json({ error: "Google Ads import failed" }, { status: 500 });
  }
}
