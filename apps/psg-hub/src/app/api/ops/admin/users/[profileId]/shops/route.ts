import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { SHOP_MEMBER_ROLES } from "@/lib/ops/user-management";

const assignSchema = z.object({
  shopId: z.string().uuid(),
  role: z.enum(SHOP_MEMBER_ROLES).default("viewer"),
});

const revokeSchema = z.object({
  shopId: z.string().uuid(),
});

async function readJson(request: NextRequest) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;
  const { profileId } = await params;

  const { body, error: jsonError } = await readJson(request);
  if (jsonError) return jsonError;

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { shopId, role } = parsed.data;
  const service = createServiceClient();
  const [{ data: targetProfile }, { data: shop }, { data: existing }] = await Promise.all([
    service.from("profiles").select("id, display_name").eq("id", profileId).maybeSingle(),
    service.from("shops").select("id, name, slug").eq("id", shopId).maybeSingle(),
    service
      .from("shop_users")
      .select("role")
      .eq("user_id", profileId)
      .eq("shop_id", shopId)
      .maybeSingle(),
  ]);

  if (!targetProfile) return NextResponse.json({ error: "User profile not found" }, { status: 404 });
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const { data, error } = await service
    .from("shop_users")
    .upsert({ user_id: profileId, shop_id: shopId, role }, { onConflict: "user_id,shop_id" })
    .select("user_id, shop_id, role")
    .single();

  if (error) {
    console.error("[api/ops/admin/users shops POST] failed:", error.message);
    return NextResponse.json({ error: "Failed to assign shop access" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "shop.assign",
    targetProfileId: profileId,
    targetShopId: shopId,
    payload: {
      beforeRole: existing?.role ?? null,
      afterRole: role,
      shopName: shop.name ?? shop.slug ?? shopId,
      targetDisplayName: targetProfile.display_name ?? null,
    },
  });

  return NextResponse.json({ membership: data }, { status: 201 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;
  const { profileId } = await params;

  const { body, error: jsonError } = await readJson(request);
  if (jsonError) return jsonError;

  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { shopId } = parsed.data;
  const service = createServiceClient();
  const [{ data: shop }, { data: existing }] = await Promise.all([
    service.from("shops").select("id, name, slug").eq("id", shopId).maybeSingle(),
    service
      .from("shop_users")
      .select("role")
      .eq("user_id", profileId)
      .eq("shop_id", shopId)
      .maybeSingle(),
  ]);

  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  if (!existing) return NextResponse.json({ error: "Shop access not found" }, { status: 404 });

  const { error } = await service
    .from("shop_users")
    .delete()
    .eq("user_id", profileId)
    .eq("shop_id", shopId);

  if (error) {
    console.error("[api/ops/admin/users shops DELETE] failed:", error.message);
    return NextResponse.json({ error: "Failed to revoke shop access" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "shop.unassign",
    targetProfileId: profileId,
    targetShopId: shopId,
    payload: {
      beforeRole: existing.role,
      shopName: shop.name ?? shop.slug ?? shopId,
    },
  });

  return NextResponse.json({ ok: true });
}
