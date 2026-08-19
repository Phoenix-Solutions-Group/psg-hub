// v1.4 / PSG-861 (PSG-849 follow-up): postcard compositor for Phase 3.
//
// Takes one uploaded front-page PDF + one uploaded back-page PDF and renders a
// single combined two-page output at Lob size + bleed. Elements from the design
// doc are drawn as vector/text overlays, then validated against clear zones and
// Lob address zones before returning the final asset bytes.
//
// This module intentionally stays isolated so existing HTML-first Lob behavior and
// the adapter surface stay intact.

import "server-only";
import {
  PDFDocument,
  StandardFonts,
  type PDFImage,
  type PDFDocument as PDFLibDocument,
  type PDFPage,
  rgb,
} from "pdf-lib";

const POINTS_PER_INCH = 72;
const DEFAULT_BLEED_IN = 0.125;
const ACCEPTED_DPI = 300;
const SOURCE_SIZE_TOLERANCE_IN = 0.01;

export type PostcardSize = "4x6" | "6x9" | "6x11";

export interface PostcardSizeSpec {
  trimWidthIn: number;
  trimHeightIn: number;
}

export const POSTCARD_SIZE_SPECS: Record<PostcardSize, PostcardSizeSpec> = {
  "4x6": { trimWidthIn: 6, trimHeightIn: 4 },
  "6x9": { trimWidthIn: 9, trimHeightIn: 6 },
  "6x11": { trimWidthIn: 11, trimHeightIn: 6 },
};

// Conservative defaults for design-system safety checks (inches). Coordinates use
// PDF-space bottom-left origin.
export const DEFAULT_CLEAR_ZONES: Record<PostcardSize, RectInches[]> = {
  "4x6": [{ x: 0, y: 0, width: 6, height: 0.25 }],
  "6x9": [{ x: 0, y: 0, width: 9, height: 0.25 }],
  "6x11": [{ x: 0, y: 0, width: 11, height: 0.25 }],
};

export const DEFAULT_ADDRESS_ZONES: Record<PostcardSize, RectInches[]> = {
  "4x6": [{ x: 4.6, y: 0.5, width: 1.3, height: 1.35 }],
  "6x9": [{ x: 7.2, y: 0.5, width: 1.3, height: 1.35 }],
  "6x11": [{ x: 9.15, y: 0.5, width: 1.55, height: 1.55 }],
};

export type RenderSurface = "front" | "back";
export interface RectInches {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourcePdf {
  bytes?: Uint8Array;
  url?: string;
  page?: number;
}

export type ArtworkAssetFormat = "pdf" | "png" | "jpg" | "jpeg";

export interface ArtworkAsset {
  bytes?: Uint8Array;
  url?: string;
  format: ArtworkAssetFormat;
}

export interface TextElement {
  kind: "text";
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  width?: number;
  color?: string;
  opacity?: number;
}

export interface RectElement {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor?: string;
  strokeColor?: string;
  lineWidth?: number;
  opacity?: number;
}

export interface LineElement {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lineWidth?: number;
  color?: string;
  opacity?: number;
}

export interface PolylineElement {
  kind: "polyline";
  points: Array<{ x: number; y: number }>;
  closePath?: boolean;
  lineWidth?: number;
  color?: string;
  opacity?: number;
}

export interface ImageElement {
  kind: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  source: ArtworkAsset;
  opacity?: number;
}

export interface LogoElement extends Omit<ImageElement, "kind"> {
  kind: "logo";
}

export interface ShapeElement extends Omit<RectElement, "kind"> {
  kind: "shape";
  shape: "rect";
}

export type RenderElement =
  | TextElement
  | RectElement
  | ShapeElement
  | LineElement
  | PolylineElement
  | ImageElement
  | LogoElement;

export interface RenderSurfaceInput {
  template?: SourcePdf;
  baseGraphic?: ArtworkAsset;
  elements?: readonly RenderElement[];
  clearZones?: readonly RectInches[];
  addressZones?: readonly RectInches[];
}

export interface MailArtworkSurfaceDesign {
  baseGraphic?: ArtworkAsset;
  elements?: readonly RenderElement[];
  clearZones?: readonly RectInches[];
  addressZones?: readonly RectInches[];
}

export interface MailArtworkDesignDocument {
  size: PostcardSize;
  front: MailArtworkSurfaceDesign;
  back: MailArtworkSurfaceDesign;
  bleedInches?: number;
  dpi?: number;
}

export interface RenderPostcardInput {
  size: PostcardSize;
  front: RenderSurfaceInput;
  back: RenderSurfaceInput;
  bleedInches?: number;
  dpi?: number;
  fetchPdf?: (url: string) => Promise<Uint8Array>;
  fetchAsset?: (url: string) => Promise<Uint8Array>;
}

export interface PostcardCanvas {
  trim: { widthIn: number; heightIn: number };
  bleedInches: number;
  withBleed: { widthIn: number; heightIn: number };
  widthPx: number;
  heightPx: number;
}

export interface RenderValidationIssue {
  surface: RenderSurface;
  kind: "bounds" | "clear-zone" | "address-zone" | "source-size" | "input";
  message: string;
  element?: RenderElement;
}

export interface RenderValidationResult {
  valid: boolean;
  issues: RenderValidationIssue[];
  canvas: PostcardCanvas;
}

export interface RenderPostcardResult {
  bytes: Uint8Array;
  validation: RenderValidationResult;
}

export interface PostcardRenderError extends Error {
  issues: RenderValidationIssue[];
}

function toPoints(inches: number): number {
  return inches * POINTS_PER_INCH;
}

function fromPoints(points: number): number {
  return points / POINTS_PER_INCH;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseColor(input?: string) {
  if (!input) return rgb(0, 0, 0);
  if (input.startsWith("#")) {
    if (input.length === 4) {
      const r = Number.parseInt(input.slice(1, 2).repeat(2), 16);
      const g = Number.parseInt(input.slice(2, 3).repeat(2), 16);
      const b = Number.parseInt(input.slice(3, 4).repeat(2), 16);
      return rgb(clamp01(r / 255), clamp01(g / 255), clamp01(b / 255));
    }
    if (input.length === 7) {
      const r = Number.parseInt(input.slice(1, 3), 16);
      const g = Number.parseInt(input.slice(3, 5), 16);
      const b = Number.parseInt(input.slice(5, 7), 16);
      return rgb(clamp01(r / 255), clamp01(g / 255), clamp01(b / 255));
    }
  }
  return rgb(0, 0, 0);
}

function isFiniteRect(rect: RectInches): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value));
}

function rectIntersects(a: RectInches, b: RectInches): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function estimateTextWidthInches(text: string, fontSize: number): number {
  return (fontSize * text.length * 0.52) / POINTS_PER_INCH;
}

function elementBounds(element: RenderElement): RectInches {
  if (element.kind === "text") {
    const fontSize = element.fontSize ?? 12;
    const width = element.width ?? estimateTextWidthInches(element.text, fontSize);
    return {
      x: element.x,
      y: element.y,
      width,
      height: Math.max(0.001, fontSize / POINTS_PER_INCH),
    };
  }
  if (element.kind === "rect") {
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
  }
  if (element.kind === "shape") {
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
  }
  if (element.kind === "image" || element.kind === "logo") {
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
  }
  if (element.kind === "line") {
    const minX = Math.min(element.x1, element.x2);
    const maxX = Math.max(element.x1, element.x2);
    const minY = Math.min(element.y1, element.y2);
    const maxY = Math.max(element.y1, element.y2);
    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  }
  const xs = element.points.map((point) => point.x);
  const ys = element.points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(0, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(0, Math.max(...ys) - Math.min(...ys)),
  };
}

function resolveCanvas(size: PostcardSize, bleedInches: number, dpi: number): PostcardCanvas {
  const spec = POSTCARD_SIZE_SPECS[size];
  const trim = {
    widthIn: spec.trimWidthIn,
    heightIn: spec.trimHeightIn,
  };
  return {
    trim,
    bleedInches,
    withBleed: {
      widthIn: trim.widthIn + bleedInches * 2,
      heightIn: trim.heightIn + bleedInches * 2,
    },
    widthPx: Math.round((trim.widthIn + bleedInches * 2) * dpi),
    heightPx: Math.round((trim.heightIn + bleedInches * 2) * dpi),
  };
}

function normalizeSurface(
  input: RenderSurfaceInput,
  size: PostcardSize,
  useDefaults: boolean
): RenderSurfaceInput {
  if (!useDefaults) return input;
  return {
    ...input,
    clearZones:
      input.clearZones && input.clearZones.length > 0 ? input.clearZones : DEFAULT_CLEAR_ZONES[size],
    addressZones:
      input.addressZones && input.addressZones.length > 0
        ? input.addressZones
        : DEFAULT_ADDRESS_ZONES[size],
  };
}

function validateSourceSpec(surface: RenderSurface, source: SourcePdf | undefined, issues: RenderValidationIssue[]) {
  if (!source) return;
  const hasBytes = Boolean(source.bytes);
  const hasUrl = Boolean(source.url);
  if (!hasBytes && !hasUrl) {
    issues.push({
      surface,
      kind: "input",
      message: `${surface}: source missing both bytes and url`,
    });
  }
  if (hasBytes && hasUrl) {
    issues.push({
      surface,
      kind: "input",
      message: `${surface}: source must include exactly one of bytes or url`,
    });
  }
  if (source.page !== undefined && (!Number.isInteger(source.page) || source.page < 0)) {
    issues.push({
      surface,
      kind: "input",
      message: `${surface}: source.page must be a non-negative integer if provided`,
    });
  }
}

function validateAssetSpec(
  surface: RenderSurface,
  asset: ArtworkAsset | undefined,
  label: string,
  issues: RenderValidationIssue[],
  element?: RenderElement
) {
  if (!asset) return;
  const hasBytes = Boolean(asset.bytes);
  const hasUrl = Boolean(asset.url);
  if (!hasBytes && !hasUrl) {
    issues.push({
      surface,
      kind: "input",
      message: `${surface}: ${label} missing both bytes and url`,
      element,
    });
  }
  if (hasBytes && hasUrl) {
    issues.push({
      surface,
      kind: "input",
      message: `${surface}: ${label} must include exactly one of bytes or url`,
      element,
    });
  }
  if (!["pdf", "png", "jpg", "jpeg"].includes(asset.format)) {
    issues.push({
      surface,
      kind: "input",
      message: `${surface}: ${label} has unsupported format ${asset.format}`,
      element,
    });
  }
}

function validateSurface(
  surface: RenderSurface,
  input: RenderSurfaceInput,
  pageRect: RectInches,
  issues: RenderValidationIssue[]
) {
  const clearZones = input.clearZones ?? [];
  const addressZones = input.addressZones ?? [];
  validateAssetSpec(surface, input.baseGraphic, "baseGraphic", issues);
  for (const zone of [...clearZones, ...addressZones]) {
    if (!isFiniteRect(zone) || zone.width <= 0 || zone.height <= 0) {
      issues.push({
        surface,
        kind: "input",
        message: `${surface}: zone has invalid dimensions`,
      });
    }
  }

  for (const element of input.elements ?? []) {
    if (element.kind === "polyline" && element.points.length < 2) {
      issues.push({
        surface,
        kind: "input",
        message: `${surface}: polyline requires at least two points`,
        element,
      });
      continue;
    }
    if ((element.kind === "image" || element.kind === "logo") && element.source) {
      validateAssetSpec(surface, element.source, `${element.kind} source`, issues, element);
    }
    if (element.kind === "shape" && element.shape !== "rect") {
      issues.push({
        surface,
        kind: "input",
        message: `${surface}: unsupported shape ${element.shape}`,
        element,
      });
      continue;
    }

    const bounds = elementBounds(element);
    if (!isFiniteRect(bounds) || bounds.width <= 0 || bounds.height <= 0) {
      issues.push({
        surface,
        kind: "input",
        message: `${surface}: invalid element bounds`,
        element,
      });
      continue;
    }

    if (
      bounds.x < pageRect.x ||
      bounds.y < pageRect.y ||
      bounds.x + bounds.width > pageRect.x + pageRect.width ||
      bounds.y + bounds.height > pageRect.y + pageRect.height
    ) {
      issues.push({
        surface,
        kind: "bounds",
        message: `${surface}: element outside page bounds`,
        element,
      });
    }

    for (const zone of clearZones) {
      if (rectIntersects(bounds, zone)) {
        issues.push({
          surface,
          kind: "clear-zone",
          message: `${surface}: element intersects a clear zone`,
          element,
        });
      }
    }

    for (const zone of addressZones) {
      if (rectIntersects(bounds, zone)) {
        issues.push({
          surface,
          kind: "address-zone",
          message: `${surface}: element intersects the address zone`,
          element,
        });
      }
    }
  }
}

/**
 * Validate a render spec before PDF composition.
 */
export function validatePostcardComposition(
  input: RenderPostcardInput
): RenderValidationResult {
  const bleedInches = input.bleedInches ?? DEFAULT_BLEED_IN;
  const dpi = input.dpi ?? ACCEPTED_DPI;
  const issues: RenderValidationIssue[] = [];
  const sizeSpec = POSTCARD_SIZE_SPECS[input.size];

  if (!Number.isFinite(dpi) || dpi <= 0) {
    issues.push({ surface: "front", kind: "input", message: "dpi must be a positive finite number" });
  } else if (Math.abs(dpi - ACCEPTED_DPI) > 0.01) {
    issues.push({
      surface: "front",
      kind: "input",
      message: `dpi must be ${ACCEPTED_DPI} (request received ${dpi})`,
    });
  }
  if (!Number.isFinite(bleedInches) || bleedInches < 0) {
    issues.push({
      surface: "front",
      kind: "input",
      message: "bleedInches must be a finite non-negative number",
    });
  }
  if (!sizeSpec) {
    issues.push({ surface: "front", kind: "input", message: `Unsupported postcard size ${input.size}` });
  }

  const pageRect: RectInches = {
    x: 0,
    y: 0,
    width: sizeSpec?.trimWidthIn ?? 0,
    height: sizeSpec?.trimHeightIn ?? 0,
  };

  validateSourceSpec("front", input.front.template, issues);
  validateSourceSpec("back", input.back.template, issues);
  validateSurface(
    "front",
    normalizeSurface(input.front, input.size, !input.front.clearZones?.length && !input.front.addressZones?.length),
    pageRect,
    issues
  );
  validateSurface(
    "back",
    normalizeSurface(input.back, input.size, !input.back.clearZones?.length && !input.back.addressZones?.length),
    pageRect,
    issues
  );

  return {
    valid: issues.length === 0,
    issues,
    canvas: sizeSpec
      ? resolveCanvas(input.size, bleedInches, dpi)
      : {
          trim: { widthIn: 0, heightIn: 0 },
          bleedInches,
          withBleed: { widthIn: bleedInches * 2, heightIn: bleedInches * 2 },
          widthPx: Math.round(bleedInches * 2 * dpi),
          heightPx: Math.round(bleedInches * 2 * dpi),
        },
  };
}

function drawText(
  page: PDFPage,
  element: TextElement,
  font: Awaited<ReturnType<PDFLibDocument["embedFont"]>>,
  bleedInches: number
) {
  const size = element.fontSize ?? 12;
  page.drawText(element.text, {
    x: toPoints(element.x + bleedInches),
    y: toPoints(element.y + bleedInches),
    size,
    color: parseColor(element.color),
    opacity: element.opacity,
    font,
  });
}

function drawRect(
  page: PDFPage,
  element: RectElement | ShapeElement,
  bleedInches: number
) {
  page.drawRectangle({
    x: toPoints(element.x + bleedInches),
    y: toPoints(element.y + bleedInches),
    width: toPoints(element.width),
    height: toPoints(element.height),
    color: element.fillColor ? parseColor(element.fillColor) : undefined,
    borderColor: element.strokeColor ? parseColor(element.strokeColor) : undefined,
    borderWidth: element.lineWidth,
    opacity: element.opacity,
  });
}

function drawLine(
  page: PDFPage,
  element: LineElement,
  bleedInches: number
) {
  page.drawLine({
    start: { x: toPoints(element.x1 + bleedInches), y: toPoints(element.y1 + bleedInches) },
    end: { x: toPoints(element.x2 + bleedInches), y: toPoints(element.y2 + bleedInches) },
    thickness: element.lineWidth,
    color: parseColor(element.color),
    opacity: element.opacity,
  });
}

function drawPolyline(
  page: PDFPage,
  element: PolylineElement,
  bleedInches: number
) {
  const points = element.points.map((point) => ({
    x: toPoints(point.x + bleedInches),
    y: toPoints(point.y + bleedInches),
  }));
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    page.drawLine({
      start: prev,
      end: curr,
      thickness: element.lineWidth,
      color: parseColor(element.color),
      opacity: element.opacity,
    });
  }
  if (element.closePath && points.length > 2) {
    page.drawLine({
      start: points.at(-1)!,
      end: points[0],
      thickness: element.lineWidth,
      color: parseColor(element.color),
      opacity: element.opacity,
    });
  }
}

async function resolveAssetBytes(
  asset: ArtworkAsset,
  fetchAsset: (url: string) => Promise<Uint8Array>
): Promise<Uint8Array> {
  if (asset.bytes) return asset.bytes;
  if (!asset.url) throw new Error("Asset source missing url");
  return fetchAsset(asset.url);
}

async function embedFetchedImage(
  outputDocument: PDFLibDocument,
  asset: ArtworkAsset,
  fetchAsset: (url: string) => Promise<Uint8Array>
): Promise<PDFImage> {
  const bytes = await resolveAssetBytes(asset, fetchAsset);
  return asset.format === "png" ? outputDocument.embedPng(bytes) : outputDocument.embedJpg(bytes);
}

async function drawImage(
  outputDocument: PDFLibDocument,
  page: PDFPage,
  element: ImageElement | LogoElement,
  bleedInches: number,
  fetchAsset: (url: string) => Promise<Uint8Array>
) {
  const image = await embedFetchedImage(outputDocument, element.source, fetchAsset);
  page.drawImage(image, {
    x: toPoints(element.x + bleedInches),
    y: toPoints(element.y + bleedInches),
    width: toPoints(element.width),
    height: toPoints(element.height),
    opacity: element.opacity,
  });
}

async function drawBaseGraphic(
  outputDocument: PDFLibDocument,
  page: PDFPage,
  baseGraphic: ArtworkAsset,
  opts: {
    bleedInches: number;
    canvas: PostcardCanvas;
    fetchAsset: (url: string) => Promise<Uint8Array>;
  }
) {
  if (baseGraphic.format === "pdf") {
    const bytes = await resolveAssetBytes(baseGraphic, opts.fetchAsset);
    const sourceDoc = await PDFDocument.load(bytes);
    const sourcePage = sourceDoc.getPage(0);
    const embedded = await outputDocument.embedPage(sourcePage);
    page.drawPage(embedded, {
      x: toPoints(opts.bleedInches),
      y: toPoints(opts.bleedInches),
      width: toPoints(opts.canvas.trim.widthIn),
      height: toPoints(opts.canvas.trim.heightIn),
    });
    return;
  }

  const image = await embedFetchedImage(outputDocument, baseGraphic, opts.fetchAsset);
  page.drawImage(image, {
    x: toPoints(opts.bleedInches),
    y: toPoints(opts.bleedInches),
    width: toPoints(opts.canvas.trim.widthIn),
    height: toPoints(opts.canvas.trim.heightIn),
  });
}

async function renderSurface(
  outputDocument: PDFLibDocument,
  input: RenderSurfaceInput,
  opts: {
    bleedInches: number;
    dpi: number;
    canvas: PostcardCanvas;
    fetchPdf: (url: string) => Promise<Uint8Array>;
    fetchAsset: (url: string) => Promise<Uint8Array>;
  }
) {
  const targetPage = outputDocument.addPage([
    toPoints(opts.canvas.withBleed.widthIn),
    toPoints(opts.canvas.withBleed.heightIn),
  ]);

  if (input.template) {
    const bytes = await (async () => {
      if (input.template?.bytes) return input.template.bytes;
      if (!input.template?.url) throw new Error("Template source missing url");
      return opts.fetchPdf(input.template.url);
    })();

    const sourceDoc = await PDFDocument.load(bytes);
    if (sourceDoc.getPageCount() === 0) {
      throw new Error("Template PDF has no pages");
    }
    const pageIndex = input.template.page ?? 0;
    if (pageIndex >= sourceDoc.getPageCount()) {
      throw new Error(`Template PDF missing page index ${pageIndex}`);
    }

    const sourcePage = sourceDoc.getPage(pageIndex);
    const sourceWidthIn = fromPoints(sourcePage.getWidth());
    const sourceHeightIn = fromPoints(sourcePage.getHeight());
    const embeddedSourcePage = await outputDocument.embedPage(sourcePage);
    if (
      Math.abs(sourceWidthIn - opts.canvas.trim.widthIn) > SOURCE_SIZE_TOLERANCE_IN ||
      Math.abs(sourceHeightIn - opts.canvas.trim.heightIn) > SOURCE_SIZE_TOLERANCE_IN
    ) {
      throw new Error(
        `Template page size mismatch: expected ${opts.canvas.trim.widthIn}x${opts.canvas.trim.heightIn}in, ` +
          `received ${sourceWidthIn.toFixed(3)}x${sourceHeightIn.toFixed(3)}in`
      );
    }

    targetPage.drawPage(embeddedSourcePage, {
      x: toPoints(opts.bleedInches),
      y: toPoints(opts.bleedInches),
      width: toPoints(opts.canvas.trim.widthIn),
      height: toPoints(opts.canvas.trim.heightIn),
    });
  }

  if (input.baseGraphic) {
    await drawBaseGraphic(outputDocument, targetPage, input.baseGraphic, opts);
  }

  const font = await outputDocument.embedFont(StandardFonts.Helvetica);
  for (const element of input.elements ?? []) {
    switch (element.kind) {
      case "text":
        drawText(targetPage, element, font, opts.bleedInches);
        break;
      case "rect":
      case "shape":
        drawRect(targetPage, element, opts.bleedInches);
        break;
      case "line":
        drawLine(targetPage, element, opts.bleedInches);
        break;
      case "polyline":
        drawPolyline(targetPage, element, opts.bleedInches);
        break;
      case "image":
      case "logo":
        await drawImage(outputDocument, targetPage, element, opts.bleedInches, opts.fetchAsset);
        break;
    }
  }
}

function resolveFetchPdf(fetchPdf?: (url: string) => Promise<Uint8Array>): (url: string) => Promise<Uint8Array> {
  if (fetchPdf) return fetchPdf;
  return async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url} (${response.status})`);
    }
    const array = await response.arrayBuffer();
    return new Uint8Array(array);
  };
}

function resolveFetchAsset(fetchAsset?: (url: string) => Promise<Uint8Array>): (url: string) => Promise<Uint8Array> {
  if (fetchAsset) return fetchAsset;
  return async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url} (${response.status})`);
    }
    const array = await response.arrayBuffer();
    return new Uint8Array(array);
  };
}

/**
 * Compose one-file, two-page printable postcard PDF:
 * page 1 = front, page 2 = back.
 */
export async function renderPostcardPdf(input: RenderPostcardInput): Promise<RenderPostcardResult> {
  const validation = validatePostcardComposition(input);
  if (!validation.valid) {
    const error = new Error("Postcard composition validation failed") as PostcardRenderError;
    error.issues = validation.issues;
    throw error;
  }

  const bleedInches = input.bleedInches ?? DEFAULT_BLEED_IN;
  const dpi = input.dpi ?? ACCEPTED_DPI;
  const fetchPdf = resolveFetchPdf(input.fetchPdf);
  const fetchAsset = resolveFetchAsset(input.fetchAsset);
  const canvas = validation.canvas;
  const useDefaults =
    !input.front.clearZones?.length && !input.front.addressZones?.length;
  const useBackDefaults =
    !input.back.clearZones?.length && !input.back.addressZones?.length;

  const outputPdf = await PDFDocument.create();
  await renderSurface(
    outputPdf,
    normalizeSurface(input.front, input.size, useDefaults),
    { bleedInches, dpi, canvas, fetchPdf, fetchAsset }
  );
  await renderSurface(
    outputPdf,
    normalizeSurface(input.back, input.size, useBackDefaults),
    { bleedInches, dpi, canvas, fetchPdf, fetchAsset }
  );
  const bytes = await outputPdf.save();

  return { bytes: new Uint8Array(bytes), validation };
}

export async function renderMailArtworkDesignPdf(
  design: MailArtworkDesignDocument,
  options: Pick<RenderPostcardInput, "fetchPdf" | "fetchAsset"> = {}
): Promise<RenderPostcardResult> {
  return renderPostcardPdf({
    size: design.size,
    bleedInches: design.bleedInches,
    dpi: design.dpi,
    front: {
      baseGraphic: design.front.baseGraphic,
      elements: design.front.elements,
      clearZones: design.front.clearZones,
      addressZones: design.front.addressZones,
    },
    back: {
      baseGraphic: design.back.baseGraphic,
      elements: design.back.elements,
      clearZones: design.back.clearZones,
      addressZones: design.back.addressZones,
    },
    ...options,
  });
}

export function renderPostcardCanvas(
  size: PostcardSize,
  bleedInches = DEFAULT_BLEED_IN,
  dpi = ACCEPTED_DPI
): PostcardCanvas {
  return resolveCanvas(size, bleedInches, dpi);
}
