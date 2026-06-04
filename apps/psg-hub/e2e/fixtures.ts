import path from "node:path";

/**
 * Shared E2E fixture definitions. Membership UUIDs are dynamic (auth.admin
 * createUser returns them at seed time), so fixtures are seeded programmatically
 * in global.setup.ts — there is no static seed.sql for these rows.
 */

export const PASSWORD = "e2e-Test-Password-123";

export const AUTH_DIR = path.join(__dirname, ".auth");
export const SHOTS_DIR = path.join(__dirname, "screenshots");

// 1-shop owner — drives auth.spec + customer.spec.
export const OWNER = {
  email: "owner@e2e.test",
  statePath: path.join(AUTH_DIR, "owner.json"),
  shopName: "E2E Owner Auto Body",
};

// 2-shop user (owner of A, viewer of B) — drives shop-switch.spec.
export const MULTI = {
  email: "multi@e2e.test",
  statePath: path.join(AUTH_DIR, "multi.json"),
  shopA: "E2E Multi Shop A",
  shopB: "E2E Multi Shop B",
};

// Every fixture shop name (used by the idempotent cleanup before re-seeding).
export const FIXTURE_SHOP_NAMES = [OWNER.shopName, MULTI.shopA, MULTI.shopB];
export const FIXTURE_EMAILS = [OWNER.email, MULTI.email];
