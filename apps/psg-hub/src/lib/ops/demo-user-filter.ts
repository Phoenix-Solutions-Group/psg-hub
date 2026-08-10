type DemoUserCandidate = {
  displayName: string;
  email: string | null;
  isDeleted?: boolean;
};

type DemoShopCandidate = {
  id?: string;
  name: string;
  slug?: string | null;
};

type DemoShopMembershipCandidate = {
  shopId: string;
};

type DemoCompanyCandidate = {
  name: string;
};

type CleanDemoEnv = {
  DEMO_OPERATOR_EMAIL?: string;
  DEMO_SHOP_EMAIL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

const CLEAN_DEMO_OPERATOR_EMAILS = ["admin@psghub.me"] as const;
const CLEAN_DEMO_USER_EMAILS = ["admin@psghub.me", "test@psghub.me"] as const;
const LOCAL_CLEAN_DEMO_OPERATOR_EMAIL = "ops-staff@e2e.test";
const LOCAL_CLEAN_DEMO_SHOP_EMAIL = "owner@e2e.test";
const CLEAN_DEMO_SHOP_NAME = "Riverside Collision";
const CLEAN_DEMO_SHOP_SLUG = "riverside-collision";
const LOCAL_CLEAN_DEMO_SHOP_NAME = "BSM Demo Collision Center";
const LOCAL_CLEAN_DEMO_SHOP_SLUG = "bsm-demo-collision-center";

const TEST_EMAIL_PATTERNS = [
  /^qa-test-/i,
  /^qa[-_.+]/i,
  /^psg\d+(?:-|@)/i,
  /\bpsg\d+\b.*qa/i,
  /\bqa\b.*\bpsg\d+\b/i,
  /^[a-z0-9._%+-]*test[a-z0-9._%+-]*@example\.com$/i,
  /^psg\d+-[a-z0-9._%+-]*@example\.com$/i,
  /^setup@psghub\.me$/i,
  /@e2e\.test$/i,
];

const TEST_NAME_PATTERNS = [
  /^qa\b/i,
  /^tess qa\b/i,
  /\bpsg\d+\b.*test/i,
  /\bqa mail-artwork\b/i,
  /\bmail-artwork\b/i,
  /\be2e\b/i,
];

export function isInternalDemoUser(user: DemoUserCandidate) {
  const email = user.email?.trim() ?? "";
  const name = user.displayName.trim();

  return (
    user.isDeleted === true ||
    TEST_EMAIL_PATTERNS.some((pattern) => pattern.test(email)) ||
    TEST_NAME_PATTERNS.some((pattern) => pattern.test(name))
  );
}

export function filterInternalDemoUsers<T extends DemoUserCandidate>(users: T[]) {
  return users.filter((user) => !isInternalDemoUser(user));
}

function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

function defaultCleanDemoEnv(): CleanDemoEnv {
  return {
    DEMO_OPERATOR_EMAIL: process.env.DEMO_OPERATOR_EMAIL,
    DEMO_SHOP_EMAIL: process.env.DEMO_SHOP_EMAIL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
}

function isLocalSupabaseUrl(url?: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test((url ?? "").trim());
}

function withLocalCleanDemoDefaults(env: CleanDemoEnv): CleanDemoEnv {
  if (!isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)) return env;
  return {
    ...env,
    DEMO_OPERATOR_EMAIL: LOCAL_CLEAN_DEMO_OPERATOR_EMAIL,
    DEMO_SHOP_EMAIL: LOCAL_CLEAN_DEMO_SHOP_EMAIL,
  };
}

function cleanDemoOperatorEmails(env: CleanDemoEnv = defaultCleanDemoEnv()): Set<string> {
  const cleanEnv = withLocalCleanDemoDefaults(env);
  return new Set([
    ...CLEAN_DEMO_OPERATOR_EMAILS,
    normalizeEmail(cleanEnv.DEMO_OPERATOR_EMAIL),
  ]);
}

function cleanDemoUserEmails(env: CleanDemoEnv = defaultCleanDemoEnv()): Set<string> {
  const cleanEnv = withLocalCleanDemoDefaults(env);
  return new Set([
    ...CLEAN_DEMO_USER_EMAILS,
    normalizeEmail(cleanEnv.DEMO_OPERATOR_EMAIL),
    normalizeEmail(cleanEnv.DEMO_SHOP_EMAIL),
  ]);
}

export function shouldUseCleanDemoVisibility(
  userEmail?: string | null,
  env: CleanDemoEnv = defaultCleanDemoEnv()
): boolean {
  const normalizedUserEmail = normalizeEmail(userEmail);
  return (
    normalizedUserEmail.length > 0 &&
    cleanDemoOperatorEmails(env).has(normalizedUserEmail)
  );
}

export function filterCleanDemoUsers<T extends DemoUserCandidate>(
  users: T[],
  currentUserEmail?: string | null,
  env: CleanDemoEnv = defaultCleanDemoEnv()
): T[] {
  if (!shouldUseCleanDemoVisibility(currentUserEmail, env)) {
    return filterInternalDemoUsers(users);
  }

  const demoEmails = cleanDemoUserEmails(env);
  return users.filter((user) => demoEmails.has(normalizeEmail(user.email)));
}

function isCleanDemoShop(shop: DemoShopCandidate, env: CleanDemoEnv) {
  const name = shop.name.trim().toLowerCase();
  const slug = (shop.slug ?? "").trim().toLowerCase();
  const local = isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  return (
    name === (local ? LOCAL_CLEAN_DEMO_SHOP_NAME : CLEAN_DEMO_SHOP_NAME).toLowerCase() ||
    slug === (local ? LOCAL_CLEAN_DEMO_SHOP_SLUG : CLEAN_DEMO_SHOP_SLUG)
  );
}

export function filterCleanDemoShops<T extends DemoShopCandidate>(
  shops: T[],
  currentUserEmail?: string | null,
  env: CleanDemoEnv = defaultCleanDemoEnv()
): T[] {
  if (!shouldUseCleanDemoVisibility(currentUserEmail, env)) return shops;
  return shops.filter((shop) => isCleanDemoShop(shop, env));
}

export function filterCleanDemoShopMemberships<T extends DemoShopMembershipCandidate>(
  memberships: T[],
  visibleShops: DemoShopCandidate[],
  currentUserEmail?: string | null,
  env: CleanDemoEnv = defaultCleanDemoEnv()
): T[] {
  if (!shouldUseCleanDemoVisibility(currentUserEmail, env)) return memberships;
  const visibleShopIds = new Set(
    visibleShops
      .filter((shop) => isCleanDemoShop(shop, env))
      .map((shop) => "id" in shop && typeof shop.id === "string" ? shop.id : null)
      .filter((shopId): shopId is string => shopId !== null)
  );
  return memberships.filter((membership) => visibleShopIds.has(membership.shopId));
}

export function filterCleanDemoCompanies<T extends DemoCompanyCandidate>(
  companies: T[],
  currentUserEmail?: string | null,
  env: CleanDemoEnv = defaultCleanDemoEnv()
): T[] {
  if (!shouldUseCleanDemoVisibility(currentUserEmail, env)) return companies;
  const demoShopName = isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)
    ? LOCAL_CLEAN_DEMO_SHOP_NAME
    : CLEAN_DEMO_SHOP_NAME;
  return companies.filter(
    (company) => company.name.trim().toLowerCase() === demoShopName.toLowerCase()
  );
}
