import { describe, expect, it } from "vitest";
import {
  normalizeShopMatchText,
  rankShopMatches,
  type ShopDirectoryEntry,
} from "../shop-match";

const shops: ShopDirectoryEntry[] = [
  {
    id: "collision-center",
    name: "Tracy's Collision Center",
    slug: "tracys-collision-center",
    address_locality: null,
    address_region: null,
    address_postal_code: null,
    client: { name: "Tracy's Collision Center" },
  },
  {
    id: "body-shop",
    name: "Tracy's Body Shop",
    slug: "tracys-body-shop",
    address_locality: "Lincoln",
    address_region: "NE",
    address_postal_code: "68502",
    client: { name: "Tracy's Body Shop" },
  },
  {
    id: "wallace",
    name: "Wallace Collision Center",
    slug: "wallace-collision-center",
    address_locality: "Ottawa",
    address_region: "KS",
    address_postal_code: "66067",
    client: { name: "Wallace Collision Center" },
  },
];

describe("shop identity matching", () => {
  it("normalizes punctuation and smart apostrophes", () => {
    expect(normalizeShopMatchText(" Tracy’s  Collision—Center ")).toBe(
      "tracys collision center",
    );
  });

  it("ranks the closest name but flags a missing source location", () => {
    const matches = rankShopMatches("Tracy’s Collision Center South", shops);

    expect(matches[0].shop.id).toBe("collision-center");
    expect(matches[0].locationWarning).toBe(true);
    expect(matches[0].score).toBeLessThan(80);
    expect(matches.map((match) => match.shop.id)).toContain("body-shop");
  });

  it("searches the directory by location without auto-approving a name match", () => {
    const matches = rankShopMatches(
      "Tracy’s Collision Center South",
      shops,
      "Lincoln NE",
    );

    expect(matches[0].shop.id).toBe("body-shop");
    expect(matches[0].searchScore).toBe(100);
  });

  it("marks an exact shop name as strong", () => {
    const [match] = rankShopMatches("Wallace Collision Center", shops);

    expect(match.shop.id).toBe("wallace");
    expect(match.score).toBe(100);
  });
});
