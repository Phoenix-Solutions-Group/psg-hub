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
const RIVERSIDE_PREVIEW_DEMO_EMAILS = [
  "test@psghub.me",
  "nick@phoenixsolutionsgroup.net",
] as const;

type DemoAnalyticsEnv = {
  DEMO_SHOP_EMAIL?: string;
  DEMO_REVIEWER_EMAILS?: string;
  VERCEL_ENV?: string;
};

function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

function splitEmails(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter((email) => email.length > 0);
}

function configuredDemoEmails(env: DemoAnalyticsEnv | NodeJS.ProcessEnv) {
  return new Set([
    ...RIVERSIDE_PREVIEW_DEMO_EMAILS,
    normalizeEmail(env.DEMO_SHOP_EMAIL),
    ...splitEmails(env.DEMO_REVIEWER_EMAILS),
  ]);
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

  const allowedDemoEmails = configuredDemoEmails(runtimeEnv);
  const isAllowedDemoLogin = allowedDemoEmails.has(normalizeEmail(userEmail));
  const isLegacyDemoShop = isLegacyDemoAnalyticsShopName(activeShopName);

  return isAllowedDemoLogin && isLegacyDemoShop;
}
