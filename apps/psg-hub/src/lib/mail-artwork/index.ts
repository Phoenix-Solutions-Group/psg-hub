/**
 * Mail-Artwork Studio — backend foundation barrel (PSG-860, Phase 1).
 *
 * Public surface for Phase 2 (editor) and Phase 3 (render/preflight): the typed
 * size/spec registry with named clear zones, the uploaded-asset validator, and the
 * versioned artwork-document types persisted in `mail_artwork_designs`.
 */

export * from "@/lib/mail-artwork/spec-registry";
export * from "@/lib/mail-artwork/asset-validation";
export * from "@/lib/mail-artwork/types";

/** Storage bucket the Studio uploads print assets to (private, PSG-only RLS). */
export const MAIL_ARTWORK_BUCKET = "mail-artwork";
