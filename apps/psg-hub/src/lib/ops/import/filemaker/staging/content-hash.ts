// PSG-395 (Track B) — Deterministic content hash for staging dedup.
//
// The hash is the change-detection signal for the idempotent ingest: a source
// record whose raw columns are byte-identical to a prior import produces the
// same hash, so the upsert SKIPs it; any change flips the hash and the upsert
// UPDATEs the canonical row in place (never inserts a duplicate). Because dedup
// correctness rides on this, the hash MUST be stable across runs/processes:
//   - keys are sorted so JS object insertion order can't perturb it,
//   - values are coerced to string (landing columns are "as-text" anyway),
//   - empty string and a missing key are treated identically (both dropped),
//     so adding/removing a blank column does not spuriously change the hash.
import { createHash } from "node:crypto";

/**
 * Stable sha256 (hex) over a raw landing record's columns. Order-independent and
 * blank-insensitive (see module note). Used both to detect "unchanged source"
 * (skip) and "changed source" (update) against `repair_orders.content_hash` etc.
 */
export function stagingContentHash(columns: Record<string, string | null | undefined>): string {
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(columns)) {
    const value = columns[key];
    if (value == null) continue;
    const str = String(value);
    if (str === "") continue;
    normalized[key] = str;
  }
  const canonical = JSON.stringify(
    Object.keys(normalized)
      .sort()
      .map((key) => [key, normalized[key]]),
  );
  return createHash("sha256").update(canonical).digest("hex");
}
