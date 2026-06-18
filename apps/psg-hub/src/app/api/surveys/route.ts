import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { SURVEY_SELECT, emiPctToFraction } from "@/lib/ops/surveys";

// Ops Surveys API (v1.1 / PSG-36). Manual CSI survey entry + view on top of the
// existing v0.3 survey_responses table (shipped in 20260602105554_remote_schema).
//
// Schema coordination (per PSG-36): survey_responses already carries every field
// manual entry needs — no columns added. Manually entered rows are tagged with
// source = 'ops_manual_entry' so they are distinguishable from the
// 'bigquery_migration' import baseline. id is a bigint identity sequence.
//
// EMI semantics: scale_emi_pct is stored as a FRACTION (0..1); network_summary /
// shop_detail multiply by 100 for display (alert threshold 88%). The API accepts
// emi_pct as a human percentage (0..100) and persists the /100 fraction.
//
// q05_01..q05_04 map to quality / cleanliness / communication / courtesy
// (see public.shop_detail). Gated by manage_reports — surveys are the raw input
// to the /ops/reports CSI surface; RLS remains the authoritative backstop.

const createSurveySchema = z.object({
  shop_name: z.string().trim().min(1, "shop_name is required").max(200),
  survey_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "survey_date must be YYYY-MM-DD"),
  // Human-entered percentage 0..100; persisted as a 0..1 fraction.
  emi_pct: z.number().min(0).max(100).nullish(),
  quality: z.number().min(0).max(10).nullish(),
  cleanliness: z.number().min(0).max(10).nullish(),
  communication: z.number().min(0).max(10).nullish(),
  courtesy: z.number().min(0).max(10).nullish(),
  customer_comments: z.string().trim().max(5000).nullish(),
});

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_reports");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const shop = params.get("shop")?.trim();
  const from = params.get("from")?.trim();
  const to = params.get("to")?.trim();
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 100), 1), 500);

  const service = createServiceClient();
  let query = service
    .from("survey_responses")
    .select(SURVEY_SELECT)
    .order("survey_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (shop) query = query.ilike("shop_name", `%${shop}%`);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("survey_date", from);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("survey_date", to);

  const { data, error } = await query;
  if (error) {
    console.error("[api/surveys GET] query failed:", error.message);
    return NextResponse.json({ error: "Failed to load surveys" }, { status: 500 });
  }
  return NextResponse.json({ surveys: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_reports");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSurveySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const d = parsed.data;
  const service = createServiceClient();
  const { data, error } = await service
    .from("survey_responses")
    .insert({
      shop_name: d.shop_name,
      survey_date: d.survey_date,
      scale_emi_pct: emiPctToFraction(d.emi_pct),
      q05_01: d.quality ?? null,
      q05_02: d.cleanliness ?? null,
      q05_03: d.communication ?? null,
      q05_04: d.courtesy ?? null,
      text_customer_comments: d.customer_comments ?? null,
      source: "ops_manual_entry",
    })
    .select(SURVEY_SELECT)
    .single();

  if (error) {
    console.error("[api/surveys POST] insert failed:", error.message);
    return NextResponse.json({ error: "Failed to create survey" }, { status: 500 });
  }
  return NextResponse.json({ survey: data }, { status: 201 });
}
