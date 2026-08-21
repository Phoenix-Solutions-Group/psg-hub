import { describe, expect, it } from "vitest";
import {
  resolveCollisionDemoScope,
  resolveCollisionDemoShopContext,
} from "../demo-scope";

const shops = [
  { id: "riverside", name: "Riverside Collision", role: "owner" },
  { id: "south-lincoln", name: "South Lincoln", role: "owner" },
];

describe("collision demo scope", () => {
  it("combines only the authorized demo and admin account memberships", () => {
    expect(resolveCollisionDemoScope("test@psghub.me", shops)).toEqual({
      sourceShopIds: ["riverside", "south-lincoln"],
      primaryShopId: "south-lincoln",
      displayName: "Riverside Collision Demo",
    });
    expect(resolveCollisionDemoScope("admin@psghub.me", shops)).toEqual({
      sourceShopIds: ["riverside", "south-lincoln"],
      primaryShopId: "south-lincoln",
      displayName: "Riverside Collision Demo",
    });
    expect(resolveCollisionDemoScope("customer@example.com", shops)).toBeNull();
    expect(
      resolveCollisionDemoScope("test@psghub.me", shops.slice(0, 1)),
    ).toBeNull();
  });

  it("presents the combined demo as one Riverside shop", () => {
    expect(
      resolveCollisionDemoShopContext(
        "test@psghub.me",
        shops,
        "south-lincoln",
      ),
    ).toEqual({
      shops: [
        {
          id: "riverside",
          name: "Riverside Collision Demo",
          role: "owner",
        },
      ],
      activeShopId: "riverside",
    });

    expect(
      resolveCollisionDemoShopContext(
        "customer@example.com",
        shops,
        "south-lincoln",
      ),
    ).toEqual({ shops, activeShopId: "south-lincoln" });
  });
});
