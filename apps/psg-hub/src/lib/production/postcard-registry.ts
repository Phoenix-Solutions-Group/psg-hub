/**
 * Lob postcard geometry registry (PSG-849, Phase-0 spike for the mail-artwork
 * module — parent PSG-836).
 *
 * The problem this solves: Lob prints postcards to a fixed set of sizes, each
 * with (a) a bleed the artwork must extend into, (b) a safe margin critical
 * content must stay inside of, and (c) — the one that actually rejects/overprints
 * a piece — an **ink-free zone** on the back (address side) that Lob reserves for
 * the recipient address block + USPS Intelligent-Mail barcode. Any artwork that
 * bleeds ink into that rectangle gets the address printed on top of it. Today the
 * codebase carries `size` as a bare string (`MailDocument.size`, defaulted to
 * "4x6" in lob.ts) with no geometry behind it. This module is the single source
 * of truth for that geometry so the mail-artwork designer, the render/proof path,
 * and any preflight check all agree on the exact rectangles.
 *
 * PURE module: no DB, no network, no clock, no `server-only`. Just typed data and
 * unit math, safe to import from the browser designer and the server render path
 * alike. The companion `postcard-proof.ts` consumes this to emit a Lob-compliant
 * PDF with the clear zone left blank and guide overlays.
 *
 * SOURCES (Lob Help Center, verified 2026-07-08):
 * - Ink-free zone (address block): 4x6 = 3.2835" × 2.375"; all larger sizes =
 *   4" × 2.375"; positioned 0.275" from the right trim edge and 0.25" from the
 *   bottom trim edge.
 *   https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/postcards
 * - Bleed 0.125" per edge (file is 6.25×4.25 for a 6×4 piece); keep critical
 *   content 0.125" inside the trim (safe margin).
 *   https://help.lob.com/print-and-mail/designing-mail-creatives/artboard-layout
 * - 300 DPI is the print-artwork resolution PSG renders/preflights at.
 */

/** Units. Postcard geometry is authored in inches; PDF works in points. */
export const POINTS_PER_INCH = 72;
/** Print-artwork resolution PSG renders raster proofs / previews at. */
export const PRINT_DPI = 300;
/** Lob bleed: artwork extends this far past the trim on every edge. */
export const BLEED_IN = 0.125;
/** Lob safe margin: keep critical content this far inside the trim. */
export const SAFE_MARGIN_IN = 0.125;

/**
 * Lob postcard sizes PSG mails. Lob also offers 5x7, but the PSG production
 * catalog (lob.ts / templates.ts) is 4x6 / 6x9 / 6x11, so the registry is scoped
 * to those. `size` strings are the exact tokens Lob's `size` param expects.
 */
export const POSTCARD_SIZES = ["4x6", "6x9", "6x11"] as const;
export type PostcardSize = (typeof POSTCARD_SIZES)[number];

/** True when `s` is a Lob postcard size the registry knows. Narrows the type. */
export function isPostcardSize(s: string | undefined | null): s is PostcardSize {
  return s != null && (POSTCARD_SIZES as readonly string[]).includes(s);
}

/**
 * A rectangle in inches. Origin convention is stated by whatever returns it —
 * the registry deliberately exposes BOTH a bottom-left origin (PDF / pdf-lib) and
 * a top-left origin (image / CSS / canvas) because the two halves of the
 * mail-artwork module live in those two coordinate worlds.
 */
export interface RectIn {
  /** Distance from the left edge to the rect's left side, inches. */
  x: number;
  /**
   * Distance from the origin edge (bottom for `bottom-left`, top for `top-left`)
   * to the rect's near side, inches.
   */
  y: number;
  width: number;
  height: number;
}

export type Origin = "bottom-left" | "top-left";

/**
 * Raw, source-of-truth entry per size. Everything else is DERIVED from this so
 * there is exactly one place a number lives. Trim is the finished piece size;
 * the ink-free zone is authored relative to the TRIM box (not the bleed box),
 * measured in from the right/bottom trim edges, matching Lob's spec sheet.
 */
interface PostcardSource {
  /** Finished (trimmed) size in inches, landscape: width × height. */
  trim: { width: number; height: number };
  /** Ink-free (address + barcode) zone size in inches. */
  clearZone: { width: number; height: number };
  /** Inset of the clear zone from the right trim edge, inches. */
  clearZoneFromRight: number;
  /** Inset of the clear zone from the bottom trim edge, inches. */
  clearZoneFromBottom: number;
}

const SOURCE: Record<PostcardSize, PostcardSource> = {
  "4x6": {
    trim: { width: 6, height: 4 },
    clearZone: { width: 3.2835, height: 2.375 },
    clearZoneFromRight: 0.275,
    clearZoneFromBottom: 0.25,
  },
  "6x9": {
    trim: { width: 9, height: 6 },
    clearZone: { width: 4, height: 2.375 },
    clearZoneFromRight: 0.275,
    clearZoneFromBottom: 0.25,
  },
  "6x11": {
    trim: { width: 11, height: 6 },
    clearZone: { width: 4, height: 2.375 },
    clearZoneFromRight: 0.275,
    clearZoneFromBottom: 0.25,
  },
};

/** A width/height pair expressed in inches, PDF points, and 300-DPI pixels. */
export interface Dimensions {
  inches: { width: number; height: number };
  points: { width: number; height: number };
  pixels: { width: number; height: number };
}

/** Fully-derived, immutable geometry for one postcard size. */
export interface PostcardSpec {
  size: PostcardSize;
  /** Finished piece size (what the recipient holds). */
  trim: Dimensions;
  /** Full artwork size = trim + 2×bleed. This is the PDF/page size Lob wants. */
  fullBleed: Dimensions;
  bleedIn: number;
  safeMarginIn: number;
  dpi: number;
  /**
   * The address/barcode ink-free zone, in inches, expressed against the
   * FULL-BLEED artwork box (so callers rendering the bleed page can use it
   * directly). Provided in both origins.
   */
  clearZone: {
    inches: { width: number; height: number };
    bottomLeft: RectIn;
    topLeft: RectIn;
  };
  /**
   * Safe area (content-keep-in box), in inches against the FULL-BLEED box:
   * the trim inset by the safe margin. Both origins.
   */
  safeArea: {
    bottomLeft: RectIn;
    topLeft: RectIn;
  };
}

function toDimensions(widthIn: number, heightIn: number): Dimensions {
  return {
    inches: { width: widthIn, height: heightIn },
    points: { width: widthIn * POINTS_PER_INCH, height: heightIn * POINTS_PER_INCH },
    pixels: { width: Math.round(widthIn * PRINT_DPI), height: Math.round(heightIn * PRINT_DPI) },
  };
}

/**
 * Compute the full geometry for a size. Cheap and pure; callers may memoize but
 * it is not required.
 */
export function getPostcardSpec(size: PostcardSize): PostcardSpec {
  const src = SOURCE[size];
  const trimW = src.trim.width;
  const trimH = src.trim.height;
  const fullW = trimW + BLEED_IN * 2;
  const fullH = trimH + BLEED_IN * 2;

  // Clear zone against the full-bleed box: trim-relative position + bleed offset.
  const czW = src.clearZone.width;
  const czH = src.clearZone.height;
  // In trim coords (bottom-left): left = trimW - fromRight - czW, bottom = fromBottom.
  const czLeftInTrim = trimW - src.clearZoneFromRight - czW;
  const czBottomInTrim = src.clearZoneFromBottom;
  // Shift into the full-bleed box (the trim box starts at BLEED_IN,BLEED_IN).
  const czX = BLEED_IN + czLeftInTrim;
  const czBottomLeftY = BLEED_IN + czBottomInTrim;
  // top-left origin: y measured from the top of the full-bleed box down to the
  // rect's TOP edge.
  const czTopLeftY = fullH - (czBottomLeftY + czH);

  // Safe area = trim inset by the safe margin, expressed against the full box.
  const safeX = BLEED_IN + SAFE_MARGIN_IN;
  const safeW = trimW - SAFE_MARGIN_IN * 2;
  const safeH = trimH - SAFE_MARGIN_IN * 2;
  const safeBottomLeftY = BLEED_IN + SAFE_MARGIN_IN;
  const safeTopLeftY = fullH - (safeBottomLeftY + safeH);

  return {
    size,
    trim: toDimensions(trimW, trimH),
    fullBleed: toDimensions(fullW, fullH),
    bleedIn: BLEED_IN,
    safeMarginIn: SAFE_MARGIN_IN,
    dpi: PRINT_DPI,
    clearZone: {
      inches: { width: czW, height: czH },
      bottomLeft: { x: czX, y: czBottomLeftY, width: czW, height: czH },
      topLeft: { x: czX, y: czTopLeftY, width: czW, height: czH },
    },
    safeArea: {
      bottomLeft: { x: safeX, y: safeBottomLeftY, width: safeW, height: safeH },
      topLeft: { x: safeX, y: safeTopLeftY, width: safeW, height: safeH },
    },
  };
}

/** Every spec, keyed by size — convenient for iteration / table rendering. */
export function allPostcardSpecs(): Record<PostcardSize, PostcardSpec> {
  return {
    "4x6": getPostcardSpec("4x6"),
    "6x9": getPostcardSpec("6x9"),
    "6x11": getPostcardSpec("6x11"),
  };
}

/** Convert an inches value to PDF points. */
export function inToPt(inches: number): number {
  return inches * POINTS_PER_INCH;
}

/** Convert an inches value to whole pixels at the print DPI (default 300). */
export function inToPx(inches: number, dpi: number = PRINT_DPI): number {
  return Math.round(inches * dpi);
}

/** A rect scaled from inches into points (for pdf-lib draw calls). */
export function rectToPt(r: RectIn): RectIn {
  return {
    x: inToPt(r.x),
    y: inToPt(r.y),
    width: inToPt(r.width),
    height: inToPt(r.height),
  };
}

/**
 * Does an artwork rectangle (in inches, against the full-bleed box) overlap the
 * ink-free zone on the back? Any overlap means the design would collide with the
 * address block / barcode and Lob would print over it — the preflight fail case.
 *
 * `origin` states which coordinate world `artwork` is in; the clear zone is
 * compared in the same world. Touching edges (zero-area overlap) is allowed.
 */
export function intersectsClearZone(
  size: PostcardSize,
  artwork: RectIn,
  origin: Origin = "bottom-left"
): boolean {
  const spec = getPostcardSpec(size);
  const cz = origin === "bottom-left" ? spec.clearZone.bottomLeft : spec.clearZone.topLeft;
  return rectsOverlap(artwork, cz);
}

/** Axis-aligned overlap test with a strictly-positive intersection area. */
function rectsOverlap(a: RectIn, b: RectIn): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}
