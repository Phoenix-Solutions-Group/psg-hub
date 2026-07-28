import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";

const updateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  })
  .refine((value) => value.displayName !== undefined || value.email !== undefined, {
    message: "Provide a display name or email to update.",
  });

async function readJson(request: NextRequest) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

function requireSuperadminRole(gate: Awaited<ReturnType<typeof requireOpsFn>>) {
  if (!gate.ok) return gate.response;
  if (gate.access.role !== "psg_superadmin") {
    return NextResponse.json(
      { error: "Only a superadmin can delete user accounts" },
      { status: 403 }
    );
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const gate = await requireOpsFn("manage_users");
  if (!gate.ok) return gate.response;
  const { profileId } = await params;

  const { body, error: jsonError } = await readJson(request);
  if (jsonError) return jsonError;

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { displayName, email } = parsed.data;
  const service = createServiceClient();
  const [{ data: profile }, authUser] = await Promise.all([
    service.from("profiles").select("id, display_name").eq("id", profileId).maybeSingle(),
    service.auth.admin.getUserById(profileId),
  ]);

  if (!profile && !authUser.data.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (authUser.error) {
    console.error("[api/ops/admin/users PATCH] auth lookup failed:", authUser.error.message);
    return NextResponse.json({ error: "Failed to load auth user" }, { status: 500 });
  }

  const before = {
    displayName: (profile?.display_name as string | null) ?? null,
    email: authUser.data.user?.email ?? null,
  };

  if (displayName !== undefined) {
    const { error } = await service
      .from("profiles")
      .upsert({ id: profileId, display_name: displayName }, { onConflict: "id" });
    if (error) {
      console.error("[api/ops/admin/users PATCH] profile update failed:", error.message);
      return NextResponse.json({ error: "Failed to update user profile" }, { status: 500 });
    }
  }

  if (email !== undefined) {
    if (!authUser.data.user) {
      return NextResponse.json({ error: "Auth user not found for email update" }, { status: 404 });
    }
    const updatedAuth = await service.auth.admin.updateUserById(profileId, {
      email,
      user_metadata: {
        ...(authUser.data.user.user_metadata ?? {}),
        display_name: displayName ?? before.displayName ?? email,
      },
    });
    if (updatedAuth.error) {
      console.error("[api/ops/admin/users PATCH] auth update failed:", updatedAuth.error.message);
      return NextResponse.json({ error: "Failed to update user login" }, { status: 500 });
    }
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "user.update",
    targetProfileId: profileId,
    payload: {
      before,
      after: {
        displayName: displayName ?? before.displayName,
        email: email ?? before.email,
      },
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const gate = await requireOpsFn("manage_users");
  if (!gate.ok) return gate.response;
  const superadminError = requireSuperadminRole(gate);
  if (superadminError) return superadminError;
  const { profileId } = await params;

  if (profileId === gate.userId) {
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
  }

  const service = createServiceClient();
  const [{ data: profile }, { data: roleRow }, authUser] = await Promise.all([
    service.from("profiles").select("id, display_name").eq("id", profileId).maybeSingle(),
    service.from("app_user_roles").select("role").eq("profile_id", profileId).maybeSingle(),
    service.auth.admin.getUserById(profileId),
  ]);

  if (!profile && !authUser.data.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (authUser.error) {
    console.error("[api/ops/admin/users DELETE] auth lookup failed:", authUser.error.message);
    return NextResponse.json({ error: "Failed to load auth user" }, { status: 500 });
  }

  const deleted = await service.auth.admin.deleteUser(profileId, true);
  if (deleted.error) {
    console.error("[api/ops/admin/users DELETE] auth delete failed:", deleted.error.message);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }

  const [shopAccessCleanup, roleCleanup, securityProfileCleanup] = await Promise.all([
    service.from("shop_users").delete().eq("user_id", profileId),
    service.from("app_user_roles").delete().eq("profile_id", profileId),
    service.from("user_security_profile_assignments").delete().eq("profile_id", profileId),
  ]);
  const cleanupError =
    shopAccessCleanup.error ?? roleCleanup.error ?? securityProfileCleanup.error ?? null;
  if (cleanupError) {
    console.error("[api/ops/admin/users DELETE] access cleanup failed:", cleanupError.message);
    return NextResponse.json(
      { error: "User was deleted, but access cleanup failed" },
      { status: 500 }
    );
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "user.delete",
    targetProfileId: profileId,
    payload: {
      email: authUser.data.user?.email ?? null,
      displayName: (profile?.display_name as string | null) ?? null,
      role: roleRow?.role ?? null,
      softDelete: true,
    },
  });

  return NextResponse.json({ ok: true });
}
