export const RIVERSIDE_ANALYTICS_DEMO_SHOP = {
  name: "Riverside Collision",
  slug: "riverside-collision",
} as const;

type RiversideAnalyticsDemoEnv = {
  DEMO_SHOP_EMAIL?: string;
  VERCEL_ENV?: string;
};

type ShouldUseRiversideAnalyticsPreviewFallbackArgs = {
  userEmail?: string | null;
  activeShopName?: string | null;
  hasRiversideMembership: boolean;
  env?: RiversideAnalyticsDemoEnv | NodeJS.ProcessEnv;
};

function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

export function shouldUseRiversideAnalyticsPreviewFallback({
  userEmail,
  activeShopName,
  hasRiversideMembership,
  env,
}: ShouldUseRiversideAnalyticsPreviewFallbackArgs): boolean {
  const runtimeEnv = env ?? process.env;
  if (runtimeEnv.VERCEL_ENV !== "preview") return false;
  if (hasRiversideMembership) return false;
  if (activeShopName === RIVERSIDE_ANALYTICS_DEMO_SHOP.name) return false;

  const configuredDemoEmail = normalizeEmail(runtimeEnv.DEMO_SHOP_EMAIL);
  return (
    configuredDemoEmail.length > 0 &&
    normalizeEmail(userEmail) === configuredDemoEmail
  );
}
