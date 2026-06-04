import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export type AppRole = "customer" | "psg_internal" | "psg_superadmin";

export type DashboardAccess = {
  role: AppRole | null;
  shopIds: string[];
};

/**
 * Resolve a user's global role + shop memberships for the dashboard gate.
 *
 * Uses the SERVICE-ROLE client: app_user_roles and shop_users are RLS-on with
 * no anon/authenticated policy (default-deny, 06-02), so only service-role can
 * read them. The private.current_user_*() resolvers are NOT PostgREST-exposed,
 * so we query the tables directly here. Server-only (service.ts is "server-only").
 */
export async function getDashboardAccess(userId: string): Promise<DashboardAccess> {
  const service = createServiceClient();

  const [{ data: roleRow }, { data: memberships }] = await Promise.all([
    service.from("app_user_roles").select("role").eq("profile_id", userId).maybeSingle(),
    service.from("shop_users").select("shop_id").eq("user_id", userId),
  ]);

  const role = (roleRow?.role as AppRole | undefined) ?? null;
  const shopIds = (memberships ?? []).map((m) => m.shop_id as string);

  return { role, shopIds };
}

/**
 * Pure gate decision (no DB) — unit-testable.
 * Staff (psg_internal / psg_superadmin) always pass, shop-independent.
 * Everyone else (customer / null role) passes only with at least one shop.
 */
export function decideDashboardAccess(access: DashboardAccess): "pass" | "no-shop" {
  const isStaff = access.role === "psg_internal" || access.role === "psg_superadmin";
  if (isStaff) return "pass";
  return access.shopIds.length > 0 ? "pass" : "no-shop";
}
