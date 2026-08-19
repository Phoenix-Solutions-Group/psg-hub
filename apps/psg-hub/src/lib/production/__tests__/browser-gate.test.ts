import { describe, expect, it } from "vitest";
import { productionBrowserTestVendor } from "../browser-gate";

describe("productionBrowserTestVendor", () => {
  it("uses the in-house print fallback when Lob is not configured", () => {
    expect(productionBrowserTestVendor(undefined)).toBe("inhouse");
    expect(productionBrowserTestVendor("")).toBe("inhouse");
    expect(productionBrowserTestVendor("   ")).toBe("inhouse");
  });

  it("uses Lob only with an explicit test-mode key", () => {
    expect(productionBrowserTestVendor("test_psg2906")).toBe("lob");
    expect(productionBrowserTestVendor("  test_psg2906  ")).toBe("lob");
  });

  it("fails fast when a non-test Lob key is present", () => {
    expect(() => productionBrowserTestVendor("live_psg2906")).toThrow(
      /LOB_API_KEY is present but is not a test_\* key/
    );
  });
});
