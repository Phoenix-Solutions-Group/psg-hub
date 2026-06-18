import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  MODULE_AUDIENCES,
  MODULE_TIERS,
  MODULE_VISIBILITIES,
  normalizeModuleSlug,
  normalizeDisplayName,
} from "@/lib/ops/modules";

// Module registry API (v1.5 / PSG-29). Superadmin-only — matches the RLS on
// `modules` (modules_write_superadmin). Writes go via service-role; every
// mutation records an access_audit row on success.

const createSchema = z.object({
  slug: z.string().trim().min(2).max(60),
  displayName: z.string().trim().min(1).max(80),
  audience: z.enum(MODULE_AUDIENCES).default("customer"),
  minTier: z.enum(MODULE_TIERS).nullable().default(null),
  defaultVisibility: z.enum(MODULE_VISIBILITIES).default("visible"),
});

export async function GET() {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const service = createServiceClient();
  const [{ data: modules, error: modErr }, { data: grants, error: grantErr }] =
    await Promise.all([
      service
        .from("modules")
        .select("id, slug, display_name, audience, min_tier_slug, default_visibility")
        .order("display_name", { ascending: true }),
      service
        .from("module_access_grants")
        .select("id, module_id, profile_id, shop_id, role, effect"),
    ]);

  if (modErr || grantErr) {
    console.error("[api/ops/modules GET] query failed:", (modErr ?? grantErr)?.message);
    return NextResponse.json({ error: "Failed to load modules" }, { status: 500 });
  }
  return NextResponse.json({ modules: modules ?? [], grants: grants ?? [] });
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const slug = normalizeModuleSlug(parsed.data.slug);
  const displayName = normalizeDisplayName(parsed.data.displayName);
  if (!slug) return NextResponse.json({ error: "Invalid slug" }, { status: 422 });
  if (!displayName) return NextResponse.json({ error: "Invalid display name" }, { status: 422 });

  const service = createServiceClient();
  const { data, error } = await service
    .from("modules")
    .insert({
      slug,
      display_name: displayName,
      audience: parsed.data.audience,
      min_tier_slug: parsed.data.minTier,
      default_visibility: parsed.data.defaultVisibility,
    })
    .select("id, slug, display_name, audience, min_tier_slug, default_visibility")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A module with that slug already exists" }, { status: 409 });
    }
    console.error("[api/ops/modules POST] insert failed:", error.message);
    return NextResponse.json({ error: "Failed to create module" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "module.visibility.set",
    payload: {
      op: "create",
      moduleId: data.id,
      slug,
      audience: data.audience,
      minTier: data.min_tier_slug,
      visibility: data.default_visibility,
    },
  });

  return NextResponse.json({ module: data }, { status: 201 });
}
