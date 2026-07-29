export type DemoAnalyticsShop = {
  id: string;
  name: string;
};

export const RIVERSIDE_DEMO_SHOP_NAME = "Riverside Collision";
export const RIVERSIDE_DEMO_SHOP_SLUG = "riverside-collision";
const LEGACY_DEMO_SHOP_NAMES = new Set([
  "bsm demo collision center",
  "psg pilot body shop",
  "tedesco auto body",
]);

type DemoAnalyticsEnv = {
  DEMO_SHOP_EMAIL?: string;
  VERCEL_ENV?: string;
};

function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

export function isRiversideDemoShop(shop: Pick<DemoAnalyticsShop, "name">): boolean {
  return shop.name.trim().toLowerCase() === RIVERSIDE_DEMO_SHOP_NAME.toLowerCase();
}

export function isLegacyDemoAnalyticsShopName(shopName?: string | null): boolean {
  return LEGACY_DEMO_SHOP_NAMES.has((shopName ?? "").trim().toLowerCase());
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

export function shouldUseRiversidePreviewDemoFallback({
  userEmail,
  activeShopName,
  hasRiversideMembership,
  env,
}: {
  userEmail?: string | null;
  activeShopName?: string | null;
  hasRiversideMembership: boolean;
  env?: DemoAnalyticsEnv | NodeJS.ProcessEnv;
}): boolean {
  const runtimeEnv = env ?? process.env;
  if (runtimeEnv.VERCEL_ENV !== "preview") return false;
  if (hasRiversideMembership) return false;
  if (activeShopName === RIVERSIDE_DEMO_SHOP_NAME) return false;

  const configuredDemoEmail = normalizeEmail(runtimeEnv.DEMO_SHOP_EMAIL);
  const isConfiguredDemoLogin =
    configuredDemoEmail.length > 0 &&
    normalizeEmail(userEmail) === configuredDemoEmail;

  return isConfiguredDemoLogin || isLegacyDemoAnalyticsShopName(activeShopName);
}
