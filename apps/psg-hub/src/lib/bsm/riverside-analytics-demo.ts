export const RIVERSIDE_ANALYTICS_DEMO_SHOP = {
  name: "Riverside Collision",
  slug: "riverside-collision",
} as const;

const RIVERSIDE_ANALYTICS_DEMO_EMAILS = ["test@psghub.me"] as const;

type RiversideAnalyticsDemoEnv = {
  DEMO_SHOP_EMAIL?: string;
  VERCEL_URL?: string;
  VERCEL_ENV?: string;
};

type ShouldUseRiversideAnalyticsPreviewFallbackArgs = {
  userEmail?: string | null;
  activeShopName?: string | null;
  requestHost?: string | null;
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

function normalizeHost(host?: string | null): string {
  return (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0] ?? "";
}

function isPsgVercelPreviewHost(host?: string | null): boolean {
  const normalized = normalizeHost(host);
  return normalized.startsWith("psg-") && normalized.endsWith(".vercel.app");
}

function isPreviewRuntime(
  env: RiversideAnalyticsDemoEnv | NodeJS.ProcessEnv,
  requestHost?: string | null
): boolean {
  return (
    env.VERCEL_ENV === "preview" ||
    isPsgVercelPreviewHost(env.VERCEL_URL) ||
    isPsgVercelPreviewHost(requestHost)
  );
}

export function shouldUseRiversideAnalyticsPreviewFallback({
  userEmail,
  activeShopName,
  requestHost,
  env,
}: ShouldUseRiversideAnalyticsPreviewFallbackArgs): boolean {
  const runtimeEnv = env ?? process.env;
  if (!isPreviewRuntime(runtimeEnv, requestHost)) return false;
  if (activeShopName === RIVERSIDE_ANALYTICS_DEMO_SHOP.name) return false;

  const normalizedUserEmail = normalizeEmail(userEmail);
  return (
    normalizedUserEmail.length > 0 &&
    configuredDemoEmails(runtimeEnv).has(normalizedUserEmail)
  );
}
