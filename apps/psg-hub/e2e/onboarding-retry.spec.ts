import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { OWNER } from "./fixtures";

test.use({ storageState: OWNER.statePath });

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
    throw new Error("[onboarding-retry] Refusing to run against a non-local Supabase URL.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function countRows(
  table: "clients" | "shops" | "shop_users",
  column: string,
  value: string
) {
  const { count, error } = await adminClient()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  if (error) throw new Error(`[onboarding-retry] ${table} count failed: ${error.message}`);
  return count ?? 0;
}

test("completed owner can retry onboarding without duplicate setup records", async ({ page }) => {
  const admin = adminClient();
  const { data: shop, error } = await admin
    .from("shops")
    .select("id, client_id")
    .eq("name", OWNER.shopName)
    .single();
  if (error || !shop) {
    throw new Error(`[onboarding-retry] seeded owner shop missing: ${error?.message}`);
  }

  const before = {
    shops: await countRows("shops", "name", OWNER.shopName),
    clients: await countRows("clients", "id", shop.client_id),
    memberships: await countRows("shop_users", "shop_id", shop.id),
  };

  await page.goto("/dashboard/onboarding");
  await page.getByLabel("Shop name").fill(OWNER.shopName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Complete setup" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("complementary").getByText(OWNER.shopName)).toBeVisible();

  const after = {
    shops: await countRows("shops", "name", OWNER.shopName),
    clients: await countRows("clients", "id", shop.client_id),
    memberships: await countRows("shop_users", "shop_id", shop.id),
  };
  expect(after).toEqual(before);
});
