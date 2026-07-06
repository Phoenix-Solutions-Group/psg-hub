import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { AppRole } from "@/lib/auth/shop-access";

/**
 * v1.1 Ops Foundation — fine-grained ops capability gate. [PSG-25]
 *
 * Mirrors the in-DB private.current_user_has_fn() check (rbac_helpers + the
 * 15-00 ops-foundation migration) in application code, so /ops/* pages and
 * /api ops routes can fail closed BEFORE hitting RLS. RLS remains the
 * authoritative backstop; this is defense-in-depth + better UX (403 vs empty).
 *
 * A capability is granted when the user is:
 *   - psg_superadmin (passes every check), or
 *   - psg_internal AND the capability key is present in EITHER the legacy
 *     per-user security_profiles.functions_jsonb (06-02 fast-path) OR any
 *     assigned named security_profile_defs.functions_jsonb (v1.1).
 */

/** Canonical ops capability vocabulary (keep in sync with the migration policies). */
export const OPS_FUNCTIONS = [
  "manage_companies",
  "manage_sysconfig",
  "manage_users",
  "manage_reports",
  "manage_production",
  // v1.2 Ads Mutation Studio (PSG-26 / PSG-26a). Gates the /ops/ads-mutations
  // surface + /api/ads-mutations/* routes. psg_superadmin passes implicitly;
  // psg_internal needs this flag granted. The matching in-DB policy/migration is
  // tracked on the parent (PSG-26) — app-level is defense-in-depth ahead of RLS.
  "ads_mutations",
  // Sales Pipeline review (PSG-594). Gates the /ops/sales-pipeline page + the
  // /api/ops/sales-pipeline export route (board access to open-pipeline-$). Mirrors
  // the in-DB `pipedrive_deals` / `pipedrive_sync_runs` SELECT policies
  // (private.current_user_has_fn('view_sales_pipeline'), PSG-434 migration).
  // psg_superadmin passes implicitly; a psg_internal user needs this flag granted.
  "view_sales_pipeline",
] as const;

export type OpsFunction = (typeof OPS_FUNCTIONS)[number];

export type OpsAccess = {
  role: AppRole | null;
  /** Effective capability keys (union of legacy per-user + assigned named profiles). */
  functions: Set<string>;
};

/**
 * Pure decision (no DB) — unit-testable.
 * psg_superadmin passes every capability. psg_internal passes only capabilities
 * present in their effective function set. Everyone else fails closed.
 */
export function hasOpsFn(access: OpsAccess, fn: OpsFunction): boolean {
  if (access.role === "psg_superadmin") return true;
  if (access.role === "psg_internal") return access.functions.has(fn);
  return false;
}

/** True for any user who may see the /ops shell at all (psg_internal or above). */
export function isOpsStaff(role: AppRole | null): boolean {
  return role === "psg_internal" || role === "psg_superadmin";
}

/**
 * Resolve a user's ops role + effective capability set via the service-role
 * client. app_user_roles / security_profiles / security_profile_defs /
 * user_security_profile_assignments are default-deny (service-role only),
 * matching getDashboardAccess()'s approach in shop-access.ts.
 */
export async function getOpsAccess(userId: string): Promise<OpsAccess> {
  const service = createServiceClient();

  const [{ data: roleRow }, { data: legacy }, { data: assignments }] =
    await Promise.all([
      service.from("app_user_roles").select("role").eq("profile_id", userId).maybeSingle(),
      service
        .from("security_profiles")
        .select("functions_jsonb")
        .eq("profile_id", userId)
        .maybeSingle(),
      service
        .from("user_security_profile_assignments")
        .select("security_profile_defs(functions_jsonb)")
        .eq("profile_id", userId),
    ]);

  const role = (roleRow?.role as AppRole | undefined) ?? null;
  const functions = new Set<string>();

  // Legacy per-user fast-path.
  collectTrueKeys(legacy?.functions_jsonb, functions);

  // Assigned named profiles.
  for (const row of assignments ?? []) {
    // Supabase returns the embedded relation as an object (or array on some shapes).
    const def = (row as Record<string, unknown>).security_profile_defs;
    const defs = Array.isArray(def) ? def : def ? [def] : [];
    for (const d of defs) {
      collectTrueKeys((d as { functions_jsonb?: unknown }).functions_jsonb, functions);
    }
  }

  return { role, functions };
}

/** Add every key whose value is truthy in a functions_jsonb object into `out`. */
function collectTrueKeys(jsonb: unknown, out: Set<string>): void {
  if (jsonb && typeof jsonb === "object" && !Array.isArray(jsonb)) {
    for (const [key, value] of Object.entries(jsonb as Record<string, unknown>)) {
      if (value) out.add(key);
    }
  }
}

export type RequireOpsResult =
  | { ok: true; userId: string; access: OpsAccess }
  | { ok: false; response: NextResponse };

/**
 * Route guard for /api ops handlers. Returns the authenticated user + access on
 * success, or a ready-to-return 401/403 NextResponse on failure. Usage:
 *
 *   const gate = await requireOpsFn("manage_companies");
 *   if (!gate.ok) return gate.response;
 */
export async function requireOpsFn(fn: OpsFunction): Promise<RequireOpsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, fn)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true, userId: user.id, access };
}

/**
 * Route guard for superadmin-only handlers (e.g. the security-profile catalog /
 * assignment surface, PSG-39). Managing capability bundles is a
 * privilege-escalation surface, so it is gated at psg_superadmin to match the
 * RLS on security_profile_defs / user_security_profile_assignments — a
 * manage_users-capable psg_internal must NOT reach it (service-role writes would
 * otherwise bypass RLS). Returns the authenticated superadmin's id on success.
 */
export async function requireSuperadmin(): Promise<RequireOpsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true, userId: user.id, access };
}
