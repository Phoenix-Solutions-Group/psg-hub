import { describe, it, expect } from "vitest";
import {
  selectAdsView,
  canLinkAccount,
  canDisconnect,
} from "@/lib/ads/view-state";

describe("selectAdsView", () => {
  it("non-tiered + no stripe return → tier-gate", () => {
    expect(
      selectAdsView({
        tiered: false,
        accountsCount: 0,
        role: "owner",
        justReturnedFromStripe: false,
        elapsedMsSinceReturn: 0,
      })
    ).toBe("tier-gate");
  });

  it("non-tiered + just returned + within grace → upgrade-processing", () => {
    expect(
      selectAdsView({
        tiered: false,
        accountsCount: 0,
        role: "owner",
        justReturnedFromStripe: true,
        elapsedMsSinceReturn: 5_000,
      })
    ).toBe("upgrade-processing");
  });

  it("non-tiered + grace expired → tier-gate", () => {
    expect(
      selectAdsView({
        tiered: false,
        accountsCount: 0,
        role: "owner",
        justReturnedFromStripe: true,
        elapsedMsSinceReturn: 70_000,
      })
    ).toBe("tier-gate");
  });

  it("tiered + 0 accounts → empty-link", () => {
    expect(
      selectAdsView({
        tiered: true,
        accountsCount: 0,
        role: "owner",
        justReturnedFromStripe: false,
        elapsedMsSinceReturn: 0,
      })
    ).toBe("empty-link");
  });

  it("tiered + >0 accounts → table", () => {
    expect(
      selectAdsView({
        tiered: true,
        accountsCount: 3,
        role: "manager",
        justReturnedFromStripe: false,
        elapsedMsSinceReturn: 0,
      })
    ).toBe("table");
  });

  it("tier outcome independent of role", () => {
    for (const role of ["owner", "manager", "viewer"] as const) {
      expect(
        selectAdsView({
          tiered: true,
          accountsCount: 1,
          role,
          justReturnedFromStripe: false,
          elapsedMsSinceReturn: 0,
        })
      ).toBe("table");
    }
  });
});

describe("canLinkAccount", () => {
  it("only owner", () => {
    expect(canLinkAccount("owner")).toBe(true);
    expect(canLinkAccount("manager")).toBe(false);
    expect(canLinkAccount("viewer")).toBe(false);
  });
});

describe("canDisconnect", () => {
  it("only owner", () => {
    expect(canDisconnect("owner")).toBe(true);
    expect(canDisconnect("manager")).toBe(false);
    expect(canDisconnect("viewer")).toBe(false);
  });
});
