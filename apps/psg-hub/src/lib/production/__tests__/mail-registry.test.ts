import { describe, it, expect } from "vitest";
import {
  MAIL_SPEC_KEYS,
  MAIL_PIECE_TYPES,
  LETTER_SIZES,
  SELF_MAILER_SIZES,
  isMailSpecKey,
  getMailSpec,
  allMailSpecs,
  intersectsClearZone,
  BLEED_IN,
  PRINT_DPI,
  type RectIn,
} from "@/lib/production/mail-registry";
import { getPostcardSpec } from "@/lib/production/postcard-registry";

const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("mail-registry: key set + guard", () => {
  it("covers postcards, letters, and self-mailers", () => {
    expect(MAIL_PIECE_TYPES).toEqual(["postcard", "letter", "self_mailer"]);
    expect(MAIL_SPEC_KEYS).toContain("postcard:4x6");
    expect(MAIL_SPEC_KEYS).toContain("letter:8.5x11");
    expect(MAIL_SPEC_KEYS).toContain("self_mailer:11x9");
    // 3 postcards + 2 letters + 4 self-mailers.
    expect(MAIL_SPEC_KEYS).toHaveLength(9);
  });
  it("guards known vs unknown keys", () => {
    for (const k of MAIL_SPEC_KEYS) expect(isMailSpecKey(k)).toBe(true);
    expect(isMailSpecKey("postcard:5x7")).toBe(false);
    expect(isMailSpecKey("letter:8.5x17")).toBe(false);
    expect(isMailSpecKey(undefined)).toBe(false);
    expect(isMailSpecKey(null)).toBe(false);
    expect(isMailSpecKey("")).toBe(false);
  });
  it("throws on an unknown key rather than returning undefined geometry", () => {
    expect(() => getMailSpec("bogus:9x9")).toThrow(/Unknown mail spec key/);
  });
});

describe("mail-registry: every spec is internally consistent", () => {
  it("has positive dims and every clear zone fits inside its reference box", () => {
    for (const spec of allMailSpecs()) {
      expect(spec.dpi).toBe(PRINT_DPI);
      expect(spec.trim.inches.width).toBeGreaterThan(0);
      expect(spec.trim.inches.height).toBeGreaterThan(0);
      // full-bleed = trim + 2*bleed on each axis.
      near(spec.fullBleed.inches.width, spec.trim.inches.width + spec.bleedIn * 2);
      near(spec.fullBleed.inches.height, spec.trim.inches.height + spec.bleedIn * 2);
      // points/pixels derive from inches.
      near(spec.fullBleed.points.width, spec.fullBleed.inches.width * 72);
      expect(spec.fullBleed.pixels.width).toBe(Math.round(spec.fullBleed.inches.width * PRINT_DPI));

      for (const zone of spec.clearZones) {
        const box =
          zone.referenceBox === "folded"
            ? spec.folded!
            : spec.fullBleed;
        const boxW = box.inches.width;
        const boxH = box.inches.height;
        for (const r of [zone.bottomLeft, zone.topLeft]) {
          expect(r.width).toBeGreaterThan(0);
          expect(r.height).toBeGreaterThan(0);
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width).toBeLessThanOrEqual(boxW + 1e-9);
          expect(r.y + r.height).toBeLessThanOrEqual(boxH + 1e-9);
        }
        // bottom-left and top-left describe the same rect mirrored on the box.
        near(zone.bottomLeft.y, boxH - (zone.topLeft.y + zone.topLeft.height));
      }
    }
  });
});

describe("mail-registry: postcards wrap postcard-registry without drift", () => {
  it("matches getPostcardSpec numbers exactly", () => {
    const spec = getMailSpec("postcard:6x9");
    const p = getPostcardSpec("6x9");
    expect(spec.type).toBe("postcard");
    expect(spec.bleedIn).toBe(BLEED_IN);
    near(spec.fullBleed.inches.width, p.fullBleed.inches.width);
    const zone = spec.clearZones.find((z) => z.id === "address_block")!;
    expect(zone).toBeTruthy();
    near(zone.bottomLeft.x, p.clearZone.bottomLeft.x);
    near(zone.bottomLeft.y, p.clearZone.bottomLeft.y);
  });
});

describe("mail-registry: letters are non-bleed with #10 window zones", () => {
  it("has zero bleed and 1/16in safe margin for every letter size", () => {
    for (const size of LETTER_SIZES) {
      const spec = getMailSpec(`letter:${size}`);
      expect(spec.bleedIn).toBe(0);
      near(spec.safeMarginIn, 1 / 16);
      // full-bleed == trim for non-bleed letters.
      near(spec.fullBleed.inches.width, spec.trim.inches.width);
      near(spec.fullBleed.inches.height, spec.trim.inches.height);
    }
  });
  it("carries recipient + return address zones (indicia/IMB are envelope-side)", () => {
    const spec = getMailSpec("letter:8.5x11");
    const ids = spec.clearZones.map((z) => z.id).sort();
    expect(ids).toEqual(["recipient_address", "return_address"]);
    for (const z of spec.clearZones) {
      expect(z.surface).toBe("page_1");
      expect(z.calibrationPending).toBe(true); // Lob places address server-side
    }
    // No indicia/imb zone on a letter (they live on the envelope).
    expect(spec.clearZones.some((z) => z.id === "indicia" || z.id === "imb")).toBe(false);
  });
});

describe("mail-registry: self-mailers fold to 6x9 with a shared address panel", () => {
  it("all four sizes carry an address_block on a folded 6x9 face", () => {
    const folded69 = getPostcardSpec("6x9");
    for (const size of SELF_MAILER_SIZES) {
      const spec = getMailSpec(`self_mailer:${size}`);
      expect(spec.bleedIn).toBe(BLEED_IN);
      expect(spec.folded).toBeTruthy();
      near(spec.folded!.inches.width, folded69.fullBleed.inches.width);
      const zone = spec.clearZones.find((z) => z.id === "address_block")!;
      expect(zone.referenceBox).toBe("folded");
      near(zone.inches.width, 4);
      near(zone.inches.height, 2.375);
      // reuses the verified 6x9 postcard address geometry.
      near(zone.bottomLeft.x, folded69.clearZone.bottomLeft.x);
    }
  });
  it("records fold/glue scores including the trifold glue zone", () => {
    const trifold = getMailSpec("self_mailer:17.75x9");
    expect(trifold.scores?.some((s) => s.kind === "glue")).toBe(true);
    const bifold = getMailSpec("self_mailer:12x9");
    expect(bifold.scores?.every((s) => s.kind === "fold")).toBe(true);
  });
});

describe("mail-registry: clear-zone collision", () => {
  const overlapping: RectIn = { x: 0, y: 0, width: 100, height: 100 }; // covers everything
  const cornerAway: RectIn = { x: 0, y: 4, width: 0.5, height: 0.2 }; // top-left of 6x9 back

  it("flags artwork that overlaps a postcard address block", () => {
    expect(intersectsClearZone("postcard:6x9", overlapping, "full_bleed", "bottom-left")).toBe(true);
  });
  it("passes artwork clear of the address block", () => {
    expect(intersectsClearZone("postcard:6x9", cornerAway, "full_bleed", "bottom-left")).toBe(false);
  });
  it("only compares zones sharing the requested reference box", () => {
    // A self-mailer's only zone is on the folded face; nothing overlaps full_bleed.
    expect(intersectsClearZone("self_mailer:11x9", overlapping, "full_bleed")).toBe(false);
    expect(intersectsClearZone("self_mailer:11x9", overlapping, "folded")).toBe(true);
  });
});
