import { describe, it, expect } from "vitest";
import {
  validateAsset,
  MIN_DPI,
  ACCEPTED_ASSET_MIME,
  type AssetProbe,
} from "@/lib/production/mail-artwork-asset";
import { getMailSpec } from "@/lib/production/mail-registry";

/** Pixels needed to hit exactly `dpi` across the full-bleed box of `sizeKey`. */
function pxForDpi(sizeKey: string, dpi: number) {
  const box = getMailSpec(sizeKey).fullBleed.inches;
  return { widthPx: Math.ceil(box.width * dpi), heightPx: Math.ceil(box.height * dpi) };
}

describe("mail-artwork-asset: type gate", () => {
  it("accepts PNG/JPEG/PDF and rejects anything else", () => {
    expect([...ACCEPTED_ASSET_MIME]).toEqual(["image/png", "image/jpeg", "application/pdf"]);
    const bad = validateAsset({ mime: "image/gif", widthPx: 5000, heightPx: 5000 }, "postcard:4x6");
    expect(bad.ok).toBe(false);
    expect(bad.rejects[0].code).toBe("unsupported_type");
  });
  it("throws on an unknown size key", () => {
    expect(() => validateAsset({ mime: "image/png" }, "postcard:5x7")).toThrow(/Unknown mail size key/);
  });
});

describe("mail-artwork-asset: raster DPI + coverage", () => {
  it("accepts an image at exactly 300 DPI covering the box", () => {
    const probe: AssetProbe = { mime: "image/png", ...pxForDpi("postcard:4x6", MIN_DPI) };
    const res = validateAsset(probe, "postcard:4x6");
    expect(res.ok).toBe(true);
    expect(res.rejects).toHaveLength(0);
    expect(res.effectiveDpi!.x).toBeGreaterThanOrEqual(MIN_DPI);
  });

  it("rejects a low-DPI image with a clear, structured reason", () => {
    const probe: AssetProbe = { mime: "image/jpeg", ...pxForDpi("postcard:6x9", 150) };
    const res = validateAsset(probe, "postcard:6x9");
    expect(res.ok).toBe(false);
    const low = res.rejects.find((r) => r.code === "low_dpi");
    expect(low).toBeTruthy();
    expect(low!.message).toMatch(/DPI/);
    expect(low!.detail!.requiredDpi).toBe(MIN_DPI);
    // A low-DPI image is also too small to cover → both reasons surface.
    expect(res.rejects.some((r) => r.code === "too_small")).toBe(true);
  });

  it("rejects a right-DPI-but-cropped image only for the missing axis", () => {
    // Enough pixels one way, short the other.
    const req = pxForDpi("postcard:6x11", MIN_DPI);
    const res = validateAsset(
      { mime: "image/png", widthPx: req.widthPx, heightPx: req.heightPx - 500 },
      "postcard:6x11"
    );
    expect(res.ok).toBe(false);
    expect(res.rejects.some((r) => r.code === "too_small" || r.code === "low_dpi")).toBe(true);
  });

  it("rejects a raster with missing dimensions", () => {
    const res = validateAsset({ mime: "image/png" }, "postcard:4x6");
    expect(res.ok).toBe(false);
    expect(res.rejects[0].code).toBe("missing_dimensions");
  });

  it("warns (non-fatal) on large aspect-ratio drift", () => {
    // Square image against a wide 6x11 piece: plenty of pixels, wrong shape.
    const side = Math.ceil(getMailSpec("postcard:6x11").fullBleed.inches.width * MIN_DPI);
    const res = validateAsset({ mime: "image/png", widthPx: side, heightPx: side }, "postcard:6x11");
    expect(res.ok).toBe(true); // still allowed
    expect(res.warnings.some((w) => w.code === "aspect_mismatch")).toBe(true);
  });
});

describe("mail-artwork-asset: PDF handling", () => {
  it("accepts a vector PDF (no raster dims) on type alone", () => {
    const res = validateAsset({ mime: "application/pdf" }, "letter:8.5x11");
    expect(res.ok).toBe(true);
    expect(res.effectiveDpi).toBeUndefined();
  });
  it("still DPI-checks a flattened raster PDF that carries pixel dims", () => {
    const res = validateAsset(
      { mime: "application/pdf", ...pxForDpi("postcard:4x6", 100) },
      "postcard:4x6"
    );
    expect(res.ok).toBe(false);
    expect(res.rejects.some((r) => r.code === "low_dpi")).toBe(true);
  });
});

describe("mail-artwork-asset: works across every piece type", () => {
  it("validates letters and self-mailers by their full-bleed box", () => {
    for (const key of ["letter:8.5x14", "self_mailer:11x9"]) {
      const good = validateAsset({ mime: "image/png", ...pxForDpi(key, MIN_DPI) }, key);
      expect(good.ok).toBe(true);
      const bad = validateAsset({ mime: "image/png", ...pxForDpi(key, 72) }, key);
      expect(bad.ok).toBe(false);
    }
  });
});
