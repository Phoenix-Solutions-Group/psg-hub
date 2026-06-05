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

// 9-shop owner (big MSO) — drives the 09-02 switcher-typeahead branch (>=8).
export const MEGA = {
  email: "mega@e2e.test",
  statePath: path.join(AUTH_DIR, "mega.json"),
  shopNames: Array.from({ length: 9 }, (_, i) => `E2E Mega Shop ${i + 1}`),
};

// 09-02 analytics snapshot seed. End date = "today" at module load (NOT a hard
// constant — the page reads a trailing-30-day runtime window, so a frozen date
// would rot out of range). Metric VALUES are formula-derived from the day
// index, so the data is deterministic given the run date.
export const SNAPSHOT_END_DATE = new Date().toISOString().slice(0, 10);
export const SNAPSHOT_SYNCED_AT = `${SNAPSHOT_END_DATE}T12:00:00Z`;

// Every fixture shop name (used by the idempotent cleanup before re-seeding).
export const FIXTURE_SHOP_NAMES = [
  OWNER.shopName,
  MULTI.shopA,
  MULTI.shopB,
  ...MEGA.shopNames,
];
export const FIXTURE_EMAILS = [OWNER.email, MULTI.email, MEGA.email];
