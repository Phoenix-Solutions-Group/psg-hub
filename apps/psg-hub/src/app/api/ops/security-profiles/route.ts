import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { OPS_FUNCTIONS } from "@/lib/auth/ops-access";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { buildFunctionsJsonb, normalizeProfileName } from "@/lib/ops/security-profiles";

// Named security-profile catalog API (v1.1 / PSG-39). Superadmin-only — matches
// the RLS on security_profile_defs. Writes go via service-role; every mutation
// records an access_audit row on success.

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // capability keys to grant; unknown keys are dropped by buildFunctionsJsonb.
  functions: z.array(z.enum(OPS_FUNCTIONS)).default([]),
});

export async function GET() {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const service = createServiceClient();
  const { data, error } = await service
    .from("security_profile_defs")
    .select("id, name, is_builtin, functions_jsonb, created_at, updated_at")
    .order("is_builtin", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    console.error("[api/ops/security-profiles GET] query failed:", error.message);
    return NextResponse.json({ error: "Failed to load security profiles" }, { status: 500 });
  }
  return NextResponse.json({ profiles: data ?? [] });
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

  const name = normalizeProfileName(parsed.data.name);
  if (!name) {
    return NextResponse.json({ error: "Invalid profile name" }, { status: 422 });
  }
  const functions_jsonb = buildFunctionsJsonb(parsed.data.functions);

  const service = createServiceClient();
  const { data, error } = await service
    .from("security_profile_defs")
    .insert({ name, is_builtin: false, functions_jsonb })
    .select("id, name, is_builtin, functions_jsonb")
    .single();

  if (error) {
    // 23505 = unique_violation on the name.
    if (error.code === "23505") {
      return NextResponse.json({ error: "A profile with that name already exists" }, { status: 409 });
    }
    console.error("[api/ops/security-profiles POST] insert failed:", error.message);
    return NextResponse.json({ error: "Failed to create security profile" }, { status: 500 });
  }

  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "security_profile_def.create",
    payload: { securityProfileId: data.id, name, functions_jsonb },
  });

  return NextResponse.json({ profile: data }, { status: 201 });
}
