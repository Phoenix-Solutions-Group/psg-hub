import { describe, expect, it } from "vitest";
import {
  filterCleanDemoCompanies,
  filterCleanDemoShops,
  filterInternalDemoUsers,
  isInternalDemoUser,
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
        email: "psg2289-qa@psgweb.me",
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

  it("shows the seeded BSM shop to the local clean-demo operator", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54351" };
    const shops = [
      { id: "riverside", name: "Riverside Collision", slug: "riverside-collision" },
      { id: "local", name: "BSM Demo Collision Center", slug: "bsm-demo-collision-center" },
      { id: "test", name: "E2E Multi Shop A", slug: "e2e-multi-shop-a" },
    ];

    expect(filterCleanDemoShops(shops, "ops-staff@e2e.test", env)).toEqual([shops[1]]);
    expect(filterCleanDemoCompanies(
      shops.map((shop) => ({ name: shop.name })),
      "ops-staff@e2e.test",
      env,
    )).toEqual([{ name: "BSM Demo Collision Center" }]);
  });
});
