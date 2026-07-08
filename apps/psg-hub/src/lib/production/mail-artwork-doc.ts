/**
 * Mail-artwork JSON document model (PSG-868, Phase-1 backend foundation).
 *
 * This is the shape stored in `mail_artwork_designs.doc` (jsonb) — the versioned,
 * portable description of ONE mail piece's artwork: which registry size it targets,
 * a base graphic per face, and the positioned freeform elements a designer laid on
 * top (text/shape/image), each measured in INCHES against the piece's full-bleed
 * artwork box. The DB stores it opaquely; this module is the authoritative parser/
 * validator so every reader (editor, render path, preflight) agrees on the shape.
 *
 * PURE: no DB, no network, no clock. `validateArtworkDoc` is a structural guard —
 * it checks shape + bounds sanity, NOT print compliance (clear-zone collisions,
 * DPI). Those live in mail-registry.ts (`intersectsClearZone`) and
 * mail-artwork-asset.ts (`validateAsset`) respectively.
 */

import { getMailSpec, isMailSpecKey, type MailSpec } from "./mail-registry";

/** Current on-disk doc schema version (bump when the JSON shape changes). */
export const ARTWORK_DOC_SCHEMA = 1;

/** Which printed face an element / base graphic sits on. */
export type ArtworkFace = "front" | "back";

/** Kinds of freeform element a designer can place. */
export type ArtworkElementType = "text" | "image" | "shape";

/**
 * One positioned freeform element. Position + size are in INCHES against the
 * piece's full-bleed artwork box, top-left origin (image/CSS space — the editor's
 * native coordinate world). Optional styling applies to `text` (font/size/color)
 * and `shape` (color = fill).
 */
export interface ArtworkElement {
  /** Stable id, unique within a face (editor selection / audit key). */
  id: string;
  type: ArtworkElementType;
  face: ArtworkFace;
  /** Left edge, inches from the artwork box's left. */
  xIn: number;
  /** Top edge, inches from the artwork box's top (top-left origin). */
  yIn: number;
  /** Width, inches. */
  wIn: number;
  /** Height, inches. */
  hIn: number;
  /** Stacking order within the face; higher paints later (on top). */
  z?: number;
  /** Text content (type === "text"). */
  text?: string;
  /** Font family key (type === "text"). */
  font?: string;
  /** Font size in points (type === "text"). */
  size?: number;
  /** Hex color — text/shape fill. */
  color?: string;
  /** Storage object key of a placed image (type === "image"), in the mail-artwork bucket. */
  assetKey?: string;
}

/** A base graphic filling one face (the background artwork before elements). */
export interface ArtworkBaseGraphic {
  face: ArtworkFace;
  /** Storage object key in the mail-artwork bucket. */
  assetKey: string;
}

/** The full versioned artwork document. */
export interface ArtworkDoc {
  /** Doc schema version — always ARTWORK_DOC_SCHEMA for docs this module writes. */
  schema: number;
  /** Registry key this artwork targets, e.g. "postcard:4x6". */
  sizeKey: string;
  /** Base graphic per face (0–2 entries; faces need not both be filled). */
  baseGraphics: ArtworkBaseGraphic[];
  /** Positioned freeform elements. */
  elements: ArtworkElement[];
}

/** A structured reason a doc failed structural validation. */
export interface ArtworkDocIssue {
  /** Machine code for the failing rule. */
  code:
    | "not_object"
    | "bad_schema"
    | "unknown_size"
    | "bad_base_graphics"
    | "bad_element"
    | "element_out_of_bounds";
  /** Human-readable explanation (surfaced to the editor). */
  message: string;
  /** Index into `elements`/`baseGraphics` when the issue is element-scoped. */
  index?: number;
}

export type ArtworkDocValidation =
  | { ok: true; doc: ArtworkDoc; spec: MailSpec }
  | { ok: false; issues: ArtworkDocIssue[] };

const ELEMENT_TYPES: ArtworkElementType[] = ["text", "image", "shape"];
const FACES: ArtworkFace[] = ["front", "back"];

function isFace(v: unknown): v is ArtworkFace {
  return typeof v === "string" && (FACES as string[]).includes(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Parse + structurally validate an untrusted artwork doc (e.g. a request body or
 * a stored jsonb row). Returns the typed doc + resolved spec on success, or a list
 * of structured issues. Bounds are checked against the resolved size's full-bleed
 * box (elements must have positive size and sit within the artwork box).
 */
export function validateArtworkDoc(input: unknown): ArtworkDocValidation {
  const issues: ArtworkDocIssue[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, issues: [{ code: "not_object", message: "Artwork doc must be an object." }] };
  }
  const raw = input as Record<string, unknown>;

  if (raw.schema !== ARTWORK_DOC_SCHEMA) {
    issues.push({
      code: "bad_schema",
      message: `Unsupported doc schema (expected ${ARTWORK_DOC_SCHEMA}).`,
    });
  }

  if (typeof raw.sizeKey !== "string" || !isMailSpecKey(raw.sizeKey)) {
    return {
      ok: false,
      issues: [
        ...issues,
        { code: "unknown_size", message: `Unknown mail size key: ${String(raw.sizeKey)}.` },
      ],
    };
  }
  const spec = getMailSpec(raw.sizeKey);
  const boxW = spec.fullBleed.inches.width;
  const boxH = spec.fullBleed.inches.height;

  // Base graphics.
  const baseGraphics: ArtworkBaseGraphic[] = [];
  if (raw.baseGraphics !== undefined) {
    if (!Array.isArray(raw.baseGraphics)) {
      issues.push({ code: "bad_base_graphics", message: "baseGraphics must be an array." });
    } else {
      raw.baseGraphics.forEach((g, index) => {
        const bg = g as Record<string, unknown>;
        if (!isFace(bg?.face) || typeof bg?.assetKey !== "string" || bg.assetKey.length === 0) {
          issues.push({
            code: "bad_base_graphics",
            message: "Each base graphic needs a valid face and non-empty assetKey.",
            index,
          });
          return;
        }
        baseGraphics.push({ face: bg.face, assetKey: bg.assetKey });
      });
    }
  }

  // Elements.
  const elements: ArtworkElement[] = [];
  if (raw.elements !== undefined) {
    if (!Array.isArray(raw.elements)) {
      issues.push({ code: "bad_element", message: "elements must be an array." });
    } else {
      raw.elements.forEach((e, index) => {
        const el = e as Record<string, unknown>;
        const typeOk = typeof el?.type === "string" && ELEMENT_TYPES.includes(el.type as ArtworkElementType);
        const geomOk =
          isFiniteNumber(el?.xIn) &&
          isFiniteNumber(el?.yIn) &&
          isFiniteNumber(el?.wIn) &&
          isFiniteNumber(el?.hIn);
        if (typeof el?.id !== "string" || el.id.length === 0 || !isFace(el?.face) || !typeOk || !geomOk) {
          issues.push({
            code: "bad_element",
            message: "Each element needs id, face, a valid type, and finite xIn/yIn/wIn/hIn.",
            index,
          });
          return;
        }
        const x = el.xIn as number;
        const y = el.yIn as number;
        const w = el.wIn as number;
        const h = el.hIn as number;
        if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > boxW + 1e-6 || y + h > boxH + 1e-6) {
          issues.push({
            code: "element_out_of_bounds",
            message: `Element ${el.id} is outside the ${spec.fullBleed.inches.width}×${spec.fullBleed.inches.height}" artwork box.`,
            index,
          });
          return;
        }
        elements.push({
          id: el.id,
          type: el.type as ArtworkElementType,
          face: el.face,
          xIn: x,
          yIn: y,
          wIn: w,
          hIn: h,
          ...(isFiniteNumber(el.z) ? { z: el.z } : {}),
          ...(typeof el.text === "string" ? { text: el.text } : {}),
          ...(typeof el.font === "string" ? { font: el.font } : {}),
          ...(isFiniteNumber(el.size) ? { size: el.size } : {}),
          ...(typeof el.color === "string" ? { color: el.color } : {}),
          ...(typeof el.assetKey === "string" ? { assetKey: el.assetKey } : {}),
        });
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    spec,
    doc: { schema: ARTWORK_DOC_SCHEMA, sizeKey: raw.sizeKey, baseGraphics, elements },
  };
}

/** A fresh empty doc for a given registry size — the editor's starting point. */
export function emptyArtworkDoc(sizeKey: string): ArtworkDoc {
  if (!isMailSpecKey(sizeKey)) throw new Error(`Unknown mail size key: ${sizeKey}`);
  return { schema: ARTWORK_DOC_SCHEMA, sizeKey, baseGraphics: [], elements: [] };
}
