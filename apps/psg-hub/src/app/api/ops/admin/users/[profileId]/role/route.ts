import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { ADMIN_APP_ROLES, auditActionForRoleChange } from "@/lib/ops/user-management";

const roleSchema = z.object({
  role: z.enum(ADMIN_APP_ROLES),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;
  const { profileId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const service = createServiceClient();
  const [{ data: targetProfile }, { data: existing }] = await Promise.all([
    service.from("profiles").select("id, display_name").eq("id", profileId).maybeSingle(),
    service.from("app_user_roles").select("role").eq("profile_id", profileId).maybeSingle(),
  ]);

  if (!targetProfile) {
    return NextResponse.json({ error: "User profile not found" }, { status: 404 });
  }

  const beforeRole = (existing?.role as string | undefined) ?? null;
  const nextRole = parsed.data.role;

  const { data, error } = await service
    .from("app_user_roles")
    .upsert({ profile_id: profileId, role: nextRole }, { onConflict: "profile_id" })
    .select("profile_id, role")
    .single();

  if (error) {
    console.error("[api/ops/admin/users role PATCH] failed:", error.message);
    return NextResponse.json({ error: "Failed to update user role" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: auditActionForRoleChange(nextRole),
    targetProfileId: profileId,
    payload: {
      beforeRole,
      afterRole: nextRole,
      targetDisplayName: targetProfile.display_name ?? null,
    },
  });

  return NextResponse.json({ role: data });
}
