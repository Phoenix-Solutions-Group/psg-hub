import "server-only";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";

export const ACTIVE_SHOP_COOKIE = "psg_active_shop";

export type UserShop = { id: string; name: string; role: string };

/**
 * A user's shop memberships (id + name + role). Service-role read: shop_users is
 * RLS default-deny (06-02), so only service-role can enumerate memberships here.
 */
export async function getUserShops(userId: string): Promise<UserShop[]> {
  const service = createServiceClient();

  const { data } = await service
    .from("shop_users")
    .select("shop_id, role, shops(name)")
    .eq("user_id", userId);

  return (data ?? []).map((row) => {
    // The embedded `shops` relation comes back as an object (or array under some
    // PostgREST shapes) — normalize the same defensive way settings/page.tsx does.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shopsRel = row.shops as any;
    const shop = Array.isArray(shopsRel) ? shopsRel[0] : shopsRel;
    return {
      id: row.shop_id as string,
      name: (shop?.name as string | undefined) ?? "",
      role: row.role as string,
    };
  });
}

/**
 * Pure active-shop resolution. The cookie SELECTS among already-authorized
 * shops — it never authorizes. Re-validated against the CURRENT membership set
 * on every call, so a stale cookie (a shop the user no longer belongs to) can
 * never select that shop.
 */
export function resolveActiveShop(
  shops: UserShop[],
  cookieValue: string | null | undefined
): string | null {
  if (shops.length === 0) return null;
  if (cookieValue && shops.some((s) => s.id === cookieValue)) {
    return cookieValue;
  }
  const owner = shops.find((s) => s.role === "owner");
  return (owner ?? shops[0]).id;
}

/**
 * Server-side active-shop context for the app shell + customer pages. Reads the
 * cookie, resolves it against current membership, returns the shops + active id.
 */
export async function getActiveShopContext(
  userId: string
): Promise<{ shops: UserShop[]; activeShopId: string | null }> {
  const shops = await getUserShops(userId);
  const cookieValue = (await cookies()).get(ACTIVE_SHOP_COOKIE)?.value;
  return { shops, activeShopId: resolveActiveShop(shops, cookieValue) };
}
