export const RIVERSIDE_ANALYTICS_DEMO_SHOP = {
  name: "Riverside Collision",
  slug: "riverside-collision",
} as const;

const RIVERSIDE_ANALYTICS_DEMO_EMAILS = ["test@psghub.me"] as const;

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

function configuredDemoEmails(env: RiversideAnalyticsDemoEnv | NodeJS.ProcessEnv) {
  return new Set([
    ...RIVERSIDE_ANALYTICS_DEMO_EMAILS,
    normalizeEmail(env.DEMO_SHOP_EMAIL),
  ]);
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

  const normalizedUserEmail = normalizeEmail(userEmail);
  return (
    normalizedUserEmail.length > 0 &&
    configuredDemoEmails(runtimeEnv).has(normalizedUserEmail)
  );
}
