import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { recordAuditEvent } from "@/lib/audit/access-audit";

// Assign / unassign a named security profile to a user (v1.1 / PSG-39).
// Superadmin-only. Only psg_internal users gain capabilities from an assignment
// (current_user_has_fn honors named profiles for psg_internal only), so the
// target must be ops staff — a customer assignment would be inert and is
// rejected to keep the surface honest.

const bodySchema = z.object({
  profileId: z.string().uuid(), // the target USER's profiles.id
  securityProfileId: z.string().uuid(), // the security_profile_defs.id
});

const STAFF_ROLES = new Set(["psg_internal", "psg_superadmin"]);

async function parse(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      error: NextResponse.json(
        { error: "Validation failed", issues: parsed.error.flatten() },
        { status: 422 }
      ),
    };
  }
  return { data: parsed.data };
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const { data, error } = await parse(request);
  if (error) return error;
  const { profileId, securityProfileId } = data!;

  const service = createServiceClient();

  // Target must be ops staff (else the assignment grants nothing).
  const { data: roleRow } = await service
    .from("app_user_roles")
    .select("role")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!roleRow || !STAFF_ROLES.has(roleRow.role as string)) {
    return NextResponse.json(
      { error: "Security profiles can only be assigned to ops staff (psg_internal)" },
      { status: 422 }
    );
  }

  // Validate the profile exists (clean 404 instead of an opaque FK error).
  const { data: def } = await service
    .from("security_profile_defs")
    .select("id, name")
    .eq("id", securityProfileId)
    .maybeSingle();
  if (!def) {
    return NextResponse.json({ error: "Security profile not found" }, { status: 404 });
  }

  const { error: insertError } = await service
    .from("user_security_profile_assignments")
    .upsert(
      { profile_id: profileId, security_profile_id: securityProfileId },
      { onConflict: "profile_id,security_profile_id", ignoreDuplicates: true }
    );

  if (insertError) {
    console.error("[api/ops/security-profiles/assignments POST] failed:", insertError.message);
    return NextResponse.json({ error: "Failed to assign security profile" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "security_profile.assign",
    targetProfileId: profileId,
    payload: { securityProfileId, name: def.name },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const { data, error } = await parse(request);
  if (error) return error;
  const { profileId, securityProfileId } = data!;

  const service = createServiceClient();
  const { error: deleteError } = await service
    .from("user_security_profile_assignments")
    .delete()
    .eq("profile_id", profileId)
    .eq("security_profile_id", securityProfileId);

  if (deleteError) {
    console.error("[api/ops/security-profiles/assignments DELETE] failed:", deleteError.message);
    return NextResponse.json({ error: "Failed to unassign security profile" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "security_profile.unassign",
    targetProfileId: profileId,
    payload: { securityProfileId },
  });

  return NextResponse.json({ ok: true });
}
