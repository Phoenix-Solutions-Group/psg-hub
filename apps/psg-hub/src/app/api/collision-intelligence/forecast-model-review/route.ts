import { NextResponse } from "next/server";
import { z } from "zod";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const destination = "/dashboard/collision-intelligence/review";
const reviewSchema = z.object({
  shopId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  reviewNotes: z.string().trim().min(20).max(1000),
  evidenceConfirmed: z.literal("confirmed"),
});

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function redirectToQueue(request: Request, result: string) {
  const url = new URL(destination, request.url);
  url.searchParams.set("result", result);
  url.hash = "forecast-model-review";
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getDashboardAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse({
    shopId: text(formData, "shop_id"),
    decision: text(formData, "decision"),
    reviewNotes: text(formData, "review_notes"),
    evidenceConfirmed: text(formData, "evidence_confirmed"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Evidence confirmation and review notes are required" },
      { status: 400 },
    );
  }

  const { error } = await createServiceClient().rpc(
    "review_collision_forecast_models",
    {
      p_shop_id: parsed.data.shopId,
      p_decision: parsed.data.decision,
      p_actor_profile_id: user.id,
      p_review_notes: parsed.data.reviewNotes,
    },
  );

  if (error) {
    console.error("[forecast-model-review] decision failed:", error.message);
    return redirectToQueue(
      request,
      error.code === "55000"
        ? "forecast_model_conflict"
        : error.code === "23514"
          ? "forecast_model_gate_failed"
          : error.code === "42883" || error.code === "PGRST202"
            ? "forecast_model_release_pending"
            : "forecast_model_error",
    );
  }

  return redirectToQueue(
    request,
    parsed.data.decision === "approve"
      ? "forecast_model_approved"
      : "forecast_model_rejected",
  );
}
