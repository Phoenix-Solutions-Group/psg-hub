import { describe, it, expect } from "vitest";
import { resolveActiveShop, type UserShop } from "@/lib/shop/context";

const owner = (id: string): UserShop => ({ id, name: id, role: "owner" });
const viewer = (id: string): UserShop => ({ id, name: id, role: "viewer" });

describe("resolveActiveShop", () => {
  it("returns null when the user has no shops", () => {
    expect(resolveActiveShop([], "anything")).toBeNull();
    expect(resolveActiveShop([], undefined)).toBeNull();
  });

  it("returns the cookie shop when it is a current membership", () => {
    const shops = [owner("a"), viewer("b")];
    expect(resolveActiveShop(shops, "b")).toBe("b");
  });

  it("ignores a stale cookie (shop not in membership) and falls back", () => {
    const shops = [viewer("a"), owner("b")];
    // cookie "zzz" is not a member shop → must NOT select it; owner-first fallback
    expect(resolveActiveShop(shops, "zzz")).toBe("b");
  });

  it("falls back to the owner shop when no cookie", () => {
    const shops = [viewer("a"), owner("b"), viewer("c")];
    expect(resolveActiveShop(shops, undefined)).toBe("b");
    expect(resolveActiveShop(shops, null)).toBe("b");
  });

  it("falls back to the first shop when there is no owner", () => {
    const shops = [viewer("a"), viewer("b")];
    expect(resolveActiveShop(shops, undefined)).toBe("a");
  });

  it("selects the only shop for a single-shop user", () => {
    const shops = [viewer("solo")];
    expect(resolveActiveShop(shops, undefined)).toBe("solo");
    expect(resolveActiveShop(shops, "solo")).toBe("solo");
    // stale cookie still resolves to the only membership
    expect(resolveActiveShop(shops, "other")).toBe("solo");
  });
});
