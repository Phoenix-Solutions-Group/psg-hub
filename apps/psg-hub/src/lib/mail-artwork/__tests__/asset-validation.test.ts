import { describe, it, expect } from "vitest";
import {
  ACCEPTED_MIME_TYPES,
  MAX_ASSET_BYTES,
  MIN_DPI,
  validateAsset,
} from "@/lib/mail-artwork/asset-validation";
import { getMailPieceSpec } from "@/lib/mail-artwork/spec-registry";

// Full-bleed pixel size for a size at a given DPI (matches validator math).
function pxAt(size: "4x6" | "6x9" | "6x11", dpi: number) {
  const spec = getMailPieceSpec(size);
  return {
    widthPx: Math.round(spec.fullBleedWidthIn * dpi),
    heightPx: Math.round(spec.fullBleedHeightIn * dpi),
  };
}

describe("asset-validation: happy path", () => {
  it.each(["4x6", "6x9", "6x11"] as const)(
    "accepts a correctly-sized 300-DPI PNG for %s",
    (size) => {
      const r = validateAsset(
        { ...pxAt(size, 300), mimeType: "image/png", sizeBytes: 2_000_000 },
        size,
      );
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
      expect(r.effectiveDpi!.horizontal).toBeGreaterThanOrEqual(300);
    },
  );

  it("accepts higher-than-300 DPI (never rejected for being sharp)", () => {
    const r = validateAsset({ ...pxAt("4x6", 600), mimeType: "image/jpeg" }, "4x6");
    expect(r.ok).toBe(true);
    expect(r.effectiveDpi!.horizontal).toBeGreaterThan(300);
  });

  it("accepts a vector PDF without pixel dimensions", () => {
    const r = validateAsset({ mimeType: "application/pdf", sizeBytes: 500_000 }, "6x9");
    expect(r.ok).toBe(true);
    expect(r.effectiveDpi).toBeNull();
  });
});

describe("asset-validation: rejects low-resolution", () => {
  it("rejects a 150-DPI image as too low-res", () => {
    const r = validateAsset({ ...pxAt("4x6", 150), mimeType: "image/png" }, "4x6");
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("low_resolution");
    expect(r.errors.find((e) => e.code === "low_resolution")!.message).toMatch(/300/);
  });

  it("accepts exactly 300 DPI (boundary, no float flake)", () => {
    const r = validateAsset({ ...pxAt("6x11", 300), mimeType: "image/png" }, "6x11");
    expect(r.ok).toBe(true);
  });
});

describe("asset-validation: rejects wrong dimensions / oversized", () => {
  it("rejects art whose aspect is wrong for the chosen size", () => {
    // 6x11-proportioned art (aspect ~1.8) uploaded for a 4x6 slot (aspect ~1.47),
    // sized high enough that DPI is fine — so this isolates the shape mismatch.
    const r = validateAsset({ ...pxAt("6x11", 300), mimeType: "image/png" }, "4x6");
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("wrong_dimensions");
    expect(r.errors.map((e) => e.code)).not.toContain("low_resolution");
  });

  it("treats a same-aspect but too-small file as low-res, not wrong-shape", () => {
    // 4x6 and 6x9 share ~the same aspect; a 4x6-sized file in a 6x9 slot prints
    // at ~270 DPI — correctly caught as low-res.
    const r = validateAsset({ ...pxAt("4x6", 400), mimeType: "image/png" }, "6x9");
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("low_resolution");
  });

  it("rejects a square (clearly wrong-shape) image", () => {
    const r = validateAsset({ widthPx: 2000, heightPx: 2000, mimeType: "image/jpeg" }, "4x6");
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("wrong_dimensions");
  });
});

describe("asset-validation: type + size + size-key guards", () => {
  it("rejects an unsupported file type", () => {
    const r = validateAsset(
      { ...pxAt("4x6", 300), mimeType: "image/gif" },
      "4x6",
    );
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("unsupported_type");
  });

  it("accepts exactly the documented MIME set", () => {
    expect([...ACCEPTED_MIME_TYPES]).toEqual(["image/png", "image/jpeg", "application/pdf"]);
  });

  it("rejects an over-limit file", () => {
    const r = validateAsset(
      { ...pxAt("4x6", 300), mimeType: "image/png", sizeBytes: MAX_ASSET_BYTES + 1 },
      "4x6",
    );
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("too_large");
  });

  it("rejects a raster image with no readable dimensions", () => {
    const r = validateAsset({ mimeType: "image/png" }, "4x6");
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("missing_dimensions");
  });

  it("fails closed on an unseeded size", () => {
    const r = validateAsset({ ...pxAt("4x6", 300), mimeType: "image/png" }, "5x7");
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("unknown_size");
  });

  it("MIN_DPI is the print standard (300)", () => {
    expect(MIN_DPI).toBe(300);
  });
});
