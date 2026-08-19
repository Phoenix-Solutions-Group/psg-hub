import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  createGoogleAdsRequestSchema,
  GOOGLE_ADS_REQUEST_SELECT,
  toCreateRow,
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

  return { ok: true as const, userId: user.id, supabase };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopId: string }> },
): Promise<Response> {
  const { shopId } = await params;
  if (!UUID_RE.test(shopId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const gate = await requireShopMember(shopId);
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase
    .from("google_ads_customer_requests")
    .select(GOOGLE_ADS_REQUEST_SELECT)
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  return NextResponse.json(
    { requests: data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shopId: string }> },
): Promise<Response> {
  const { shopId } = await params;
  if (!UUID_RE.test(shopId)) {
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
    const parsed = createGoogleAdsRequestSchema.parse(body);
    const row = toCreateRow(shopId, gate.userId, parsed);
    const service = createServiceClient();
    const { data, error } = await service
      .from("google_ads_customer_requests")
      .insert(row)
      .select(GOOGLE_ADS_REQUEST_SELECT)
      .single();

    if (error) {
      console.error("[google-ads/requests POST] insert failed:", error.message);
      return NextResponse.json({ error: "Request creation failed" }, { status: 500 });
    }
    const created = data as unknown as { id: string };

    await recordAuditEvent({
      actorProfileId: gate.userId,
      targetShopId: shopId,
      action: "google_ads_request.create",
      payload: {
        requestId: created.id,
        requestType: parsed.requestType,
        campaignId: parsed.campaignId ?? null,
        executesGoogleAdsChange: false,
      },
    });

    return NextResponse.json({ request: data }, { status: 201 });
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
