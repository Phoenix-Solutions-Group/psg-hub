/**
 * Mail-artwork asset validation (PSG-868, Phase-1 backend foundation).
 *
 * When a designer uploads a base graphic (PNG / JPEG / PDF), it must be print-safe
 * for the chosen mail size BEFORE it can back an artwork doc: high enough
 * resolution (Lob/print standard is 300 DPI) and dimensioned to cover the piece's
 * full-bleed artwork box. This module is the single validator both the upload
 * route and the editor's low-res error state read, so the reasons the customer
 * sees match the reasons the server enforces.
 *
 * PURE: no DB, no network, no file I/O. Callers extract the raw pixel dimensions
 * (and mime) upstream — where the bytes already live — and pass them here. That
 * keeps this module trivially unit-testable and free of an image-decoder dep.
 *
 * The DPI model: an uploaded raster has a fixed pixel count. Printed at the target
 * physical size (the piece's full-bleed box, in inches), its EFFECTIVE DPI is
 * pixels ÷ inches. We reject when that effective DPI on either axis falls below
 * the 300-DPI floor, or when the pixel dimensions imply the image can't cover the
 * box. Aspect-ratio drift beyond a small tolerance is flagged as a warning (the
 * render path cover-fits, but a large mismatch means visible cropping).
 */

import { getMailSpec, isMailSpecKey, PRINT_DPI, type MailSpec } from "./mail-registry";

/** Accepted upload mime types for a base graphic. */
export const ACCEPTED_ASSET_MIME = ["image/png", "image/jpeg", "application/pdf"] as const;
export type AcceptedAssetMime = (typeof ACCEPTED_ASSET_MIME)[number];

/** Minimum print resolution (DPI) an uploaded raster must meet. */
export const MIN_DPI = PRINT_DPI;

/**
 * Aspect-ratio tolerance (fraction) before a dimension mismatch is warned about.
 * The render path cover-fits, so small drift is fine; large drift means the piece
 * will be visibly cropped and the designer should know.
 */
export const ASPECT_TOLERANCE = 0.02;

/** Raw, decoder-extracted facts about an uploaded asset. */
export interface AssetProbe {
  mime: string;
  /** Pixel width (raster). Omit/0 for a vector PDF with no fixed raster size. */
  widthPx?: number;
  /** Pixel height (raster). */
  heightPx?: number;
}

/** A structured reason an asset was rejected — feeds the editor's error state. */
export interface AssetRejectReason {
  code: "unsupported_type" | "missing_dimensions" | "low_dpi" | "too_small";
  /** Human-readable, customer-safe explanation. */
  message: string;
  /** Machine detail for the UI (measured vs required), when applicable. */
  detail?: Record<string, number>;
}

/** A non-fatal advisory (upload still allowed). */
export interface AssetWarning {
  code: "aspect_mismatch";
  message: string;
  detail?: Record<string, number>;
}

export interface AssetValidation {
  ok: boolean;
  sizeKey: string;
  /** Effective print DPI on each axis (raster only; undefined for vector PDF). */
  effectiveDpi?: { x: number; y: number };
  rejects: AssetRejectReason[];
  warnings: AssetWarning[];
}

function isAcceptedMime(mime: string): mime is AcceptedAssetMime {
  return (ACCEPTED_ASSET_MIME as readonly string[]).includes(mime);
}

/** Round to 1 decimal for stable, readable DPI reporting. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Validate an uploaded asset against a registry size. Returns structured rejects
 * (each with a customer-safe message) and non-fatal warnings. `ok` is true only
 * when there are zero rejects.
 *
 * - PDF (vector): accepted on type alone; no raster DPI check possible without
 *   rasterising. The render/proof path (PSG-849) is the print-fidelity gate for
 *   PDFs. If a PDF carries pixel dimensions (a flattened raster PDF), they are
 *   checked like a raster.
 * - PNG/JPEG (raster): must carry pixel dimensions, meet the 300-DPI floor when
 *   printed at the full-bleed box size, and be large enough to cover the box.
 */
export function validateAsset(input: AssetProbe, sizeKey: string): AssetValidation {
  const rejects: AssetRejectReason[] = [];
  const warnings: AssetWarning[] = [];

  if (!isMailSpecKey(sizeKey)) {
    throw new Error(`Unknown mail size key: ${sizeKey}`);
  }
  const spec: MailSpec = getMailSpec(sizeKey);

  if (!isAcceptedMime(input.mime)) {
    rejects.push({
      code: "unsupported_type",
      message: `Unsupported file type "${input.mime}". Upload a PNG, JPEG, or PDF.`,
    });
    // Type is fatal on its own; no point measuring dimensions.
    return { ok: false, sizeKey, rejects, warnings };
  }

  const targetW = spec.fullBleed.inches.width;
  const targetH = spec.fullBleed.inches.height;
  const requiredPxW = Math.ceil(targetW * MIN_DPI);
  const requiredPxH = Math.ceil(targetH * MIN_DPI);

  const hasRaster = !!(input.widthPx && input.heightPx && input.widthPx > 0 && input.heightPx > 0);

  // A vector PDF (no raster dimensions) passes the resolution gate by construction.
  if (input.mime === "application/pdf" && !hasRaster) {
    return { ok: true, sizeKey, rejects, warnings };
  }

  if (!hasRaster) {
    rejects.push({
      code: "missing_dimensions",
      message: "Could not read the image's pixel dimensions. Re-export and try again.",
    });
    return { ok: false, sizeKey, rejects, warnings };
  }

  const wPx = input.widthPx as number;
  const hPx = input.heightPx as number;

  const effectiveDpi = { x: round1(wPx / targetW), y: round1(hPx / targetH) };

  // Resolution floor (300 DPI) on either axis.
  if (effectiveDpi.x < MIN_DPI || effectiveDpi.y < MIN_DPI) {
    rejects.push({
      code: "low_dpi",
      message: `Image is too low-resolution for ${spec.label}. At print size it is ${Math.min(
        effectiveDpi.x,
        effectiveDpi.y
      )} DPI; ${MIN_DPI} DPI is required. Upload a larger image (at least ${requiredPxW}×${requiredPxH} pixels).`,
      detail: { effectiveDpiX: effectiveDpi.x, effectiveDpiY: effectiveDpi.y, requiredDpi: MIN_DPI },
    });
  }

  // Coverage: must be large enough to fill the full-bleed box at the required DPI.
  if (wPx < requiredPxW || hPx < requiredPxH) {
    rejects.push({
      code: "too_small",
      message: `Image is ${wPx}×${hPx} pixels but ${spec.label} needs at least ${requiredPxW}×${requiredPxH} pixels to fill the print area.`,
      detail: { widthPx: wPx, heightPx: hPx, requiredPxW, requiredPxH },
    });
  }

  // Aspect drift (non-fatal — the render path cover-fits, but warn on big drift).
  const targetAspect = targetW / targetH;
  const imageAspect = wPx / hPx;
  const drift = Math.abs(imageAspect - targetAspect) / targetAspect;
  if (drift > ASPECT_TOLERANCE) {
    warnings.push({
      code: "aspect_mismatch",
      message: `Image proportions don't match ${spec.label}; part of the image will be cropped to fit.`,
      detail: { imageAspect: round1(imageAspect), targetAspect: round1(targetAspect) },
    });
  }

  return { ok: rejects.length === 0, sizeKey, effectiveDpi, rejects, warnings };
}
