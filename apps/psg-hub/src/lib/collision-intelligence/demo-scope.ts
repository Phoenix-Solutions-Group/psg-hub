import type { UserShop } from "@/lib/shop/context";

const DEMO_ACCOUNT_EMAIL = "test@psghub.me";
const RIVERSIDE_NAME = "riverside collision";
const SOUTH_LINCOLN_NAME = "south lincoln";

export type CollisionDemoScope = {
  sourceShopIds: string[];
  primaryShopId: string;
  displayName: string;
};

export function resolveCollisionDemoScope(
  email: string | null | undefined,
  shops: UserShop[],
): CollisionDemoScope | null {
  if (email?.trim().toLowerCase() !== DEMO_ACCOUNT_EMAIL) return null;

  const riverside = shops.find(
    (shop) => shop.name.trim().toLowerCase() === RIVERSIDE_NAME,
  );
  const southLincoln = shops.find(
    (shop) => shop.name.trim().toLowerCase() === SOUTH_LINCOLN_NAME,
  );
  if (!riverside || !southLincoln) return null;

  return {
    sourceShopIds: [riverside.id, southLincoln.id],
    primaryShopId: southLincoln.id,
    displayName: "Riverside Collision Demo",
  };
}
