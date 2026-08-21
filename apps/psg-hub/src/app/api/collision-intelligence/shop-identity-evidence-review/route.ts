import { NextResponse } from "next/server";
import { z } from "zod";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const destination = "/dashboard/collision-intelligence/review";
const evidenceSchema = z.object({
  sourceShopKey: z.string().regex(/^PS[0-9]+$/),
  addressStreet: z.string().trim().min(3).max(200),
  addressLocality: z.string().trim().min(2).max(100),
  addressRegion: z.string().regex(/^[A-Z]{2}$/),
  addressPostalCode: z.string().regex(/^[0-9]{5}$/),
  sourceName: z.string().trim().min(3).max(200),
  sourceUrl: z
    .string()
    .max(1000)
    .url()
    .regex(/^https:\/\//),
  reviewNotes: z.string().trim().min(20).max(1000),
  evidenceConfirmed: z.literal("confirmed"),
});

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function redirectToQueue(
  request: Request,
  result: string,
  sourceShopKey?: string,
) {
  const url = new URL(destination, request.url);
  url.searchParams.set("result", result);
  if (sourceShopKey) {
    url.searchParams.set("shop_source", sourceShopKey);
    url.hash = "shop-match";
  }
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

  const parsed = evidenceSchema.safeParse({
    sourceShopKey: text(formData, "source_shop_key").toUpperCase(),
    addressStreet: text(formData, "address_street"),
    addressLocality: text(formData, "address_locality"),
    addressRegion: text(formData, "address_region").toUpperCase(),
    addressPostalCode: text(formData, "address_postal_code"),
    sourceName: text(formData, "source_name"),
    sourceUrl: text(formData, "source_url"),
    reviewNotes: text(formData, "review_notes"),
    evidenceConfirmed: text(formData, "evidence_confirmed"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Complete, confirmed address evidence is required" },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { error } = await service.rpc(
    "review_collision_shop_identity_evidence",
    {
      p_source_system: "filemaker_repair_customer",
      p_source_shop_key: parsed.data.sourceShopKey,
      p_address_street: parsed.data.addressStreet,
      p_address_locality: parsed.data.addressLocality,
      p_address_region: parsed.data.addressRegion,
      p_address_postal_code: parsed.data.addressPostalCode,
      p_source_name: parsed.data.sourceName,
      p_source_url: parsed.data.sourceUrl,
      p_actor_profile_id: user.id,
      p_review_notes: parsed.data.reviewNotes,
    },
  );

  if (error) {
    console.error(
      "[collision-shop-identity-evidence-review] update failed:",
      error.message,
    );
    return redirectToQueue(
      request,
      error.code === "42883" || error.code === "PGRST202"
        ? "mapping_evidence_release_pending"
        : "mapping_evidence_error",
      parsed.data.sourceShopKey,
    );
  }

  return redirectToQueue(
    request,
    "mapping_evidence_recorded",
    parsed.data.sourceShopKey,
  );
}
