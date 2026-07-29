export type DemoAnalyticsShop = {
  id: string;
  name: string;
};

export const RIVERSIDE_DEMO_SHOP_NAME = "Riverside Collision";

export function isRiversideDemoShop(shop: Pick<DemoAnalyticsShop, "name">): boolean {
  return shop.name.trim().toLowerCase() === RIVERSIDE_DEMO_SHOP_NAME.toLowerCase();
}

export function resolveDemoAnalyticsShopId({
  shops,
  activeShopId,
  scopeAll,
}: {
  shops: DemoAnalyticsShop[];
  activeShopId: string | null;
  scopeAll: boolean;
}): string | null {
  if (scopeAll) return activeShopId;
  return shops.find(isRiversideDemoShop)?.id ?? activeShopId;
}

export function isRiversideDemoAnalyticsContext({
  shops,
  activeShopId,
  scopeAll,
}: {
  shops: DemoAnalyticsShop[];
  activeShopId: string | null;
  scopeAll: boolean;
}): boolean {
  if (scopeAll || !activeShopId) return false;
  return shops.some((shop) => shop.id === activeShopId && isRiversideDemoShop(shop));
}
