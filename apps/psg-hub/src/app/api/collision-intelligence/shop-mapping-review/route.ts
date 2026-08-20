import { NextResponse } from "next/server";
import { z } from "zod";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  matchesVerifiedShopLocation,
  shopIdentityEvidence,
} from "@/app/dashboard/collision-intelligence/review/shop-match";

const destination = "/dashboard/collision-intelligence/review";
const mappingSchema = z.object({
  sourceShopKey: z.string().regex(/^[A-Z0-9_-]{1,50}$/),
  shopId: z.string().uuid(),
  reviewNotes: z.string().trim().min(20).max(1000),
  identityConfirmed: z.literal("confirmed"),
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

  const parsed = mappingSchema.safeParse({
    sourceShopKey: text(formData, "source_shop_key"),
    shopId: text(formData, "shop_id"),
    reviewNotes: text(formData, "review_notes"),
    identityConfirmed: text(formData, "identity_confirmed"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Identity confirmation, target shop, and review notes are required",
      },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  if (shopIdentityEvidence[parsed.data.sourceShopKey]) {
    const targetShop = await service
      .from("shops")
      .select(
        "address_street,address_locality,address_region,address_postal_code",
      )
      .eq("id", parsed.data.shopId)
      .maybeSingle();
    if (targetShop.error) {
      console.error(
        "[collision-shop-mapping-review] target lookup failed:",
        targetShop.error.message,
      );
      return redirectToQueue(request, "mapping_error");
    }
    if (
      !targetShop.data ||
      !matchesVerifiedShopLocation(parsed.data.sourceShopKey, targetShop.data)
    ) {
      return redirectToQueue(
        request,
        "mapping_location_mismatch",
        parsed.data.sourceShopKey,
      );
    }
  }

  const { error } = await service.rpc("approve_collision_shop_mapping", {
    p_source_system: "filemaker_repair_customer",
    p_source_shop_key: parsed.data.sourceShopKey,
    p_shop_id: parsed.data.shopId,
    p_actor_profile_id: user.id,
    p_review_notes: parsed.data.reviewNotes,
  });

  if (error) {
    console.error(
      "[collision-shop-mapping-review] approval failed:",
      error.message,
    );
    return redirectToQueue(
      request,
      error.code === "23505" || error.code === "55000"
        ? "mapping_conflict"
        : "mapping_error",
    );
  }

  return redirectToQueue(request, "mapping_approved");
}
