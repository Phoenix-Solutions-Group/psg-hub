/**
 * Mail-Artwork Studio — uploaded-asset validation (PSG-860, Phase 1).
 *
 * Print artwork that is too low-resolution prints blurry; artwork whose pixel
 * dimensions don't match the chosen mail-piece size prints stretched, cropped, or
 * with the address block in the wrong place. This module is the single gate that
 * rejects both before an asset ever reaches the render/Lob path, with a plain,
 * shop-owner-readable reason.
 *
 * PURE module: it takes already-probed asset facts (dimensions, MIME, byte size) —
 * it does NOT read files or the network. The caller (upload route, Phase 2/3)
 * probes the pixel size (e.g. sharp / image-size) and passes the numbers in, so
 * this stays trivially unit-testable and reusable on client and server.
 *
 * RULES (from the AC): accept only PNG / JPEG / PDF; require ≥ 300 DPI effective
 * against the full-bleed box; require the pixel dimensions to match the chosen
 * size's aspect (reject stretched / wrong-size / oversized art). Higher-than-300
 * DPI is fine (never rejected for being sharp).
 */

import { PRINT_DPI } from "@/lib/production/postcard-registry";
import { getMailPieceSpec, type MailPieceSpec } from "@/lib/mail-artwork/spec-registry";
import { isPostcardSize, type PostcardSize } from "@/lib/production/postcard-registry";

/** MIME types the `mail-artwork` bucket + validator accept. */
export const ACCEPTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "application/pdf",
] as const;
export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

/** Default upload ceiling (mirrors the bucket file_size_limit). 25 MiB. */
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** Minimum print resolution. Below this, artwork prints visibly soft. */
export const MIN_DPI = PRINT_DPI; // 300

/**
 * Aspect-ratio tolerance (fraction). Print art is authored to exact pixel sizes;
 * a small slack absorbs rounding when a designer exports at, say, 1800×1200 for a
 * 6×4 piece. Beyond this the piece is the wrong shape for the chosen size.
 */
const ASPECT_TOLERANCE = 0.02;

/** Probed facts about an uploaded asset. Pixel dims are required for raster. */
export interface AssetProbe {
  /** Rendered pixel width. For PDF, the media-box width in px at 72pt→1in if known. */
  widthPx?: number;
  heightPx?: number;
  mimeType: string;
  sizeBytes?: number;
}

export type ValidationCode =
  | "unsupported_type"
  | "too_large"
  | "missing_dimensions"
  | "low_resolution"
  | "wrong_dimensions"
  | "unknown_size";

export interface ValidationIssue {
  code: ValidationCode;
  /** Plain-language, shop-owner-readable reason. */
  message: string;
}

export interface AssetValidationResult {
  ok: boolean;
  /** Effective DPI the art resolves to against the full-bleed box (null if unknown). */
  effectiveDpi: { horizontal: number; vertical: number } | null;
  errors: ValidationIssue[];
}

function isAcceptedMime(m: string): m is AcceptedMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(m);
}

/**
 * Validate a probed asset against a chosen mail-piece size.
 *
 * @param probe  probed asset facts (dimensions, MIME, bytes).
 * @param size   the chosen postcard size, or its full spec.
 * @param opts   maxBytes override (defaults to MAX_ASSET_BYTES).
 */
export function validateAsset(
  probe: AssetProbe,
  size: PostcardSize | MailPieceSpec | string,
  opts: { maxBytes?: number } = {},
): AssetValidationResult {
  const errors: ValidationIssue[] = [];
  const maxBytes = opts.maxBytes ?? MAX_ASSET_BYTES;

  // Resolve the target spec (fail closed on an unseeded size).
  const spec = resolveSpec(size);
  if (!spec) {
    return {
      ok: false,
      effectiveDpi: null,
      errors: [
        {
          code: "unknown_size",
          message: `We don't recognize the mail-piece size "${String(
            typeof size === "string" ? size : (size as MailPieceSpec).size,
          )}". Choose a supported postcard size (4x6, 6x9, or 6x11).`,
        },
      ],
    };
  }

  // 1. File type.
  if (!isAcceptedMime(probe.mimeType)) {
    errors.push({
      code: "unsupported_type",
      message: `This file type isn't accepted. Upload a PNG, JPG, or PDF (you uploaded "${probe.mimeType || "unknown"}").`,
    });
  }

  // 2. File size.
  if (typeof probe.sizeBytes === "number" && probe.sizeBytes > maxBytes) {
    errors.push({
      code: "too_large",
      message: `This file is too large (${mib(probe.sizeBytes)} MB). The limit is ${mib(maxBytes)} MB — try exporting a smaller file.`,
    });
  }

  // 3 & 4. Resolution + dimensions need pixel dims.
  let effectiveDpi: AssetValidationResult["effectiveDpi"] = null;
  const hasDims =
    typeof probe.widthPx === "number" &&
    typeof probe.heightPx === "number" &&
    probe.widthPx > 0 &&
    probe.heightPx > 0;

  if (!hasDims) {
    // Raster types must carry dimensions; PDFs may be vector (no meaningful px).
    if (probe.mimeType !== "application/pdf") {
      errors.push({
        code: "missing_dimensions",
        message:
          "We couldn't read this image's dimensions. Re-export it as a standard PNG or JPG and try again.",
      });
    }
    return { ok: errors.length === 0, effectiveDpi, errors };
  }

  const widthPx = probe.widthPx as number;
  const heightPx = probe.heightPx as number;

  // Effective DPI = pixels mapped onto the full-bleed print box.
  const dpiH = widthPx / spec.fullBleedWidthIn;
  const dpiV = heightPx / spec.fullBleedHeightIn;
  effectiveDpi = { horizontal: round1(dpiH), vertical: round1(dpiV) };

  // 4. Dimensions vs chosen size: the art's aspect must match the piece. A
  //    mismatch means it's sized for a different piece (wrong / oversized art).
  const artAspect = widthPx / heightPx;
  const specAspect = spec.fullBleedWidthIn / spec.fullBleedHeightIn;
  const aspectOff = Math.abs(artAspect - specAspect) / specAspect;
  if (aspectOff > ASPECT_TOLERANCE) {
    const expectW = Math.round(spec.fullBleedWidthIn * MIN_DPI);
    const expectH = Math.round(spec.fullBleedHeightIn * MIN_DPI);
    errors.push({
      code: "wrong_dimensions",
      message: `This image is the wrong shape for a ${spec.size} postcard. It's ${widthPx}×${heightPx} px; for ${spec.size} we need roughly ${expectW}×${expectH} px (with print bleed). Re-export it at the ${spec.size} size.`,
    });
  }

  // 3. Resolution: both axes must clear 300 DPI. Guard with a 1-DPI epsilon so a
  //    perfectly-sized 300-DPI export isn't tripped by float rounding.
  if (dpiH < MIN_DPI - 1 || dpiV < MIN_DPI - 1) {
    const worst = Math.floor(Math.min(dpiH, dpiV));
    errors.push({
      code: "low_resolution",
      message: `This image is too low-resolution for print (${worst} dots per inch). We need at least ${MIN_DPI} DPI — use a larger, higher-quality image.`,
    });
  }

  return { ok: errors.length === 0, effectiveDpi, errors };
}

function resolveSpec(size: PostcardSize | MailPieceSpec | string): MailPieceSpec | null {
  if (typeof size === "object" && size !== null) return size;
  if (isPostcardSize(size)) return getMailPieceSpec(size);
  return null;
}

function mib(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
