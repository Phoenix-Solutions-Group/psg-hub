import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { GRANT_ROLES, GRANT_EFFECTS } from "@/lib/ops/modules";

// Module access-matrix grants — role scope (v1.5 / PSG-29). Superadmin-only.
//
// The editable grid manages ROLE-scope grants (allow/deny per role). Profile-
// and shop-scope overrides are resolved per-user at read time by
// resolveModuleAccess() and are intentionally not part of this grid surface.
//
// We delete-then-insert rather than upsert: the (module_id, role) uniqueness is
// a PARTIAL unique index (… where role is not null), which PostgREST cannot use
// as an ON CONFLICT arbiter without a predicate. One grant per (module, role)
// is preserved by clearing first.

const setSchema = z.object({
  moduleId: z.string().uuid(),
  role: z.enum(GRANT_ROLES),
  effect: z.enum(GRANT_EFFECTS),
});

const clearSchema = z.object({
  moduleId: z.string().uuid(),
  role: z.enum(GRANT_ROLES),
});

async function ensureModule(service: ReturnType<typeof createServiceClient>, moduleId: string) {
  const { data } = await service.from("modules").select("id, slug").eq("id", moduleId).maybeSingle();
  return data;
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = setSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { moduleId, role, effect } = parsed.data;

  const service = createServiceClient();
  const mod = await ensureModule(service, moduleId);
  if (!mod) return NextResponse.json({ error: "Module not found" }, { status: 404 });

  // Replace any existing role grant for this (module, role).
  const { error: delError } = await service
    .from("module_access_grants")
    .delete()
    .eq("module_id", moduleId)
    .eq("role", role);
  if (delError) {
    console.error("[api/ops/modules/grants POST] clear failed:", delError.message);
    return NextResponse.json({ error: "Failed to set grant" }, { status: 500 });
  }

  const { data, error } = await service
    .from("module_access_grants")
    .insert({
      module_id: moduleId,
      role,
      effect,
      granted_by: gate.userId,
    })
    .select("id, module_id, role, effect")
    .single();
  if (error) {
    console.error("[api/ops/modules/grants POST] insert failed:", error.message);
    return NextResponse.json({ error: "Failed to set grant" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: effect === "allow" ? "module_access.grant" : "module_access.deny",
    payload: { moduleId, slug: mod.slug, scope: "role", role, effect },
  });

  return NextResponse.json({ grant: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = clearSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { moduleId, role } = parsed.data;

  const service = createServiceClient();
  const mod = await ensureModule(service, moduleId);
  if (!mod) return NextResponse.json({ error: "Module not found" }, { status: 404 });

  const { error } = await service
    .from("module_access_grants")
    .delete()
    .eq("module_id", moduleId)
    .eq("role", role);
  if (error) {
    console.error("[api/ops/modules/grants DELETE] failed:", error.message);
    return NextResponse.json({ error: "Failed to clear grant" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "module_access.clear",
    payload: { moduleId, slug: mod.slug, scope: "role", role },
  });

  return NextResponse.json({ ok: true });
}
