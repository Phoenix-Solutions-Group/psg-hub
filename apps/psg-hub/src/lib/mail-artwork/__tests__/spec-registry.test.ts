import { describe, it, expect } from "vitest";
import {
  CLEAR_ZONE_IDS,
  MAIL_PIECE_SPEC_BY_KEY,
  allMailPieceSpecs,
  getMailPieceSpec,
  isMailPieceKey,
  mailPieceKey,
  resolveMailPieceSpec,
  type ClearZoneId,
} from "@/lib/mail-artwork/spec-registry";
import {
  POSTCARD_SIZES,
  getPostcardSpec,
  BLEED_IN,
  type PostcardSize,
} from "@/lib/production/postcard-registry";

const near = (a: number, b: number, eps = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(eps);

describe("mail-artwork spec-registry: seeded sizes", () => {
  it("seeds exactly the three PSG postcard sizes", () => {
    expect(allMailPieceSpecs().map((s) => s.size)).toEqual(["4x6", "6x9", "6x11"]);
    expect(Object.keys(MAIL_PIECE_SPEC_BY_KEY)).toEqual([
      "postcard-4x6",
      "postcard-6x9",
      "postcard-6x11",
    ]);
  });

  it.each(POSTCARD_SIZES)("%s carries the issue's spec contract", (size) => {
    const spec = getMailPieceSpec(size);
    const geo = getPostcardSpec(size);
    expect(spec.key).toBe(`postcard-${size}`);
    expect(spec.category).toBe("postcard");
    near(spec.widthIn, geo.trim.inches.width);
    near(spec.heightIn, geo.trim.inches.height);
    expect(spec.bleedIn).toBe(0.125);
    expect(spec.safeMarginIn).toBe(0.125);
    near(spec.fullBleedWidthIn, geo.trim.inches.width + BLEED_IN * 2);
    near(spec.fullBleedHeightIn, geo.trim.inches.height + BLEED_IN * 2);
    expect(spec.dpi).toBe(300);
  });
});

describe("mail-artwork spec-registry: clear zones", () => {
  it.each(POSTCARD_SIZES)("%s returns all four named zones in order", (size) => {
    const spec = getMailPieceSpec(size);
    expect(spec.clearZones.map((z) => z.id)).toEqual([...CLEAR_ZONE_IDS]);
    for (const z of spec.clearZones) {
      expect(typeof z.label).toBe("string");
      expect(z.label.length).toBeGreaterThan(0);
    }
  });

  it("marks only the recipient-address zone as Lob-authoritative", () => {
    const spec = getMailPieceSpec("4x6");
    const byId = Object.fromEntries(spec.clearZones.map((z) => [z.id, z])) as Record<
      ClearZoneId,
      (typeof spec.clearZones)[number]
    >;
    expect(byId.address.authoritative).toBe(true);
    expect(byId.returnAddress.authoritative).toBe(false);
    expect(byId.indicia.authoritative).toBe(false);
    expect(byId.imbBarcode.authoritative).toBe(false);
  });

  it("address zone matches the Lob spike geometry (single source of truth)", () => {
    for (const size of POSTCARD_SIZES) {
      const spec = getMailPieceSpec(size);
      const addr = spec.clearZones.find((z) => z.id === "address")!;
      expect(addr.rect).toEqual(getPostcardSpec(size).clearZone.topLeft);
    }
  });

  it.each(POSTCARD_SIZES)("%s: every clear zone sits inside the full-bleed box", (size) => {
    const spec = getMailPieceSpec(size);
    for (const z of spec.clearZones) {
      expect(z.rect.x).toBeGreaterThanOrEqual(0);
      expect(z.rect.y).toBeGreaterThanOrEqual(0);
      expect(z.rect.x + z.rect.width).toBeLessThanOrEqual(spec.fullBleedWidthIn + 1e-9);
      expect(z.rect.y + z.rect.height).toBeLessThanOrEqual(spec.fullBleedHeightIn + 1e-9);
      expect(z.rect.width).toBeGreaterThan(0);
      expect(z.rect.height).toBeGreaterThan(0);
    }
  });

  it("IMB band is the bottom strip of the address zone", () => {
    const spec = getMailPieceSpec("6x9");
    const addr = spec.clearZones.find((z) => z.id === "address")!.rect;
    const imb = spec.clearZones.find((z) => z.id === "imbBarcode")!.rect;
    near(imb.x, addr.x);
    near(imb.width, addr.width);
    near(imb.y + imb.height, addr.y + addr.height); // shares the bottom edge
    expect(imb.height).toBeLessThan(addr.height);
  });

  it("return address anchors top-left, indicia anchors top-right", () => {
    const spec = getMailPieceSpec("6x11");
    const ret = spec.clearZones.find((z) => z.id === "returnAddress")!.rect;
    const ind = spec.clearZones.find((z) => z.id === "indicia")!.rect;
    // Return address hugs the left bleed+margin.
    near(ret.x, BLEED_IN + spec.safeMarginIn);
    // Indicia's right edge hugs the right trim minus the margin.
    near(ind.x + ind.width, spec.fullBleedWidthIn - BLEED_IN - spec.safeMarginIn);
    // Both sit at the top.
    near(ret.y, ind.y);
  });
});

describe("mail-artwork spec-registry: resolvers", () => {
  it("resolves by registry key and by bare size", () => {
    expect(resolveMailPieceSpec("postcard-4x6")?.size).toBe("4x6");
    expect(resolveMailPieceSpec("6x9")?.size).toBe("6x9");
  });

  it("fails closed on unseeded input", () => {
    expect(resolveMailPieceSpec("5x7")).toBeNull();
    expect(resolveMailPieceSpec("postcard-5x7")).toBeNull();
    expect(resolveMailPieceSpec("")).toBeNull();
  });

  it("isMailPieceKey / mailPieceKey agree", () => {
    for (const size of POSTCARD_SIZES) {
      const key = mailPieceKey(size as PostcardSize);
      expect(isMailPieceKey(key)).toBe(true);
    }
    expect(isMailPieceKey("postcard-5x7")).toBe(false);
    expect(isMailPieceKey(null)).toBe(false);
  });

  it("the by-key table is frozen (immutable registry)", () => {
    expect(Object.isFrozen(MAIL_PIECE_SPEC_BY_KEY)).toBe(true);
  });
});
