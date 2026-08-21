import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  customerGoogleAdsRequestReplySchema,
  GOOGLE_ADS_REQUEST_SELECT,
} from "@/lib/google-ads/customer-requests";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

async function requireShopMember(shopId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!membership) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true as const, userId: user.id };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ shopId: string; requestId: string }> },
): Promise<Response> {
  const { shopId, requestId } = await params;
  if (!UUID_RE.test(shopId) || !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const gate = await requireShopMember(shopId);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const parsed = customerGoogleAdsRequestReplySchema.parse(body);
    const service = createServiceClient();

    const { data: existing, error: readError } = await service
      .from("google_ads_customer_requests")
      .select("id, shop_id, status")
      .eq("id", requestId)
      .eq("shop_id", shopId)
      .maybeSingle();

    if (readError) {
      return NextResponse.json({ error: "Request lookup failed" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if ((existing as { status: string }).status !== "needs_more_info") {
      return NextResponse.json(
        { error: "This request is not waiting on customer details" },
        { status: 409 },
      );
    }

    const responseText = parsed.response;
    const { data, error } = await service
      .from("google_ads_customer_requests")
      .update({
        status: "psg_reviewing",
        psg_response: `Customer replied: ${responseText}`,
        updated_by_profile_id: gate.userId,
      })
      .eq("id", requestId)
      .eq("shop_id", shopId)
      .select(GOOGLE_ADS_REQUEST_SELECT)
      .single();

    if (error) {
      return NextResponse.json({ error: "Request update failed" }, { status: 500 });
    }

    await recordAuditEvent({
      actorProfileId: gate.userId,
      targetShopId: shopId,
      action: "google_ads_request.customer_reply",
      payload: {
        requestId,
        previousStatus: "needs_more_info",
        status: "psg_reviewing",
        executesGoogleAdsChange: false,
      },
    });

    return NextResponse.json({ request: data });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.flatten() },
        { status: 422 },
      );
    }
    throw err;
  }
}
