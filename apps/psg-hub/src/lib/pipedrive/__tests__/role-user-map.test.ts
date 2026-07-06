import { describe, it, expect } from "vitest";
import { loadRoleUserMap, ROLE_USER_ENV } from "../role-user-map";

describe("loadRoleUserMap", () => {
  it("maps a role whose env var holds a positive integer user id", () => {
    const map = loadRoleUserMap({
      [ROLE_USER_ENV.AS]: "501",
      [ROLE_USER_ENV.Analytics]: "502",
    });
    expect(map).toEqual({ AS: 501, Analytics: 502 });
  });

  it("leaves unset roles unmapped (they stay unassigned, no hard failure)", () => {
    const map = loadRoleUserMap({ [ROLE_USER_ENV.Ads]: "77" });
    expect(map).toEqual({ Ads: 77 });
    expect(map.AS).toBeUndefined();
    expect(map.Web).toBeUndefined();
    expect(map.CRO).toBeUndefined();
  });

  it("skips blank and malformed values instead of throwing", () => {
    const map = loadRoleUserMap({
      [ROLE_USER_ENV.AS]: "",
      [ROLE_USER_ENV.Ads]: "  ",
      [ROLE_USER_ENV.Analytics]: "abc",
      [ROLE_USER_ENV.Web]: "5.5",
      [ROLE_USER_ENV.CRO]: "0",
    });
    expect(map).toEqual({});
  });

  it("rejects negative ids and trims surrounding whitespace on valid ids", () => {
    const map = loadRoleUserMap({
      [ROLE_USER_ENV.AS]: "-3",
      [ROLE_USER_ENV.Web]: "  609 ",
    });
    expect(map).toEqual({ Web: 609 });
  });

  it("returns an empty map when nothing is configured", () => {
    expect(loadRoleUserMap({})).toEqual({});
  });
});
