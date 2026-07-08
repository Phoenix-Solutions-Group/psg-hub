import "server-only";

/**
 * Lob postcard render proof (PSG-849, Phase-0 spike for the mail-artwork module).
 *
 * Proves the one thing the reframed mail-artwork module (parent PSG-836) rests
 * on: that we can assemble a **Lob-compliant, print-ready postcard PDF in-process
 * with pdf-lib** — correct full-bleed page size, uploaded artwork placed to the
 * bleed edge, and the address/barcode ink-free zone left blank — WITHOUT the
 * Chromium HTML→PDF worker (`render-pdf.ts`). That existing path renders authored
 * HTML on a remote host; the designer flow instead takes an uploaded image/PDF
 * plus a few overlay fields, which is exactly pdf-lib's wheelhouse (embed raster,
 * draw vectors, fixed page geometry) and runs on Vercel's Node runtime with no
 * external hop.
 *
 * All geometry comes from `postcard-registry.ts` (single source of truth). pdf-lib
 * uses a BOTTOM-LEFT origin and POINTS, so we draw with the registry's
 * `bottomLeft` rects scaled by `inToPt`.
 *
 * SCOPE (spike): front + back page assembly, PNG/JPEG artwork embed, clear-zone
 * white-out, and an optional guide overlay (trim / safe / clear-zone) for a human
 * proof. Uploaded-PDF artwork (embedPdf/copyPages) and Lob submission wiring are
 * out of scope here — noted in the findings doc as the next step.
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  type PDFPage,
  type PDFFont,
  type PDFImage,
} from "pdf-lib";
import {
  getPostcardSpec,
  inToPt,
  type PostcardSize,
  type RectIn,
} from "./postcard-registry";

/** Supported uploaded-artwork raster formats for the spike. */
export type ArtworkFormat = "png" | "jpg";

export interface ArtworkInput {
  /** Raw image bytes (as uploaded). */
  bytes: Uint8Array;
  format: ArtworkFormat;
}

export interface PostcardProofOptions {
  size: PostcardSize;
  /** Front-side artwork; placeholder is drawn when omitted. */
  front?: ArtworkInput;
  /** Back-side artwork; placeholder is drawn when omitted. */
  back?: ArtworkInput;
  /**
   * Draw the trim / safe-area / ink-free-zone guide overlay (magenta/cyan) and
   * corner labels. TRUE = a human proof sheet; FALSE = a clean print-ready file.
   * Guides are drawn in non-printing-intent colors but are still ink — never send
   * a guide-on PDF to Lob for a real mailing.
   */
  guides?: boolean;
  /** Optional label baked into the guide overlay (e.g. a batch/shop id). */
  label?: string;
}

// Registry-driven guide colors.
const TRIM_COLOR = rgb(0, 0.6, 0.85); // cyan — trim line
const SAFE_COLOR = rgb(0.2, 0.7, 0.2); // green — safe area
const CLEARZONE_COLOR = rgb(0.9, 0.1, 0.55); // magenta — ink-free zone
const PLACEHOLDER_FRONT = rgb(0.06, 0.17, 0.38); // PSG deep blue
const PLACEHOLDER_BACK = rgb(0.96, 0.96, 0.97); // near-white paper

/**
 * Render a two-page (front, back) print-ready postcard PDF for `size`.
 *
 * Page geometry is the full-bleed box; artwork is scaled to cover it (bleed to
 * edge). On the back, the ink-free zone is painted white last so no uploaded
 * artwork can bleed into the address/barcode area — the registry's compliance
 * guarantee made physical. Returns the serialized PDF bytes.
 */
export async function renderPostcardProofPdf(
  opts: PostcardProofOptions
): Promise<Uint8Array> {
  const spec = getPostcardSpec(opts.size);
  const pageW = inToPt(spec.fullBleed.inches.width);
  const pageH = inToPt(spec.fullBleed.inches.height);

  const doc = await PDFDocument.create();
  doc.setTitle(`PSG postcard proof ${opts.size}`);
  doc.setCreator("psg-hub mail-artwork (PSG-849 spike)");
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // ---- Front ----
  const front = doc.addPage([pageW, pageH]);
  await paintArtwork(doc, front, opts.front, PLACEHOLDER_FRONT, "FRONT", font, pageW, pageH);
  if (opts.guides) drawGuides(front, spec, font, false, opts.label);

  // ---- Back (address side) ----
  const back = doc.addPage([pageW, pageH]);
  await paintArtwork(doc, back, opts.back, PLACEHOLDER_BACK, "BACK", font, pageW, pageH);
  // Enforce the ink-free zone: paint it white AFTER artwork, before guides.
  whiteOutClearZone(back, spec.clearZone.bottomLeft);
  if (opts.guides) drawGuides(back, spec, font, true, opts.label);

  return doc.save();
}

/**
 * Render a single-page-per-size guide/proof sheet for ALL sizes — a visual
 * artifact for reviewers to eyeball that the registry rectangles land where Lob's
 * spec sheet says. Back-side layout (shows the ink-free zone) for every size.
 */
export async function renderRegistryProofSheet(
  sizes: PostcardSize[] = ["4x6", "6x9", "6x11"]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("PSG Lob postcard registry — geometry proof");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const size of sizes) {
    const spec = getPostcardSpec(size);
    const pageW = inToPt(spec.fullBleed.inches.width);
    const pageH = inToPt(spec.fullBleed.inches.height);
    const page = doc.addPage([pageW, pageH]);
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: PLACEHOLDER_BACK });
    whiteOutClearZone(page, spec.clearZone.bottomLeft);
    drawGuides(page, spec, font, true, `${size} — registry proof`);
  }
  return doc.save();
}

/** Embed + cover-fit artwork, or draw a labeled placeholder fill. */
async function paintArtwork(
  doc: PDFDocument,
  page: PDFPage,
  art: ArtworkInput | undefined,
  placeholder: ReturnType<typeof rgb>,
  label: string,
  font: PDFFont,
  pageW: number,
  pageH: number
): Promise<void> {
  if (!art) {
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: placeholder });
    const isDark = placeholder === PLACEHOLDER_FRONT;
    page.drawText(`${label} — placeholder`, {
      x: 18,
      y: pageH - 26,
      size: 11,
      font,
      color: isDark ? rgb(1, 1, 1) : rgb(0.4, 0.4, 0.45),
    });
    return;
  }
  const img: PDFImage =
    art.format === "png" ? await doc.embedPng(art.bytes) : await doc.embedJpg(art.bytes);
  // Cover-fit: scale so the image fully covers the bleed box, center-crop.
  const scale = Math.max(pageW / img.width, pageH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
}

/** Paint the ink-free zone white so nothing prints under the address/barcode. */
function whiteOutClearZone(page: PDFPage, czIn: RectIn): void {
  page.drawRectangle({
    x: inToPt(czIn.x),
    y: inToPt(czIn.y),
    width: inToPt(czIn.width),
    height: inToPt(czIn.height),
    color: rgb(1, 1, 1),
  });
}

/** Draw trim / safe / clear-zone guide outlines (+ labels). Non-print artifact. */
function drawGuides(
  page: PDFPage,
  spec: ReturnType<typeof getPostcardSpec>,
  font: PDFFont,
  showClearZone: boolean,
  label?: string
): void {
  const strokeRect = (
    r: RectIn,
    color: ReturnType<typeof rgb>,
    dashed = false
  ): void => {
    page.drawRectangle({
      x: inToPt(r.x),
      y: inToPt(r.y),
      width: inToPt(r.width),
      height: inToPt(r.height),
      borderColor: color,
      borderWidth: 1,
      borderDashArray: dashed ? [4, 3] : undefined,
    });
  };

  // Trim line = full-bleed inset by the bleed on every edge.
  const b = spec.bleedIn;
  strokeRect(
    {
      x: b,
      y: b,
      width: spec.trim.inches.width,
      height: spec.trim.inches.height,
    },
    TRIM_COLOR
  );
  strokeRect(spec.safeArea.bottomLeft, SAFE_COLOR, true);

  if (showClearZone) {
    strokeRect(spec.clearZone.bottomLeft, CLEARZONE_COLOR);
    const cz = spec.clearZone.bottomLeft;
    page.drawText("ADDRESS / BARCODE — INK-FREE", {
      x: inToPt(cz.x) + 6,
      y: inToPt(cz.y) + inToPt(cz.height) - 14,
      size: 8,
      font,
      color: CLEARZONE_COLOR,
    });
  }

  if (label) {
    page.drawText(label, {
      x: inToPt(b) + 6,
      y: inToPt(b) + 6,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.35),
      rotate: degrees(0),
    });
  }
}
