/**
 * Deterministic, per-recipient anti-repeat variant selection (W2, PSG-304).
 *
 * A piece can fire for the same household more than once over the years; PSG's
 * rule is that a recipient never receives the SAME creative twice (AC2). This
 * module picks which variant of a piece a recipient gets, given the variants
 * they have already received, such that:
 *
 *   - a previously-sent variant is never chosen again (anti-repeat), and
 *   - the choice is fully deterministic in (runId, householdKey, pieceCode), so
 *     re-running the same run id reproduces the identical selection (AC3) — the
 *     proof a human approves is exactly what would print.
 *
 * When every variant has already been sent, the piece is EXHAUSTED for that
 * recipient and selection returns null (a hard anti-repeat stop) — the dry-run
 * records this as a suppression, it never falls back to repeating a variant.
 *
 * PURE: deterministic hash only (node:crypto), no clock, no random, no I/O.
 */

import { createHash } from "node:crypto";
import type { LetterDefinition, LetterVariant } from "./letter-matrix";
import { variantPieceCode } from "./letter-matrix";

/** Why no variant could be selected. */
export type VariantSkipReason = "no_variants" | "all_variants_exhausted";

export interface VariantSelection {
  variant: LetterVariant;
  /** `pieceCode:variantId` — the dedup / audit key for this exact creative. */
  variantPieceCode: string;
  /** Variant ids excluded because the recipient already received them. */
  excluded: string[];
}

export interface SelectVariantOptions {
  /** The run identifier — fixes the deterministic choice for the whole batch. */
  runId: string;
  /** Stable per-recipient key (household key / recipient hash). */
  recipientKey: string;
  /**
   * Variant ids of THIS piece the recipient has already received (from the
   * 30-yr send history). Those creatives are off the table.
   */
  priorVariantIds?: Iterable<string>;
}

/**
 * Stable 32-bit bucket from a string — same input always yields the same number,
 * across processes and deploys (sha256, not the runtime's hash).
 */
function stableBucket(seed: string): number {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

/**
 * Select the variant a recipient should receive for one piece, honoring
 * anti-repeat and determinism. Returns the selection, or a skip with the reason
 * when no fresh variant remains.
 */
export function selectVariant(
  def: LetterDefinition,
  options: SelectVariantOptions
): VariantSelection | { skip: VariantSkipReason; excluded: string[] } {
  const prior = new Set(options.priorVariantIds ?? []);
  const excluded = [...prior];

  if (def.variants.length === 0) return { skip: "no_variants", excluded };

  // Stable candidate order so the bucket maps to the same variant every run.
  const sorted = [...def.variants].sort((a, b) => a.id.localeCompare(b.id));
  const fresh = sorted.filter((v) => !prior.has(v.id));
  if (fresh.length === 0) return { skip: "all_variants_exhausted", excluded };

  const bucket = stableBucket(`${options.runId}|${options.recipientKey}|${def.pieceCode}`);
  const variant = fresh[bucket % fresh.length];
  return {
    variant,
    variantPieceCode: variantPieceCode(def, variant.id),
    excluded,
  };
}

/** Type guard: the selection succeeded (a variant was chosen). */
export function isVariantSelected(
  result: VariantSelection | { skip: VariantSkipReason; excluded: string[] }
): result is VariantSelection {
  return "variant" in result;
}
