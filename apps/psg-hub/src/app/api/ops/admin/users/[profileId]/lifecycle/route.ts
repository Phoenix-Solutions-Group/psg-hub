import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";

const lifecycleSchema = z.object({
  status: z.enum(["active", "suspended"]),
});

async function readJson(request: NextRequest) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const gate = await requireOpsFn("manage_users");
  if (!gate.ok) return gate.response;
  if (gate.access.role !== "psg_superadmin") {
    return NextResponse.json(
      { error: "Only a superadmin can suspend or reactivate user accounts" },
      { status: 403 }
    );
  }
  const { profileId } = await params;

  if (profileId === gate.userId) {
    return NextResponse.json({ error: "You cannot suspend your own account" }, { status: 400 });
  }

  const { body, error: jsonError } = await readJson(request);
  if (jsonError) return jsonError;

  const parsed = lifecycleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const service = createServiceClient();
  const [authUser, { data: profile }] = await Promise.all([
    service.auth.admin.getUserById(profileId),
    service.from("profiles").select("id, display_name").eq("id", profileId).maybeSingle(),
  ]);
  if (authUser.error) {
    console.error("[api/ops/admin/users lifecycle PATCH] auth lookup failed:", authUser.error.message);
    return NextResponse.json({ error: "Failed to load auth user" }, { status: 500 });
  }
  if (!authUser.data.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const nextStatus = parsed.data.status;
  const updated = await service.auth.admin.updateUserById(profileId, {
    ban_duration: nextStatus === "suspended" ? "876000h" : "none",
  });
  if (updated.error) {
    console.error("[api/ops/admin/users lifecycle PATCH] auth update failed:", updated.error.message);
    return NextResponse.json({ error: "Failed to update user status" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: nextStatus === "suspended" ? "user.suspend" : "user.reactivate",
    targetProfileId: profileId,
    payload: {
      beforeBannedUntil: authUser.data.user.banned_until ?? null,
      afterStatus: nextStatus,
      email: authUser.data.user.email ?? null,
      displayName: (profile?.display_name as string | null) ?? null,
    },
  });

  return NextResponse.json({ ok: true, status: nextStatus });
}
