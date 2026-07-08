/**
 * Mail-Artwork Studio — shared artwork-document types (PSG-860, Phase 1).
 *
 * The `mail_artwork_designs.doc` jsonb column stores a versioned artwork document:
 * the mail-piece the customer/PSG is designing, as a portable JSON tree the editor
 * (Phase 2) edits and the render/preflight path (Phase 3) consumes. Phase 1 fixes
 * the envelope shape + versioning; the layer/element vocabulary fills out in Phase 2.
 *
 * PURE types only — no runtime.
 */

import type { ClearZoneId } from "@/lib/mail-artwork/spec-registry";

/** Current artwork-document schema version. Bump on breaking `doc` shape changes. */
export const ARTWORK_DOC_SCHEMA_VERSION = 1;

/** A rectangle in inches, top-left origin, against the full-bleed artwork box. */
export interface DocRectIn {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which physical side of the piece a layer paints. */
export type MailPieceSide = "front" | "back";

/**
 * One placed element. Phase 1 keeps this intentionally open (`kind` + geometry +
 * free `props`) so the Phase-2 editor can grow image/text/shape kinds without a
 * migration; the render path switches on `kind`.
 */
export interface ArtworkElement {
  id: string;
  kind: "image" | "text" | "shape";
  side: MailPieceSide;
  /** Placement in inches against the full-bleed box (top-left origin). */
  rect: DocRectIn;
  /** For image elements: storage object path in the `mail-artwork` bucket. */
  assetPath?: string;
  /** Kind-specific properties (text runs, fills, fit mode, …). Phase-2 detail. */
  props?: Record<string, unknown>;
}

/**
 * The full artwork document persisted in `mail_artwork_designs.doc`.
 *
 * `specKey` binds the doc to a registry entry (e.g. "postcard-4x6"); the geometry
 * itself is never copied in — it is always re-derived from the spec registry so
 * there is exactly one source of truth for clear zones and bleed.
 */
export interface ArtworkDoc {
  schemaVersion: number;
  /** Registry key from the spec registry, e.g. "postcard-4x6". */
  specKey: string;
  elements: ArtworkElement[];
  /**
   * Optional per-doc override note for a clear zone (e.g. why art intentionally
   * sits near a non-authoritative reserve). Never overrides the authoritative
   * address zone.
   */
  clearZoneNotes?: Partial<Record<ClearZoneId, string>>;
}

/** An empty document for a given spec key — the editor's starting point. */
export function emptyArtworkDoc(specKey: string): ArtworkDoc {
  return { schemaVersion: ARTWORK_DOC_SCHEMA_VERSION, specKey, elements: [] };
}

/** Lifecycle status mirrored by `mail_artwork_designs.status`. */
export type DesignStatus = "draft" | "ready" | "archived";

/** A row of `mail_artwork_designs` (server-side shape). */
export interface MailArtworkDesignRow {
  id: string;
  company_id: string;
  template_key: string;
  version: number;
  status: DesignStatus;
  doc: ArtworkDoc;
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
}
