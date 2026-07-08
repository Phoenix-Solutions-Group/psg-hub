/**
 * Mail-Artwork Studio — size / spec registry (PSG-860, Phase 1).
 *
 * Single typed source of truth the whole Mail-Artwork Studio agrees on: given a
 * mail-piece size, it returns the piece geometry (trim + bleed + safe margin) and
 * the named **clear zones** — the rectangles on the address side that PSG / Lob /
 * USPS reserve for the recipient address, the return address, the postage indicia,
 * and the USPS Intelligent-Mail barcode. Customer artwork must stay out of those
 * rectangles or the piece prints on top of the address block (Lob rejects it) or
 * fails USPS automation.
 *
 * This layer builds directly on the Phase-0 spike geometry
 * (`../production/postcard-registry`, PSG-849), which nailed the Lob-authoritative
 * address ink-free zone from the Lob spec sheet. This registry re-uses that number
 * verbatim (one place the value lives) and adds the three convention-based reserve
 * zones (return address, indicia, IMB) so the editor / preflight / render path all
 * share one shape.
 *
 * PURE module: no DB, no network, no clock. Safe to import from the browser editor
 * (Phase 2) and the server render/preflight path (Phase 3) alike.
 *
 * COORDINATE MODEL: every clear-zone rect is in **inches**, **top-left origin**,
 * measured against the **full-bleed artwork box** (trim + one bleed per edge) —
 * i.e. the exact box the editor canvas paints and the render path exports. Top-left
 * origin matches CSS/canvas so the Phase-2 editor can consume these rects with no
 * conversion.
 *
 * SEEDED: postcards 4x6 / 6x9 / 6x11 (per PSG production catalog). Letters and
 * self-mailers are the documented fast-follow — add a category + SOURCE entry.
 */

import {
  BLEED_IN,
  PRINT_DPI,
  SAFE_MARGIN_IN,
  getPostcardSpec,
  isPostcardSize,
  POSTCARD_SIZES,
  type PostcardSize,
  type RectIn,
} from "@/lib/production/postcard-registry";

export type { RectIn } from "@/lib/production/postcard-registry";

/** Mail-piece categories the Studio can spec. Postcards ship in Phase 1. */
export const MAIL_PIECE_CATEGORIES = ["postcard"] as const;
export type MailPieceCategory = (typeof MAIL_PIECE_CATEGORIES)[number];

/** The four named reserve zones on the address side of every mail piece. */
export const CLEAR_ZONE_IDS = [
  "address",
  "returnAddress",
  "indicia",
  "imbBarcode",
] as const;
export type ClearZoneId = (typeof CLEAR_ZONE_IDS)[number];

/**
 * A reserved rectangle customer artwork must keep clear.
 * `authoritative` = the rect comes from the Lob spec sheet (hard reject if hit);
 * `false` = a PSG default reserve derived from USPS DMM layout convention (upper-
 * right postage indicia, upper-left return address, IMB clearance) — correct in
 * shape and safe by default, tunable in one place against Lob art proofs in Phase 3.
 */
export interface ClearZone {
  id: ClearZoneId;
  /** Human label for the editor overlay. */
  label: string;
  /** Inches, top-left origin, against the full-bleed artwork box. */
  rect: RectIn;
  /** True when sourced from the Lob spec sheet (vs USPS-convention default). */
  authoritative: boolean;
  note?: string;
}

/**
 * Fully-derived spec for one mail-piece size. This is the object the issue's
 * `size -> {widthIn,heightIn,bleedIn,safeMarginIn,clearZones:[...]}` contract
 * refers to, enriched with the full-bleed box + DPI the editor/render need.
 */
export interface MailPieceSpec {
  /** Stable registry key, e.g. "postcard-4x6". */
  key: string;
  category: MailPieceCategory;
  size: PostcardSize;
  /** Finished (trimmed) piece size — what the recipient holds. */
  widthIn: number;
  heightIn: number;
  /** Lob bleed per edge (0.125"). */
  bleedIn: number;
  /** Keep-critical-content-inside margin (0.125"). */
  safeMarginIn: number;
  /** Full artwork box = trim + 2×bleed; the editor canvas / export size. */
  fullBleedWidthIn: number;
  fullBleedHeightIn: number;
  /** Print-artwork resolution (300 DPI). */
  dpi: number;
  /** Address-side reserved rectangles, in registry order (CLEAR_ZONE_IDS). */
  clearZones: ClearZone[];
}

/**
 * Convention-based reserve zones (return address, indicia). Authored as insets
 * from the TRIM edges (inches); shifted into full-bleed coords below. Sourced from
 * USPS DMM 602/202 postcard layout: return address upper-left, postage indicia
 * upper-right. Deliberately generous so critical customer art is warned early.
 */
interface ReserveInsets {
  /** width × height of the reserve block, inches. */
  size: { width: number; height: number };
  /** Which corner it anchors to, and its inset from those two trim edges. */
  corner: "top-left" | "top-right";
  insetXIn: number; // from the left (top-left) or right (top-right) trim edge
  insetYIn: number; // from the top trim edge
}

const RETURN_ADDRESS: ReserveInsets = {
  size: { width: 3.5, height: 1.0 },
  corner: "top-left",
  insetXIn: SAFE_MARGIN_IN,
  insetYIn: SAFE_MARGIN_IN,
};

const INDICIA: ReserveInsets = {
  size: { width: 1.75, height: 1.0 },
  corner: "top-right",
  insetXIn: SAFE_MARGIN_IN,
  insetYIn: SAFE_MARGIN_IN,
};

/** USPS Intelligent-Mail barcode clearance band height, inches. */
const IMB_HEIGHT_IN = 0.625;

/**
 * Convert a trim-relative reserve inset into a full-bleed-box, top-left-origin
 * rect. The trim box begins BLEED_IN in from every edge of the full-bleed box.
 */
function reserveToFullBleedRect(size: PostcardSize, r: ReserveInsets): RectIn {
  const spec = getPostcardSpec(size);
  const trimW = spec.trim.inches.width;
  const w = r.size.width;
  const h = r.size.height;
  // x measured from the LEFT of the full-bleed box.
  const xFromTrimLeft =
    r.corner === "top-left" ? r.insetXIn : trimW - r.insetXIn - w;
  const x = BLEED_IN + xFromTrimLeft;
  // y measured from the TOP of the full-bleed box down to the rect's top edge.
  const y = BLEED_IN + r.insetYIn;
  return { x, y, width: w, height: h };
}

/** Build the four clear zones for a size, in registry order. */
function buildClearZones(size: PostcardSize): ClearZone[] {
  const spec = getPostcardSpec(size);
  // Lob-authoritative recipient-address ink-free zone (spike geometry), already
  // in full-bleed / top-left coords.
  const address: RectIn = { ...spec.clearZone.topLeft };

  // IMB clearance = bottom band of the address block (USPS prints the barcode
  // within the address zone; reserve the lower strip so art keeps it readable).
  const imb: RectIn = {
    x: address.x,
    y: address.y + address.height - IMB_HEIGHT_IN,
    width: address.width,
    height: IMB_HEIGHT_IN,
  };

  return [
    {
      id: "address",
      label: "Recipient address",
      rect: address,
      authoritative: true,
      note: "Lob ink-free zone for the mailing address block; hard reject if artwork bleeds in.",
    },
    {
      id: "returnAddress",
      label: "Return address",
      rect: reserveToFullBleedRect(size, RETURN_ADDRESS),
      authoritative: false,
      note: "USPS-convention upper-left return-address reserve; PSG default, tune in Phase 3.",
    },
    {
      id: "indicia",
      label: "Postage indicia",
      rect: reserveToFullBleedRect(size, INDICIA),
      authoritative: false,
      note: "USPS-convention upper-right postage indicia reserve; PSG default, tune in Phase 3.",
    },
    {
      id: "imbBarcode",
      label: "Intelligent-Mail barcode",
      rect: imb,
      authoritative: false,
      note: "Lower band of the address block reserved for the USPS IMB.",
    },
  ];
}

const KEY_PREFIX: Record<MailPieceCategory, string> = { postcard: "postcard" };

/** Registry key for a size, e.g. "postcard-4x6". */
export function mailPieceKey(size: PostcardSize, category: MailPieceCategory = "postcard"): string {
  return `${KEY_PREFIX[category]}-${size}`;
}

/**
 * Compute the full spec for a postcard size. Cheap and pure. This is the primary
 * registry entry point the editor / preflight / render call.
 */
export function getMailPieceSpec(size: PostcardSize): MailPieceSpec {
  const geo = getPostcardSpec(size);
  return {
    key: mailPieceKey(size),
    category: "postcard",
    size,
    widthIn: geo.trim.inches.width,
    heightIn: geo.trim.inches.height,
    bleedIn: BLEED_IN,
    safeMarginIn: SAFE_MARGIN_IN,
    fullBleedWidthIn: geo.fullBleed.inches.width,
    fullBleedHeightIn: geo.fullBleed.inches.height,
    dpi: PRINT_DPI,
    clearZones: buildClearZones(size),
  };
}

/** True when `key` is a known registry key. */
export function isMailPieceKey(key: string | undefined | null): boolean {
  return key != null && MAIL_PIECE_SPEC_BY_KEY[key] != null;
}

/**
 * Resolve a spec by registry key (e.g. "postcard-4x6") or bare size ("4x6").
 * Returns null for anything unseeded — callers fail closed on null.
 */
export function resolveMailPieceSpec(keyOrSize: string): MailPieceSpec | null {
  if (isPostcardSize(keyOrSize)) return getMailPieceSpec(keyOrSize);
  return MAIL_PIECE_SPEC_BY_KEY[keyOrSize] ?? null;
}

/** All seeded specs, keyed by registry key — convenient for iteration. */
export const MAIL_PIECE_SPEC_BY_KEY: Record<string, MailPieceSpec> = Object.freeze(
  Object.fromEntries(
    POSTCARD_SIZES.map((s) => [mailPieceKey(s), getMailPieceSpec(s)]),
  ),
);

/** Every seeded spec as an array, in catalog order. */
export function allMailPieceSpecs(): MailPieceSpec[] {
  return POSTCARD_SIZES.map((s) => getMailPieceSpec(s));
}
