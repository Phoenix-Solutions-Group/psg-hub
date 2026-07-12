import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { ADMIN_APP_ROLES, SHOP_MEMBER_ROLES } from "@/lib/ops/user-management";
import { createServiceClient } from "@/lib/supabase/service";

const inviteSchema = z
  .object({
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    role: z.enum(ADMIN_APP_ROLES),
    shopId: z.string().uuid().optional().nullable(),
    shopRole: z.enum(SHOP_MEMBER_ROLES).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.shopId && value.shopRole) {
      ctx.addIssue({
        code: "custom",
        path: ["shopRole"],
        message: "Choose a shop before choosing a shop role.",
      });
    }
  });

async function readJson(request: NextRequest) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

function inviteRedirectTo() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return appUrl ? `${appUrl}/login` : undefined;
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const { body, error: jsonError } = await readJson(request);
  if (jsonError) return jsonError;

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { email, role, shopId } = parsed.data;
  const shopRole = shopId ? parsed.data.shopRole ?? "viewer" : null;
  const service = createServiceClient();

  const existingAuthUsers = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (existingAuthUsers.error) {
    console.error("[api/ops/admin/users invite POST] listUsers failed:", existingAuthUsers.error.message);
    return NextResponse.json({ error: "Failed to check existing users" }, { status: 500 });
  }

  const existingUser = existingAuthUsers.data.users.find(
    (user) => user.email?.toLowerCase() === email
  );
  if (existingUser) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
  }

  let shop: { id: string; name: string | null; slug: string | null } | null = null;
  if (shopId) {
    const { data, error } = await service
      .from("shops")
      .select("id, name, slug")
      .eq("id", shopId)
      .maybeSingle();
    if (error) {
      console.error("[api/ops/admin/users invite POST] shop lookup failed:", error.message);
      return NextResponse.json({ error: "Failed to check shop" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    shop = data as { id: string; name: string | null; slug: string | null };
  }

  const redirectTo = inviteRedirectTo();
  const invite = await service.auth.admin.inviteUserByEmail(email, {
    data: { display_name: email },
    ...(redirectTo ? { redirectTo } : {}),
  });

  if (invite.error) {
    console.error("[api/ops/admin/users invite POST] invite failed:", invite.error.message);
    return NextResponse.json({ error: "Failed to send user invite" }, { status: 500 });
  }

  const invitedUserId = invite.data.user?.id;
  if (!invitedUserId) {
    return NextResponse.json({ error: "Invite did not return a user profile" }, { status: 500 });
  }

  const { error: profileError } = await service
    .from("profiles")
    .upsert({ id: invitedUserId, display_name: email }, { onConflict: "id" });
  if (profileError) {
    console.error("[api/ops/admin/users invite POST] profile upsert failed:", profileError.message);
    return NextResponse.json({ error: "Failed to create user profile" }, { status: 500 });
  }

  const { error: roleError } = await service
    .from("app_user_roles")
    .upsert({ profile_id: invitedUserId, role }, { onConflict: "profile_id" });
  if (roleError) {
    console.error("[api/ops/admin/users invite POST] role upsert failed:", roleError.message);
    return NextResponse.json({ error: "Failed to assign user role" }, { status: 500 });
  }

  if (shopId && shopRole) {
    const { error: membershipError } = await service
      .from("shop_users")
      .upsert(
        { user_id: invitedUserId, shop_id: shopId, role: shopRole },
        { onConflict: "user_id,shop_id" }
      );
    if (membershipError) {
      console.error(
        "[api/ops/admin/users invite POST] shop assignment failed:",
        membershipError.message
      );
      return NextResponse.json({ error: "Failed to assign starting shop access" }, { status: 500 });
    }
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "user.invite",
    targetProfileId: invitedUserId,
    targetShopId: shopId ?? null,
    payload: {
      email,
      role,
      shopRole,
      shopName: shop ? shop.name ?? shop.slug ?? shop.id : null,
      delivery: "supabase_invite_email",
    },
  });

  return NextResponse.json(
    {
      user: {
        id: invitedUserId,
        email,
        role,
        shopId: shopId ?? null,
        shopRole,
      },
    },
    { status: 201 }
  );
}
