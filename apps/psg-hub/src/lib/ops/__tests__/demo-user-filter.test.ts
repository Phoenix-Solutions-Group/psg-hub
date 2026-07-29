import { describe, expect, it } from "vitest";
import {
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
        displayName: "Seed test",
        email: "seed-test-1785254167845@example.com",
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
});
