import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireOpsFn } from "@/lib/auth/ops-access";
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
  const configuredUrl =
    process.env.SUPABASE_INVITE_REDIRECT_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const appUrl = configuredUrl.replace(/\/+$/, "");
  if (!appUrl) return undefined;

  try {
    const url = new URL(appUrl);
    if (process.env.VERCEL_ENV === "preview" && url.hostname.endsWith(".vercel.app")) {
      return undefined;
    }
    return `${url.origin}/login`;
  } catch {
    return undefined;
  }
}

async function findAuthUserByEmail(
  service: ReturnType<typeof createServiceClient>,
  email: string
) {
  const perPage = 1000;
  let page = 1;

  while (true) {
    const existingAuthUsers = await service.auth.admin.listUsers({ page, perPage });
    if (existingAuthUsers.error) return { error: existingAuthUsers.error };

    const users = existingAuthUsers.data.users;
    const existingUser = users.find((user) => user.email?.toLowerCase() === email);
    if (existingUser) return { user: existingUser };
    if (users.length < perPage) return { user: null };

    page += 1;
  }
}

function isReservedTestEmail(email: string) {
  const domain = email.split("@").at(-1)?.toLowerCase();
  return (
    domain === "example.com" ||
    domain === "example.org" ||
    domain === "example.net" ||
    domain?.endsWith(".test") === true ||
    domain?.endsWith(".invalid") === true
  );
}

async function createDemoInviteUser(
  service: ReturnType<typeof createServiceClient>,
  email: string
) {
  const existingAuthUser = await findAuthUserByEmail(service, email);
  if (existingAuthUser.error) return { error: existingAuthUser.error };
  if (existingAuthUser.user) {
    return { user: existingAuthUser.user, delivery: "supabase_invite_recorded" };
  }

  const created = await service.auth.admin.createUser({
    email,
    password: `${randomUUID()}${randomUUID()}`,
    email_confirm: false,
    user_metadata: { display_name: email },
  });
  if (created.error) return { error: created.error };

  return { user: created.data.user, delivery: "demo_reserved_email_user_created" };
}

async function existingInviteIsComplete(
  service: ReturnType<typeof createServiceClient>,
  profileId: string,
  shopId: string | null
) {
  const [profileResult, roleResult, shopResult] = await Promise.all([
    service.from("profiles").select("id").eq("id", profileId).maybeSingle(),
    service.from("app_user_roles").select("profile_id").eq("profile_id", profileId).maybeSingle(),
    shopId
      ? service
          .from("shop_users")
          .select("user_id")
          .eq("user_id", profileId)
          .eq("shop_id", shopId)
          .maybeSingle()
      : Promise.resolve({ data: { user_id: profileId }, error: null }),
  ]);

  const error = profileResult.error ?? roleResult.error ?? shopResult.error;
  if (error) return { error };

  return {
    complete: Boolean(profileResult.data && roleResult.data && shopResult.data),
  };
}

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_users");
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
  if (role === "psg_superadmin" && gate.access.role !== "psg_superadmin") {
    return NextResponse.json(
      { error: "Only an existing superadmin can grant the superadmin role" },
      { status: 403 }
    );
  }
  const shopRole = shopId ? parsed.data.shopRole ?? "viewer" : null;
  const service = createServiceClient();

  const existingAuthUser = await findAuthUserByEmail(service, email);
  if (existingAuthUser.error) {
    console.error("[api/ops/admin/users invite POST] listUsers failed:", existingAuthUser.error.message);
    return NextResponse.json({ error: "Failed to check existing users" }, { status: 500 });
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

  let invitedUser = existingAuthUser.user ?? null;
  let delivery = "existing_auth_user_access_repaired";
  let status = 200;
  if (invitedUser?.id) {
    const existingState = await existingInviteIsComplete(service, invitedUser.id, shopId ?? null);
    if (existingState.error) {
      console.error(
        "[api/ops/admin/users invite POST] existing access lookup failed:",
        existingState.error.message
      );
      return NextResponse.json({ error: "Failed to check existing user access" }, { status: 500 });
    }
    if (existingState.complete) {
      return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
    }
  }

  if (!invitedUser) {
    const redirectTo = inviteRedirectTo();
    const invite = await service.auth.admin.inviteUserByEmail(email, {
      data: { display_name: email },
      ...(redirectTo ? { redirectTo } : {}),
    });

    invitedUser = invite.data.user;
    delivery = "supabase_invite_email";
    status = 201;
    if (invite.error) {
      console.error("[api/ops/admin/users invite POST] invite failed:", invite.error.message);
      if (!isReservedTestEmail(email)) {
        return NextResponse.json({ error: "Failed to send user invite" }, { status: 500 });
      }

      const demoInvite = await createDemoInviteUser(service, email);
      if (demoInvite.error) {
        console.error(
          "[api/ops/admin/users invite POST] demo invite fallback failed:",
          demoInvite.error.message
        );
        return NextResponse.json({ error: "Failed to send user invite" }, { status: 500 });
      }
      invitedUser = demoInvite.user;
      delivery = demoInvite.delivery;
    }
  }

  const invitedUserId = invitedUser?.id;
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
      delivery,
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
    { status }
  );
}
