export const RIVERSIDE_ANALYTICS_DEMO_SHOP = {
  name: "Riverside Collision",
  slug: "riverside-collision",
} as const;

const RIVERSIDE_ANALYTICS_DEMO_EMAILS = [
  "owner@e2e.test",
  "owner@riversidecollision.example",
  "test@psghub.me",
  "nick@phoenixsolutionsgroup.net",
] as const;
const RIVERSIDE_ANALYTICS_DEMO_HOSTS = ["hub.psgweb.me"] as const;

type RiversideAnalyticsDemoEnv = {
  DEMO_SHOP_EMAIL?: string;
  DEMO_REVIEWER_EMAILS?: string;
  VERCEL_URL?: string;
  VERCEL_ENV?: string;
};

type RiversideAnalyticsDemoShop = {
  id: string;
  name: string;
};

export type SupabaseShopLookup = {
  from(table: "shops"): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown }>;
      };
    };
  };
};

type ShouldUseRiversideAnalyticsPreviewFallbackArgs = {
  userEmail?: string | null;
  requestHost?: string | null;
  env?: RiversideAnalyticsDemoEnv | NodeJS.ProcessEnv;
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

function configuredDemoEmails(env: RiversideAnalyticsDemoEnv | NodeJS.ProcessEnv) {
  return new Set([
    ...RIVERSIDE_ANALYTICS_DEMO_EMAILS,
    normalizeEmail(env.DEMO_SHOP_EMAIL),
    ...splitEmails(env.DEMO_REVIEWER_EMAILS),
  ]);
}

function normalizeHost(host?: string | null): string {
  return (
    (host ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0] ?? ""
  );
}

function isPsgVercelPreviewHost(host?: string | null): boolean {
  const normalized = normalizeHost(host);
  return normalized.startsWith("psg-") && normalized.endsWith(".vercel.app");
}

function isRiversideDemoHost(host?: string | null): boolean {
  const normalized = normalizeHost(host);
  return RIVERSIDE_ANALYTICS_DEMO_HOSTS.includes(
    normalized as (typeof RIVERSIDE_ANALYTICS_DEMO_HOSTS)[number]
  );
}

function isPreviewRuntime(
  env: RiversideAnalyticsDemoEnv | NodeJS.ProcessEnv,
  requestHost?: string | null
): boolean {
  return (
    env.VERCEL_ENV === "preview" ||
    isPsgVercelPreviewHost(env.VERCEL_URL) ||
    isPsgVercelPreviewHost(requestHost) ||
    isRiversideDemoHost(requestHost)
  );
}

export function shouldUseRiversideAnalyticsPreviewFallback({
  userEmail,
  requestHost,
  env,
}: ShouldUseRiversideAnalyticsPreviewFallbackArgs): boolean {
  const runtimeEnv = env ?? process.env;
  if (!isPreviewRuntime(runtimeEnv, requestHost)) return false;

  const normalizedUserEmail = normalizeEmail(userEmail);
  return (
    normalizedUserEmail.length > 0 &&
    configuredDemoEmails(runtimeEnv).has(normalizedUserEmail)
  );
}

export async function getRiversideAnalyticsPreviewShop(
  service: unknown,
  args: ShouldUseRiversideAnalyticsPreviewFallbackArgs
): Promise<RiversideAnalyticsDemoShop | null> {
  if (!shouldUseRiversideAnalyticsPreviewFallback(args)) return null;

  const shopLookup = service as SupabaseShopLookup;
  const { data } = await shopLookup
    .from("shops")
    .select("id, name")
    .eq("slug", RIVERSIDE_ANALYTICS_DEMO_SHOP.slug)
    .maybeSingle();
  const fallbackShop = data as { id?: unknown; name?: unknown } | null;

  if (typeof fallbackShop?.id !== "string") return null;

  return {
    id: fallbackShop.id,
    name:
      typeof fallbackShop.name === "string" && fallbackShop.name.trim()
        ? fallbackShop.name
        : RIVERSIDE_ANALYTICS_DEMO_SHOP.name,
  };
}
