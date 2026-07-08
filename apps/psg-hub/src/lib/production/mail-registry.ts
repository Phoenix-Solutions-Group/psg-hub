/**
 * Unified Lob mail-piece geometry registry (PSG-868, Phase-1 backend foundation
 * for the mail-artwork module — parent PSG-847 / PSG-836).
 *
 * Phase-0 (PSG-849, `postcard-registry.ts`) established the single-source-of-truth
 * geometry model for POSTCARDS: trim, full-bleed, safe area, and the address/
 * barcode ink-free "clear zone" that actually rejects a piece if artwork bleeds
 * into it. This module GENERALISES that model to the other two Lob products PSG
 * mails — LETTERS and SELF-MAILERS — so the editor, the render/proof path, and the
 * preflight all read one registry regardless of piece type.
 *
 * It deliberately does NOT re-derive postcard numbers: postcard specs are pulled
 * straight from `postcard-registry.ts` (verified 2026-07-08 against Lob's spec
 * sheet) and wrapped into the unified `MailSpec` shape. Only the letter and
 * self-mailer numbers are new here.
 *
 * PURE module: no DB, no network, no clock, no `server-only`. Safe to import from
 * the browser editor and the server render path alike.
 *
 * ── Reference frames (READ THIS) ─────────────────────────────────────────────
 * A clear zone's rectangle is only meaningful against a stated box. Each zone
 * declares its `referenceBox`, and the spec exposes that box's dimensions:
 *   - "full_bleed" — the artwork/press box (trim + 2×bleed). Postcards & letters.
 *     For non-bleed letters, full_bleed == trim.
 *   - "folded"     — a self-mailer's FOLDED outer face (the 6×9 address panel).
 *     Self-mailers print on a large unfolded sheet, but the address must satisfy
 *     the folded 6×9 surface's rules; mapping the folded panel back onto the
 *     unfolded sheet is Phase-2 layout work and is NOT asserted here.
 *
 * ── Provenance ───────────────────────────────────────────────────────────────
 * SOURCES (Lob Help Center, verified 2026-07-08):
 * - Postcards: see postcard-registry.ts.
 * - Letters: 8.5×11 / 8.5×14, non-bleed ("Lob standard letters cannot bleed"),
 *   1/16" minimum safe clearance on all sides.
 *   https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/letters
 * - Self-mailers: 6×18 / 12×9 / 11×9 bifold + 17.75×9 trifold, all fold to 6×9,
 *   full bleed, shared 4"×2.375" ink-free address zone.
 *   https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/self-mailers
 *
 * Numbers that Lob does NOT publish as page coordinates — the recipient/return
 * address WINDOW rectangles on a letter page (Lob places the address server-side
 * via `address_placement`) — are encoded as PSG working defaults from the USPS
 * #10 double-window envelope standard and flagged `calibrationPending: true`.
 * Phase-3 live-proof (PSG-849 render path) is the calibration gate for those.
 */

import {
  BLEED_IN,
  PRINT_DPI,
  SAFE_MARGIN_IN,
  POSTCARD_SIZES,
  getPostcardSpec,
  type Dimensions,
  type Origin,
  type PostcardSize,
  type RectIn,
} from "./postcard-registry";

export {
  BLEED_IN,
  PRINT_DPI,
  POINTS_PER_INCH,
  SAFE_MARGIN_IN,
  inToPt,
  inToPx,
  rectToPt,
  type Dimensions,
  type Origin,
  type RectIn,
} from "./postcard-registry";

/** The three Lob products PSG mails. */
export const MAIL_PIECE_TYPES = ["postcard", "letter", "self_mailer"] as const;
export type MailPieceType = (typeof MAIL_PIECE_TYPES)[number];

/** Which stated box a clear-zone rectangle is measured against. */
export type ReferenceBox = "full_bleed" | "folded";

/** The printed surface a clear zone lives on. */
export type ClearSurface = "front" | "back" | "outside" | "page_1";

/**
 * The named ink-free / reserved zones the registry knows. A given size carries
 * only the zones that apply to it:
 *   - address_block     — combined address + IMB + indicia panel (postcards,
 *                         self-mailers). Lob reserves this as ONE ink-free rect.
 *   - recipient_address — the recipient window on a letter page (#10 double window)
 *   - return_address    — the sender window on a letter page
 *   - indicia           — postage indicia area (broken out only when a piece
 *                         reserves it separately from the address block)
 *   - imb               — USPS Intelligent Mail Barcode area (ditto)
 */
export type ClearZoneId =
  | "address_block"
  | "recipient_address"
  | "return_address"
  | "indicia"
  | "imb";

/** A named reserved rectangle, given in both PDF (bottom-left) and image (top-left) origins. */
export interface NamedClearZone {
  id: ClearZoneId;
  /** Human label for the editor overlay + reject reasons. */
  label: string;
  surface: ClearSurface;
  /** Which box `bottomLeft`/`topLeft` are measured against. */
  referenceBox: ReferenceBox;
  inches: { width: number; height: number };
  bottomLeft: RectIn;
  topLeft: RectIn;
  /** Short provenance string (which spec / standard the numbers came from). */
  source: string;
  /**
   * True when the exact rectangle is a PSG working default (not a Lob-published
   * page coordinate) awaiting Phase-3 live-proof calibration. The editor should
   * still render the zone; the number is directionally correct, not press-final.
   */
  calibrationPending?: boolean;
}

/** Fully-derived, immutable geometry for one mail size, across all piece types. */
export interface MailSpec {
  /** Stable registry key, e.g. "postcard:4x6", "letter:8.5x11", "self_mailer:11x9". */
  key: string;
  type: MailPieceType;
  /** Lob `size`/product token for this piece (e.g. "4x6", "8.5x11", "11x9"). */
  size: string;
  label: string;
  bleedIn: number;
  safeMarginIn: number;
  dpi: number;
  /** Finished (trimmed) size — what the recipient holds/unfolds. */
  trim: Dimensions;
  /** Artwork/press box = trim + 2×bleed. Equals trim for non-bleed letters. */
  fullBleed: Dimensions;
  /** Safe area (content-keep-in box) against the full-bleed box, both origins. */
  safeArea: { bottomLeft: RectIn; topLeft: RectIn };
  /** Reserved zones that apply to this size. */
  clearZones: NamedClearZone[];
  /** Self-mailers only: the folded outer-face size the address panel lives on. */
  folded?: Dimensions;
  /**
   * Self-mailers only: fold/glue score lines on the UNFOLDED sheet, as an offset
   * (inches) from the left (vertical scores) or bottom (horizontal scores) trim
   * edge. Descriptive foundation data for Phase-2 layout; not asserted geometry.
   */
  scores?: { atIn: number; axis: "vertical" | "horizontal"; kind: "fold" | "glue" }[];
}

/* -------------------------------------------------------------------------- */
/* Shared derivation helpers                                                   */
/* -------------------------------------------------------------------------- */

const POINTS_PER_INCH = 72;

function dims(widthIn: number, heightIn: number): Dimensions {
  return {
    inches: { width: widthIn, height: heightIn },
    points: { width: widthIn * POINTS_PER_INCH, height: heightIn * POINTS_PER_INCH },
    pixels: { width: Math.round(widthIn * PRINT_DPI), height: Math.round(heightIn * PRINT_DPI) },
  };
}

/**
 * Safe area = trim inset by `safeMargin`, expressed against the full-bleed box.
 * `bleed` shifts the trim origin inside the full-bleed box (0 for non-bleed).
 */
function safeAreaFor(
  trimW: number,
  trimH: number,
  bleed: number,
  safeMargin: number
): { bottomLeft: RectIn; topLeft: RectIn } {
  const fullH = trimH + bleed * 2;
  const x = bleed + safeMargin;
  const w = trimW - safeMargin * 2;
  const h = trimH - safeMargin * 2;
  const bottomLeftY = bleed + safeMargin;
  const topLeftY = fullH - (bottomLeftY + h);
  return {
    bottomLeft: { x, y: bottomLeftY, width: w, height: h },
    topLeft: { x, y: topLeftY, width: w, height: h },
  };
}

/**
 * Build a clear zone against a box of height `boxH`, given a bottom-left rect.
 * Derives the top-left mirror so both origins stay in sync.
 */
function zoneFromBottomLeft(
  id: ClearZoneId,
  label: string,
  surface: ClearSurface,
  referenceBox: ReferenceBox,
  boxH: number,
  rect: RectIn,
  source: string,
  calibrationPending = false
): NamedClearZone {
  return {
    id,
    label,
    surface,
    referenceBox,
    inches: { width: rect.width, height: rect.height },
    bottomLeft: rect,
    topLeft: { x: rect.x, y: boxH - (rect.y + rect.height), width: rect.width, height: rect.height },
    source,
    ...(calibrationPending ? { calibrationPending: true } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Postcards — wrapped from postcard-registry.ts (no number duplication)       */
/* -------------------------------------------------------------------------- */

function postcardSpec(size: PostcardSize): MailSpec {
  const p = getPostcardSpec(size);
  return {
    key: `postcard:${size}`,
    type: "postcard",
    size,
    label: `${size} postcard`,
    bleedIn: p.bleedIn,
    safeMarginIn: p.safeMarginIn,
    dpi: p.dpi,
    trim: p.trim,
    fullBleed: p.fullBleed,
    safeArea: p.safeArea,
    clearZones: [
      {
        id: "address_block",
        label: "Address + barcode (ink-free)",
        surface: "back",
        referenceBox: "full_bleed",
        inches: p.clearZone.inches,
        bottomLeft: p.clearZone.bottomLeft,
        topLeft: p.clearZone.topLeft,
        source: "Lob postcard spec (postcard-registry.ts, verified 2026-07-08)",
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Letters — 8.5×11 / 8.5×14, NON-BLEED                                         */
/* -------------------------------------------------------------------------- */

/** Lob letters cannot bleed. */
const LETTER_BLEED_IN = 0;
/** Lob letters require a 1/16" minimum safe clearance on every side. */
const LETTER_SAFE_MARGIN_IN = 1 / 16;

export const LETTER_SIZES = ["8.5x11", "8.5x14"] as const;
export type LetterSize = (typeof LETTER_SIZES)[number];

interface LetterSource {
  trim: { width: number; height: number };
}

const LETTER_SOURCE: Record<LetterSize, LetterSource> = {
  "8.5x11": { trim: { width: 8.5, height: 11 } },
  "8.5x14": { trim: { width: 8.5, height: 14 } },
};

/**
 * #10 double-window envelope address windows, as PSG working defaults measured
 * from the USPS window standard, positioned on the TOP of a portrait letter page
 * (matches Lob `address_placement: top_first_page`). Distances are from the page
 * TOP/LEFT (top-left origin) because that is how an envelope window is specified;
 * `zoneFromBottomLeft` gets the bottom-left mirror. calibrationPending: exact
 * page coordinates are Lob-server-placed and confirmed in Phase-3 live proof.
 */
const LETTER_RETURN_ADDR = { fromTop: 0.5, fromLeft: 0.5, width: 3.5, height: 0.75 };
const LETTER_RECIPIENT_ADDR = { fromTop: 2.0, fromLeft: 0.75, width: 4.0, height: 1.125 };

function letterSpec(size: LetterSize): MailSpec {
  const src = LETTER_SOURCE[size];
  const trimW = src.trim.width;
  const trimH = src.trim.height;
  // Non-bleed: full-bleed box == trim box.
  const fullH = trimH;

  const returnRectBL: RectIn = {
    x: LETTER_RETURN_ADDR.fromLeft,
    y: fullH - LETTER_RETURN_ADDR.fromTop - LETTER_RETURN_ADDR.height,
    width: LETTER_RETURN_ADDR.width,
    height: LETTER_RETURN_ADDR.height,
  };
  const recipientRectBL: RectIn = {
    x: LETTER_RECIPIENT_ADDR.fromLeft,
    y: fullH - LETTER_RECIPIENT_ADDR.fromTop - LETTER_RECIPIENT_ADDR.height,
    width: LETTER_RECIPIENT_ADDR.width,
    height: LETTER_RECIPIENT_ADDR.height,
  };

  return {
    key: `letter:${size}`,
    type: "letter",
    size,
    label: `${size} letter`,
    bleedIn: LETTER_BLEED_IN,
    safeMarginIn: LETTER_SAFE_MARGIN_IN,
    dpi: PRINT_DPI,
    trim: dims(trimW, trimH),
    fullBleed: dims(trimW, trimH),
    safeArea: safeAreaFor(trimW, trimH, LETTER_BLEED_IN, LETTER_SAFE_MARGIN_IN),
    clearZones: [
      zoneFromBottomLeft(
        "return_address",
        "Return address window",
        "page_1",
        "full_bleed",
        fullH,
        returnRectBL,
        "USPS #10 double-window standard (PSG working default)",
        true
      ),
      zoneFromBottomLeft(
        "recipient_address",
        "Recipient address window",
        "page_1",
        "full_bleed",
        fullH,
        recipientRectBL,
        "USPS #10 double-window standard (PSG working default)",
        true
      ),
    ],
  };
  // NOTE: indicia + IMB for letters live on the ENVELOPE (Lob-applied), not the
  // letter artwork, so they are intentionally absent from a letter's clearZones.
}

/* -------------------------------------------------------------------------- */
/* Self-mailers — fold to 6×9, full bleed                                      */
/* -------------------------------------------------------------------------- */

export const SELF_MAILER_SIZES = ["6x18", "12x9", "11x9", "17.75x9"] as const;
export type SelfMailerSize = (typeof SELF_MAILER_SIZES)[number];

interface SelfMailerSource {
  /** Unfolded sheet trim, inches. */
  trim: { width: number; height: number };
  fold: "bifold" | "trifold";
  /** Fold/glue score lines on the unfolded sheet. */
  scores: { atIn: number; axis: "vertical" | "horizontal"; kind: "fold" | "glue" }[];
}

const SELF_MAILER_SOURCE: Record<SelfMailerSize, SelfMailerSource> = {
  // 6×18 bifold, unfolds horizontally → folds to 9×6 (landscape 6x9 face).
  "6x18": {
    trim: { width: 18, height: 6 },
    fold: "bifold",
    scores: [{ atIn: 9, axis: "vertical", kind: "fold" }],
  },
  // 12×9 bifold, unfolds vertically.
  "12x9": {
    trim: { width: 12, height: 9 },
    fold: "bifold",
    scores: [{ atIn: 6, axis: "vertical", kind: "fold" }],
  },
  // 11×9 bifold, 1" offset.
  "11x9": {
    trim: { width: 11, height: 9 },
    fold: "bifold",
    scores: [{ atIn: 6, axis: "vertical", kind: "fold" }],
  },
  // 17.75×9 trifold, c-folds inward, 0.25" offset, glue zone at the 12" score.
  "17.75x9": {
    trim: { width: 17.75, height: 9 },
    fold: "trifold",
    scores: [
      { atIn: 5.9, axis: "vertical", kind: "fold" },
      { atIn: 12, axis: "vertical", kind: "glue" },
    ],
  },
};

/**
 * Every self-mailer folds to a 6×9 outer face, so its address panel is governed
 * by the SAME Lob rules as a 6×9 postcard: a 4"×2.375" ink-free zone, 0.275" from
 * the right and 0.25" from the bottom of the folded face. We therefore reuse the
 * verified 6×9 postcard clear-zone geometry rather than re-deriving it.
 */
function selfMailerSpec(size: SelfMailerSize): MailSpec {
  const src = SELF_MAILER_SOURCE[size];
  const trimW = src.trim.width;
  const trimH = src.trim.height;
  const fullW = trimW + BLEED_IN * 2;
  const fullH = trimH + BLEED_IN * 2;

  // Folded 6×9 outer face, full-bleed (matches a 6×9 postcard's face box).
  const folded = getPostcardSpec("6x9");

  return {
    key: `self_mailer:${size}`,
    type: "self_mailer",
    size,
    label: `${size} self-mailer (folds to 6x9)`,
    bleedIn: BLEED_IN,
    safeMarginIn: SAFE_MARGIN_IN,
    dpi: PRINT_DPI,
    trim: dims(trimW, trimH),
    fullBleed: dims(fullW, fullH),
    safeArea: safeAreaFor(trimW, trimH, BLEED_IN, SAFE_MARGIN_IN),
    folded: folded.fullBleed,
    scores: src.scores,
    clearZones: [
      {
        id: "address_block",
        label: "Address + barcode (ink-free, folded face)",
        surface: "outside",
        referenceBox: "folded",
        inches: folded.clearZone.inches,
        bottomLeft: folded.clearZone.bottomLeft,
        topLeft: folded.clearZone.topLeft,
        source: "Lob self-mailer spec = 6x9 postcard address rules (verified 2026-07-08)",
      },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Registry surface                                                            */
/* -------------------------------------------------------------------------- */

/** Every registry key, stable order (postcards, letters, self-mailers). */
export const MAIL_SPEC_KEYS: string[] = [
  ...POSTCARD_SIZES.map((s) => `postcard:${s}`),
  ...LETTER_SIZES.map((s) => `letter:${s}`),
  ...SELF_MAILER_SIZES.map((s) => `self_mailer:${s}`),
];

/** True when `key` is a registry key the module knows. */
export function isMailSpecKey(key: string | undefined | null): boolean {
  return key != null && MAIL_SPEC_KEYS.includes(key);
}

/**
 * Resolve a registry key to its geometry. Throws on an unknown key so a caller
 * can never silently render against undefined geometry.
 */
export function getMailSpec(key: string): MailSpec {
  const [type, size] = key.split(":");
  if (type === "postcard" && (POSTCARD_SIZES as readonly string[]).includes(size)) {
    return postcardSpec(size as PostcardSize);
  }
  if (type === "letter" && (LETTER_SIZES as readonly string[]).includes(size)) {
    return letterSpec(size as LetterSize);
  }
  if (type === "self_mailer" && (SELF_MAILER_SIZES as readonly string[]).includes(size)) {
    return selfMailerSpec(size as SelfMailerSize);
  }
  throw new Error(`Unknown mail spec key: ${key}`);
}

/** Every spec, in registry order — convenient for iteration / table rendering. */
export function allMailSpecs(): MailSpec[] {
  return MAIL_SPEC_KEYS.map(getMailSpec);
}

/**
 * Does an artwork rectangle overlap a reserved zone on this spec? Compares the
 * artwork rect against every clear zone that shares its `referenceBox` in the
 * given origin. Any positive-area overlap is a preflight collision (Lob would
 * print the address/barcode over the design). Touching edges is allowed.
 */
export function intersectsClearZone(
  key: string,
  artwork: RectIn,
  referenceBox: ReferenceBox,
  origin: Origin = "bottom-left"
): boolean {
  const spec = getMailSpec(key);
  return spec.clearZones
    .filter((z) => z.referenceBox === referenceBox)
    .some((z) => rectsOverlap(artwork, origin === "bottom-left" ? z.bottomLeft : z.topLeft));
}

/** Axis-aligned overlap test with a strictly-positive intersection area. */
function rectsOverlap(a: RectIn, b: RectIn): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
