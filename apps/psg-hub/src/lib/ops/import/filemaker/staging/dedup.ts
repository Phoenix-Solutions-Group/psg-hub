// PSG-395 (Track B) — Pure dedup decision.
//
// Given what (if anything) already exists in the canonical table for an incoming
// source record, decide whether to insert, skip, or update. Pure so it is
// trivially unit-tested and the same rule governs both the in-memory test store
// and the live supabase store.

/**
 * What the canonical store already knows about a row that matches the incoming
 * record. Match is attempted by BUSINESS KEY (e.g. (company_id, ro_number)) —
 * that is the duplicate anchor the v1.1 importer also keyed on, so a row first
 * loaded by the single-file importer (with NULL provenance) is recognized here
 * and back-filled rather than duplicated.
 */
export type ExistingCanonical = {
  /** Stored content hash, or null when the row predates provenance tracking. */
  contentHash: string | null;
  sourceSystem: string | null;
  sourceId: string | null;
};

export type DedupAction = "insert" | "skip" | "update";

/**
 * Decide the action for one incoming source record.
 *
 *  - no existing business-key row                      -> insert
 *  - existing row, identical hash + matching provenance -> skip (true no-op)
 *  - existing row, different hash OR missing/mismatched
 *    provenance (needs back-fill)                       -> update
 *
 * The provenance check is what makes re-running over an already-single-file-
 * imported DB safe: such a row exists by business key but has source_system
 * NULL, so it is UPDATEd (back-filling source_system/source_id/content_hash)
 * exactly once; the next identical run then sees a matching hash and SKIPs.
 */
export function dedupAction(
  existing: ExistingCanonical | null | undefined,
  incoming: { sourceSystem: string; sourceId: string; contentHash: string },
): DedupAction {
  if (!existing) return "insert";

  const provenanceMatches =
    existing.sourceSystem === incoming.sourceSystem && existing.sourceId === incoming.sourceId;
  const hashMatches = existing.contentHash != null && existing.contentHash === incoming.contentHash;

  if (provenanceMatches && hashMatches) return "skip";
  return "update";
}
