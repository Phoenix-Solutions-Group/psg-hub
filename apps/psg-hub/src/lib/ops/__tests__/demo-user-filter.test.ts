import { describe, expect, it } from "vitest";
import {
  filterCleanDemoCompanies,
  filterCleanDemoShopMemberships,
  filterCleanDemoShops,
  filterCleanDemoUsers,
  filterInternalDemoUsers,
  isInternalDemoUser,
  shouldUseCleanDemoVisibility,
} from "@/lib/ops/demo-user-filter";

describe("demo user filter", () => {
  it("hides obvious internal seed and QA accounts from the board demo list", () => {
    expect(
      isInternalDemoUser({
        displayName: "QA Mail-Artwork PSG-884",
        email: null,
      })
    ).toBe(true);
    expect(
      isInternalDemoUser({
        displayName: "Seed test",
        email: "qa-test-psg879-1783544687549@psgweb.me",
      })
    ).toBe(true);
    expect(
      isInternalDemoUser({
        displayName: "PSG 2289 test",
        email: "psg2289-1785254167845@example.com",
      })
    ).toBe(true);
    expect(
      isInternalDemoUser({
        displayName: "Seed test",
        email: "qa-regression-psg2289@psgweb.me",
      })
    ).toBe(true);
    expect(
      isInternalDemoUser({
        displayName: "Tess QA board demo check",
        email: "tess.qa.board-demo@psgweb.me",
      })
    ).toBe(true);
    expect(
      isInternalDemoUser({
        displayName: "Seed test",
        email: "seed-test-1785254167845@example.com",
      })
    ).toBe(true);
    expect(
      isInternalDemoUser({
        displayName: "Setup user",
        email: "setup@psghub.me",
      })
    ).toBe(true);
    expect(
      isInternalDemoUser({
        displayName: "Deleted setup account",
        email: "owner@riversidecollision.example",
        isDeleted: true,
      })
    ).toBe(true);
  });

  it("keeps realistic Riverside and PSG staff users visible", () => {
    const users = [
      {
        displayName: "Riverside Collision Owner",
        email: "owner@riversidecollision.example",
      },
      {
        displayName: "Nick Schoolcraft",
        email: "nick@phoenixsolutionsgroup.net",
      },
      {
        displayName: "QA Mail-Artwork PSG-884",
        email: "qa-mail-artwork@e2e.test",
      },
    ];

    expect(filterInternalDemoUsers(users)).toEqual(users.slice(0, 2));
  });

  it("uses clean demo visibility only for the demo operator login", () => {
    const env = {
      DEMO_OPERATOR_EMAIL: "board-admin@example.test",
      DEMO_SHOP_EMAIL: "board-shop@example.test",
    };

    expect(shouldUseCleanDemoVisibility("admin@psghub.me", env)).toBe(true);
    expect(shouldUseCleanDemoVisibility("board-admin@example.test", env)).toBe(true);
    expect(shouldUseCleanDemoVisibility("nick@phoenixsolutionsgroup.net", env)).toBe(false);
  });

  it("uses seeded local demo users when the app points at the local test database", () => {
    const env = {
      DEMO_OPERATOR_EMAIL: "admin@psghub.me",
      DEMO_SHOP_EMAIL: "test@psghub.me",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    };

    expect(shouldUseCleanDemoVisibility("ops-staff@e2e.test", env)).toBe(true);
  });

  it("keeps only the two demo users for the demo operator", () => {
    const users = [
      {
        displayName: "BSM Demo Admin",
        email: "admin@psghub.me",
      },
      {
        displayName: "BSM Demo User",
        email: "test@psghub.me",
      },
      {
        displayName: "Nick Schoolcraft",
        email: "nick@phoenixsolutionsgroup.net",
      },
      {
        displayName: "Claire Static",
        email: "claire@static-solutions.com",
      },
    ];

    expect(filterCleanDemoUsers(users, "admin@psghub.me")).toEqual(users.slice(0, 2));
    expect(filterCleanDemoUsers(users, "nick@phoenixsolutionsgroup.net")).toEqual(users);
  });

  it("keeps explicitly allowed local demo users even when their emails look like test fixtures", () => {
    const env = {
      DEMO_OPERATOR_EMAIL: "ops-staff@e2e.test",
      DEMO_SHOP_EMAIL: "owner@e2e.test",
    };
    const users = [
      {
        displayName: "BSM Demo Admin",
        email: "ops-staff@e2e.test",
      },
      {
        displayName: "BSM Demo User",
        email: "owner@e2e.test",
      },
      {
        displayName: "E2E Multi User",
        email: "multi@e2e.test",
      },
      {
        displayName: "Nick Schoolcraft",
        email: "nick@phoenixsolutionsgroup.net",
      },
    ];

    expect(filterCleanDemoUsers(users, "ops-staff@e2e.test", env)).toEqual(users.slice(0, 2));
  });

  it("keeps only Riverside shop and company options for the demo operator", () => {
    const shops = [
      { id: "shop-1", name: "Riverside Collision", slug: "riverside-collision" },
      { id: "shop-2", name: "Collision Leaders of Derby", slug: "collision-leaders" },
      { id: "shop-3", name: "PSG-836 smoke-test", slug: "psg-836-smoke-test" },
    ];
    const companies = [
      { id: "company-1", name: "Riverside Collision" },
      { id: "company-2", name: "Collision Leaders of Derby" },
      { id: "company-3", name: "PSG-836 smoke-test" },
    ];

    expect(filterCleanDemoShops(shops, "admin@psghub.me")).toEqual([shops[0]]);
    expect(filterCleanDemoCompanies(companies, "admin@psghub.me")).toEqual([companies[0]]);
    expect(filterCleanDemoShops(shops, "nick@phoenixsolutionsgroup.net")).toEqual(shops);
    expect(filterCleanDemoCompanies(companies, "nick@phoenixsolutionsgroup.net")).toEqual(companies);
  });

  it("keeps only Riverside shop memberships for the demo operator", () => {
    const shops = [
      { id: "shop-1", name: "Riverside Collision", slug: "riverside-collision" },
      { id: "shop-2", name: "Collision Leaders of Derby", slug: "collision-leaders" },
    ];
    const memberships = [
      { userId: "demo-user", shopId: "shop-1", role: "owner" },
      { userId: "demo-user", shopId: "shop-2", role: "manager" },
    ];

    expect(filterCleanDemoShopMemberships(memberships, shops, "admin@psghub.me")).toEqual([
      memberships[0],
    ]);
    expect(
      filterCleanDemoShopMemberships(memberships, shops, "nick@phoenixsolutionsgroup.net")
    ).toEqual(memberships);
  });
});
