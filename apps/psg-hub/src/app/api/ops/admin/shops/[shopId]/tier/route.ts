import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { ADMIN_TIERS } from "@/lib/ops/user-management";

const tierSchema = z.object({
  tier: z.enum(ADMIN_TIERS),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;
  const { shopId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = tierSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const service = createServiceClient();
  const [{ data: shop }, { data: existing }] = await Promise.all([
    service.from("shops").select("id, name, slug").eq("id", shopId).maybeSingle(),
    service.from("subscriptions").select("id, tier, status").eq("shop_id", shopId).maybeSingle(),
  ]);

  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  if (!existing) {
    return NextResponse.json(
      { error: "This shop does not have a subscription record to update" },
      { status: 404 }
    );
  }

  const { data, error } = await service
    .from("subscriptions")
    .update({ tier: parsed.data.tier })
    .eq("shop_id", shopId)
    .select("shop_id, tier, status")
    .single();

  if (error) {
    console.error("[api/ops/admin/shops tier PATCH] failed:", error.message);
    return NextResponse.json({ error: "Failed to update shop tier" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "tier.change",
    targetShopId: shopId,
    payload: {
      beforeTier: existing.tier,
      afterTier: data.tier,
      status: data.status,
      shopName: shop.name ?? shop.slug ?? shopId,
    },
  });

  return NextResponse.json({ subscription: data });
}
