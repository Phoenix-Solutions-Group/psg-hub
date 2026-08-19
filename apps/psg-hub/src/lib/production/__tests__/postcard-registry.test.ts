import { describe, it, expect } from "vitest";
import {
  POSTCARD_SIZES,
  isPostcardSize,
  getPostcardSpec,
  allPostcardSpecs,
  inToPt,
  inToPx,
  rectToPt,
  intersectsClearZone,
  POINTS_PER_INCH,
  PRINT_DPI,
  BLEED_IN,
  type PostcardSize,
} from "@/lib/production/postcard-registry";

const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("postcard-registry: size guard", () => {
  it("recognizes exactly the PSG catalog sizes", () => {
    expect([...POSTCARD_SIZES]).toEqual(["4x6", "6x9", "6x11"]);
    for (const s of POSTCARD_SIZES) expect(isPostcardSize(s)).toBe(true);
  });
  it("rejects unknown / empty sizes", () => {
    expect(isPostcardSize("5x7")).toBe(false); // Lob offers it; PSG does not
    expect(isPostcardSize("4X6")).toBe(false); // case-sensitive token
    expect(isPostcardSize(undefined)).toBe(false);
    expect(isPostcardSize(null)).toBe(false);
    expect(isPostcardSize("")).toBe(false);
  });
});

describe("postcard-registry: full-bleed = trim + 2×bleed", () => {
  it.each(POSTCARD_SIZES)("%s adds one bleed per edge", (size) => {
    const spec = getPostcardSpec(size);
    near(spec.fullBleed.inches.width, spec.trim.inches.width + BLEED_IN * 2);
    near(spec.fullBleed.inches.height, spec.trim.inches.height + BLEED_IN * 2);
  });
});

describe("postcard-registry: unit derivations", () => {
  it("4x6 trim/full in inches, points, pixels", () => {
    const s = getPostcardSpec("4x6");
    near(s.trim.inches.width, 6);
    near(s.trim.inches.height, 4);
    near(s.fullBleed.inches.width, 6.25);
    near(s.fullBleed.inches.height, 4.25);
    near(s.fullBleed.points.width, 450);
    near(s.fullBleed.points.height, 306);
    expect(s.fullBleed.pixels.width).toBe(1875);
    expect(s.fullBleed.pixels.height).toBe(1275);
    expect(s.dpi).toBe(PRINT_DPI);
  });
  it("6x9 and 6x11 share a 6.25in bleed height and differ in width", () => {
    const a = getPostcardSpec("6x9");
    const b = getPostcardSpec("6x11");
    near(a.fullBleed.inches.width, 9.25);
    near(b.fullBleed.inches.width, 11.25);
    near(a.fullBleed.inches.height, 6.25);
    near(b.fullBleed.inches.height, 6.25);
    near(a.fullBleed.points.width, 666);
    near(b.fullBleed.points.width, 810);
  });
});

describe("postcard-registry: ink-free (address) clear zone", () => {
  it("4x6 zone is 3.2835x2.375 in the lower-right, offset by bleed", () => {
    const s = getPostcardSpec("4x6");
    near(s.clearZone.inches.width, 3.2835);
    near(s.clearZone.inches.height, 2.375);
    // bottom-left origin: x = bleed + (trimW - fromRight - czW)
    near(s.clearZone.bottomLeft.x, 2.5665);
    near(s.clearZone.bottomLeft.y, 0.375); // bleed + fromBottom
    // top-left origin: y measured from top down to the rect's TOP edge
    near(s.clearZone.topLeft.x, 2.5665);
    near(s.clearZone.topLeft.y, 1.5);
    // the two origins describe the same box, mirrored vertically
    near(
      s.clearZone.bottomLeft.y + s.clearZone.topLeft.y + s.clearZone.inches.height,
      s.fullBleed.inches.height
    );
  });
  it("6x9 zone is 4x2.375 and stays inside the trim box", () => {
    const s = getPostcardSpec("6x9");
    near(s.clearZone.inches.width, 4);
    near(s.clearZone.bottomLeft.x, 4.85);
    near(s.clearZone.bottomLeft.y, 0.375);
    // right/top edges must fall within the trim (not into the far bleed)
    const right = s.clearZone.bottomLeft.x + s.clearZone.inches.width;
    expect(right).toBeLessThanOrEqual(s.fullBleed.inches.width - BLEED_IN + 1e-9);
  });
});

describe("postcard-registry: safe area", () => {
  it("4x6 safe area is the trim inset by the safe margin", () => {
    const s = getPostcardSpec("4x6");
    near(s.safeArea.bottomLeft.x, 0.25);
    near(s.safeArea.bottomLeft.y, 0.25);
    near(s.safeArea.bottomLeft.width, 5.75);
    near(s.safeArea.bottomLeft.height, 3.75);
    near(s.safeArea.topLeft.y, 0.25);
  });
});

describe("postcard-registry: converters", () => {
  it("inToPt / inToPx / rectToPt", () => {
    near(inToPt(1), POINTS_PER_INCH);
    expect(inToPx(1)).toBe(300);
    expect(inToPx(1, 72)).toBe(72);
    const r = rectToPt({ x: 1, y: 2, width: 3, height: 0.5 });
    expect(r).toEqual({ x: 72, y: 144, width: 216, height: 36 });
  });
  it("allPostcardSpecs returns one entry per size", () => {
    const all = allPostcardSpecs();
    expect(Object.keys(all).sort()).toEqual([...POSTCARD_SIZES].sort());
  });
});

describe("postcard-registry: intersectsClearZone", () => {
  const size: PostcardSize = "4x6";
  it("flags artwork overlapping the address zone (bottom-left)", () => {
    // A box squarely inside the 4x6 clear zone.
    expect(intersectsClearZone(size, { x: 3, y: 0.5, width: 1, height: 1 })).toBe(true);
  });
  it("passes artwork clear of the zone (upper-left corner)", () => {
    expect(intersectsClearZone(size, { x: 0.2, y: 3, width: 1, height: 1 })).toBe(false);
  });
  it("treats a shared edge as non-overlapping", () => {
    const s = getPostcardSpec(size);
    const cz = s.clearZone.bottomLeft;
    // A box whose right edge exactly meets the zone's left edge.
    expect(
      intersectsClearZone(size, { x: cz.x - 1, y: cz.y, width: 1, height: cz.height })
    ).toBe(false);
  });
  it("honors the top-left origin variant", () => {
    const s = getPostcardSpec(size);
    const cz = s.clearZone.topLeft;
    expect(
      intersectsClearZone(size, { x: cz.x + 0.1, y: cz.y + 0.1, width: 0.5, height: 0.5 }, "top-left")
    ).toBe(true);
  });
});
