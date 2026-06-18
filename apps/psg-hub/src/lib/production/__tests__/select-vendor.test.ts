import { describe, it, expect } from "vitest";
import { selectVendor, DEFAULT_MAIL_VENDOR } from "@/lib/production/select-vendor";

describe("selectVendor", () => {
  it("defaults to the default vendor when nothing is configured", () => {
    expect(selectVendor()).toBe(DEFAULT_MAIL_VENDOR);
    expect(selectVendor({})).toBe(DEFAULT_MAIL_VENDOR);
    expect(
      selectVendor({ documentVendor: null, batchVendor: null, templateVendor: null, shopVendor: null })
    ).toBe(DEFAULT_MAIL_VENDOR);
  });

  it("honours an already-persisted document vendor above everything else", () => {
    expect(
      selectVendor({
        documentVendor: "inhouse",
        batchVendor: "lob",
        templateVendor: "lob",
        shopVendor: "lob",
      })
    ).toBe("inhouse");
  });

  it("falls through batch → template → shop in precedence order", () => {
    expect(selectVendor({ batchVendor: "inhouse", templateVendor: "lob", shopVendor: "lob" })).toBe(
      "inhouse"
    );
    expect(selectVendor({ templateVendor: "inhouse", shopVendor: "lob" })).toBe("inhouse");
    expect(selectVendor({ shopVendor: "inhouse" })).toBe("inhouse");
  });

  it("template overrides shop (template is more specific)", () => {
    expect(selectVendor({ templateVendor: "lob", shopVendor: "inhouse" })).toBe("lob");
  });

  it("is pure — same input yields same output with no side effects", () => {
    const input = { shopVendor: "inhouse" as const };
    expect(selectVendor(input)).toBe(selectVendor(input));
    expect(input).toEqual({ shopVendor: "inhouse" });
  });
});
