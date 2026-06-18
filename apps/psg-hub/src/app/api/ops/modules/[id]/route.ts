import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  MODULE_AUDIENCES,
  MODULE_TIERS,
  MODULE_VISIBILITIES,
  normalizeDisplayName,
} from "@/lib/ops/modules";

// Edit / delete a module registry entry (v1.5 / PSG-29). Superadmin-only.
// Deleting a module cascades its access grants (FK on delete cascade).

const updateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    audience: z.enum(MODULE_AUDIENCES).optional(),
    minTier: z.enum(MODULE_TIERS).nullable().optional(),
    defaultVisibility: z.enum(MODULE_VISIBILITIES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No changes supplied" });

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
    .from("modules")
    .select("id, slug, display_name, audience, min_tier_slug, default_visibility")
    .eq("id", id)
    .single();
  if (loadError || !existing) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) {
    const name = normalizeDisplayName(parsed.data.displayName);
    if (!name) return NextResponse.json({ error: "Invalid display name" }, { status: 422 });
    update.display_name = name;
  }
  if (parsed.data.audience !== undefined) update.audience = parsed.data.audience;
  if (parsed.data.minTier !== undefined) update.min_tier_slug = parsed.data.minTier;
  if (parsed.data.defaultVisibility !== undefined) {
    update.default_visibility = parsed.data.defaultVisibility;
  }

  const { data, error } = await service
    .from("modules")
    .update(update)
    .eq("id", id)
    .select("id, slug, display_name, audience, min_tier_slug, default_visibility")
    .single();

  if (error) {
    console.error("[api/ops/modules PATCH] update failed:", error.message);
    return NextResponse.json({ error: "Failed to update module" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "module.visibility.set",
    payload: { op: "update", moduleId: id, slug: existing.slug, before: existing, after: data },
  });

  return NextResponse.json({ module: data });
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
    .from("modules")
    .select("id, slug, display_name")
    .eq("id", id)
    .single();
  if (loadError || !existing) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }

  const { error } = await service.from("modules").delete().eq("id", id);
  if (error) {
    console.error("[api/ops/modules DELETE] delete failed:", error.message);
    return NextResponse.json({ error: "Failed to delete module" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "module.visibility.set",
    payload: { op: "delete", moduleId: id, slug: existing.slug },
  });

  return NextResponse.json({ ok: true });
}
