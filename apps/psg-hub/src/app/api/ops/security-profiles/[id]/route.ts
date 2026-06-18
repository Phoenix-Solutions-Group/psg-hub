import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperadmin, OPS_FUNCTIONS } from "@/lib/auth/ops-access";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { buildFunctionsJsonb, normalizeProfileName } from "@/lib/ops/security-profiles";

// Edit/delete a named security-profile def (v1.1 / PSG-39). Superadmin-only.
// Built-in profiles (Administrator) are immutable — the always-on safety net.

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  functions: z.array(z.enum(OPS_FUNCTIONS)).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const service = createServiceClient();
  const { data: existing, error: loadError } = await service
    .from("security_profile_defs")
    .select("id, name, is_builtin, functions_jsonb")
    .eq("id", id)
    .single();

  if (loadError || !existing) {
    return NextResponse.json({ error: "Security profile not found" }, { status: 404 });
  }
  if (existing.is_builtin) {
    return NextResponse.json(
      { error: "Built-in profiles cannot be edited" },
      { status: 422 }
    );
  }

  const update: { name?: string; functions_jsonb?: Record<string, true> } = {};
  if (parsed.data.name !== undefined) {
    const name = normalizeProfileName(parsed.data.name);
    if (!name) return NextResponse.json({ error: "Invalid profile name" }, { status: 422 });
    update.name = name;
  }
  if (parsed.data.functions !== undefined) {
    update.functions_jsonb = buildFunctionsJsonb(parsed.data.functions);
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No changes supplied" }, { status: 422 });
  }

  const { data, error } = await service
    .from("security_profile_defs")
    .update(update)
    .eq("id", id)
    .eq("is_builtin", false) // belt-and-suspenders: never mutate a built-in
    .select("id, name, is_builtin, functions_jsonb")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A profile with that name already exists" }, { status: 409 });
    }
    console.error("[api/ops/security-profiles PATCH] update failed:", error.message);
    return NextResponse.json({ error: "Failed to update security profile" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "security_profile_def.update",
    payload: { securityProfileId: id, before: existing, after: data },
  });

  return NextResponse.json({ profile: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const service = createServiceClient();
  const { data: existing, error: loadError } = await service
    .from("security_profile_defs")
    .select("id, name, is_builtin")
    .eq("id", id)
    .single();

  if (loadError || !existing) {
    return NextResponse.json({ error: "Security profile not found" }, { status: 404 });
  }
  if (existing.is_builtin) {
    return NextResponse.json({ error: "Built-in profiles cannot be deleted" }, { status: 422 });
  }

  // Assignments cascade (FK on delete cascade); affected users lose this grant.
  const { error } = await service
    .from("security_profile_defs")
    .delete()
    .eq("id", id)
    .eq("is_builtin", false);

  if (error) {
    console.error("[api/ops/security-profiles DELETE] delete failed:", error.message);
    return NextResponse.json({ error: "Failed to delete security profile" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "security_profile_def.delete",
    payload: { securityProfileId: id, name: existing.name },
  });

  return NextResponse.json({ ok: true });
}
