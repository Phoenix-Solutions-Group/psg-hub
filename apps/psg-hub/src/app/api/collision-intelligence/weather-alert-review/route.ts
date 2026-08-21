import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveShopContext } from "@/lib/shop/context";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const destination = "/dashboard/collision-intelligence";
const acknowledgeSchema = z.object({
  action: z.literal("acknowledge"),
  zipCode: z.string().regex(/^[0-9]{5}$/),
  eventType: z.enum(["tornado", "hail", "thunderstorm wind"]),
  eventDate: z.string().date(),
});
const closeSchema = z.object({
  action: z.literal("close"),
  caseId: z.string().uuid(),
  outcome: z.enum([
    "observed_follow_through",
    "no_observed_follow_through",
    "not_evaluable",
  ]),
  outcomeNotes: z.string().trim().min(20).max(2000),
});

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function redirectToDashboard(request: Request, result: string) {
  const url = new URL(destination, request.url);
  url.searchParams.set("weather_review", result);
  url.hash = "weather-alerts";
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

  const { shops, activeShopId } = await getActiveShopContext(user.id);
  const activeShop = shops.find((shop) => shop.id === activeShopId);
  if (
    !activeShopId ||
    !activeShop ||
    (activeShop.role !== "owner" && activeShop.role !== "manager")
  ) {
    return NextResponse.json(
      { error: "Only shop owners or managers can review weather signals." },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const action = text(formData, "action");
  const parsed =
    action === "acknowledge"
      ? acknowledgeSchema.safeParse({
          action,
          zipCode: text(formData, "zip_code"),
          eventType: text(formData, "event_type"),
          eventDate: text(formData, "event_date"),
        })
      : closeSchema.safeParse({
          action,
          caseId: text(formData, "case_id"),
          outcome: text(formData, "outcome"),
          outcomeNotes: text(formData, "outcome_notes"),
        });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Valid weather review details are required." },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { error } =
    parsed.data.action === "acknowledge"
      ? await service.rpc("acknowledge_collision_weather_alert", {
          p_shop_id: activeShopId,
          p_zip_code: parsed.data.zipCode,
          p_event_type: parsed.data.eventType,
          p_event_date: parsed.data.eventDate,
          p_actor_profile_id: user.id,
        })
      : await service.rpc("close_collision_weather_alert_case", {
          p_case_id: parsed.data.caseId,
          p_shop_id: activeShopId,
          p_outcome: parsed.data.outcome,
          p_outcome_notes: parsed.data.outcomeNotes,
          p_actor_profile_id: user.id,
        });

  if (error) {
    console.error("[weather-alert-review] update failed:", error.message);
    const evidenceIncomplete =
      parsed.data.action === "close" &&
      error.code === "55000" &&
      (error.message.includes("Four complete signal weeks") ||
        error.message.includes("Repair-arrival evidence"));
    return redirectToDashboard(
      request,
      evidenceIncomplete
        ? "evidence_incomplete"
        : error.code === "42883" || error.code === "PGRST202"
          ? "release_pending"
          : error.code === "55000" || error.code === "P0002"
            ? "stale"
            : "error",
    );
  }

  return redirectToDashboard(
    request,
    parsed.data.action === "acknowledge" ? "acknowledged" : "closed",
  );
}
