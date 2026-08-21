import { describe, expect, it } from "vitest";
import { resolveCollisionDemoScope } from "../demo-scope";

const shops = [
  { id: "riverside", name: "Riverside Collision", role: "owner" },
  { id: "south-lincoln", name: "South Lincoln", role: "owner" },
];

describe("collision demo scope", () => {
  it("combines only the authorized demo account memberships", () => {
    expect(resolveCollisionDemoScope("test@psghub.me", shops)).toEqual({
      sourceShopIds: ["riverside", "south-lincoln"],
      primaryShopId: "south-lincoln",
      displayName: "Riverside Collision Demo",
    });
    expect(resolveCollisionDemoScope("customer@example.com", shops)).toBeNull();
    expect(
      resolveCollisionDemoScope("test@psghub.me", shops.slice(0, 1)),
    ).toBeNull();
  });
});
