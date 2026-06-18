import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { SURVEY_SELECT, emiPctToFraction } from "@/lib/ops/surveys";

// Single-survey read / edit / delete (v1.1 / PSG-36). Same manage_reports gate
// and EMI fraction semantics as the collection route. survey_responses.id is a
// bigint identity sequence, so we validate the path segment as a positive int.

const idSchema = z.coerce.number().int().positive();

const updateSurveySchema = z
  .object({
    shop_name: z.string().trim().min(1).max(200),
    survey_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "survey_date must be YYYY-MM-DD"),
    emi_pct: z.number().min(0).max(100).nullable(),
    quality: z.number().min(0).max(10).nullable(),
    cleanliness: z.number().min(0).max(10).nullable(),
    communication: z.number().min(0).max(10).nullable(),
    courtesy: z.number().min(0).max(10).nullable(),
    customer_comments: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

async function resolveId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOpsFn("manage_reports");
  if (!gate.ok) return gate.response;

  const id = await resolveId(ctx.params);
  if (id == null) return NextResponse.json({ error: "Invalid survey id" }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from("survey_responses")
    .select(SURVEY_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[api/surveys/:id GET] query failed:", error.message);
    return NextResponse.json({ error: "Failed to load survey" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Survey not found" }, { status: 404 });
  return NextResponse.json({ survey: data });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOpsFn("manage_reports");
  if (!gate.ok) return gate.response;

  const id = await resolveId(ctx.params);
  if (id == null) return NextResponse.json({ error: "Invalid survey id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSurveySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const d = parsed.data;
  const patch: Record<string, unknown> = {};
  if (d.shop_name !== undefined) patch.shop_name = d.shop_name;
  if (d.survey_date !== undefined) patch.survey_date = d.survey_date;
  if (d.emi_pct !== undefined) patch.scale_emi_pct = emiPctToFraction(d.emi_pct);
  if (d.quality !== undefined) patch.q05_01 = d.quality;
  if (d.cleanliness !== undefined) patch.q05_02 = d.cleanliness;
  if (d.communication !== undefined) patch.q05_03 = d.communication;
  if (d.courtesy !== undefined) patch.q05_04 = d.courtesy;
  if (d.customer_comments !== undefined) patch.text_customer_comments = d.customer_comments;

  const service = createServiceClient();
  const { data, error } = await service
    .from("survey_responses")
    .update(patch)
    .eq("id", id)
    .select(SURVEY_SELECT)
    .maybeSingle();

  if (error) {
    console.error("[api/surveys/:id PATCH] update failed:", error.message);
    return NextResponse.json({ error: "Failed to update survey" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Survey not found" }, { status: 404 });
  return NextResponse.json({ survey: data });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOpsFn("manage_reports");
  if (!gate.ok) return gate.response;

  const id = await resolveId(ctx.params);
  if (id == null) return NextResponse.json({ error: "Invalid survey id" }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service
    .from("survey_responses")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[api/surveys/:id DELETE] delete failed:", error.message);
    return NextResponse.json({ error: "Failed to delete survey" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Survey not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
