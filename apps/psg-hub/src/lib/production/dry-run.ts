/**
 * End-to-end triggered-letter DRY RUN (W2, PSG-304).
 *
 * Proves the full matrix end-to-end without mailing anything: for each recipient
 * it resolves trigger → suppression → variant → merge → proof and emits an audit
 * row for every attempted piece. It is the executable form of PSG-304's
 * acceptance:
 *
 *   AC1  every earned letter resolves to a rendered proof.
 *   AC2  per-recipient anti-repeat — a recipient never gets a repeat letter or
 *        variant (piece-scoped `already_mailed` dedup + variant rotation, both
 *        seeded from the 30-yr history).
 *   AC3  deterministic in `runId` — the same run reproduces the same selection,
 *        so the audited proof IS what would print.
 *   AC4  ZERO live submits — this module never constructs or calls a mail
 *        adapter; every attempt writes an audit row with `submitted: false`.
 *
 * Two suppression layers compose here:
 *   - recipient/household do-not-mail (opt-out / bad-address / deceased) drops
 *     ALL of a recipient's pieces (engine `buildLetterPlan` layer);
 *   - piece-scoped `already_mailed` + per-recipient variant rotation enforce
 *     anti-repeat for a single piece (this orchestrator).
 *
 * PURE: no DB, no clock (caller passes `asOf`), no network. The route/service
 * layer assembles `recipients` from de-identified PSG-216 import rows + the
 * suppression rows, calls this, and renders the returned proofs in the gate UI.
 */

import {
  buildLetterPlan,
  validateRecoveryContent,
  type CustomerAttributes,
  type LetterPiece,
  type SuppressionList,
} from "./triggers";
import {
  definitionForPiece,
  templateForVariant,
  type LetterDefinition,
} from "./letter-matrix";
import { selectVariant, isVariantSelected } from "./variant-select";
import { buildMailDocument, type MailMergeData } from "./templates";
import { templateContentHash } from "./template-gate";
import { evaluateSuppression, type SuppressionRow } from "@/lib/ops/mail/suppression";
import type { MailAddress, MailDocument } from "./types";

/** One de-identified recipient to evaluate. Carries NO raw PII keys — only the
 *  salted household/recipient keys plus already-de-identified merge values. */
export interface DryRunRecipient {
  /** Stable de-identified label for the audit (e.g. import row index / hash). */
  ref: string;
  /** Trigger-engine inputs (survey + repair attributes). */
  attrs: CustomerAttributes;
  /** Merge data for rendering (de-identified sample / import values). */
  merge: MailMergeData;
  /** Addressing for the proof document (de-identified). */
  to: MailAddress;
  from: MailAddress;
  /** Salted household key — anti-repeat + suppression match. */
  householdKey?: string;
  /** Salted recipient hash — recipient-scoped suppression match. */
  recipientHash?: string;
  /**
   * Variants this recipient already received, per piece code, from the 30-yr
   * history. The rotation axis (./variant-select.ts) excludes these.
   */
  priorVariantsByPieceCode?: Record<string, string[]>;
}

export interface DryRunOptions {
  /** Fixes the deterministic variant selection for the whole run (AC3). */
  runId: string;
  /** As-of date (ISO yyyy-mm-dd) for time-effective suppression rules. */
  asOf?: string;
  /** 30-yr suppression rows (opt-out / bad-address / deceased / already_mailed). */
  suppressionRows?: readonly SuppressionRow[];
}

/** What happened to one attempted piece for one recipient. */
export type DryRunOutcome = "previewed" | "suppressed";

/** A single audit row — written for EVERY attempted piece (AC4). */
export interface DryRunAuditRow {
  runId: string;
  recipientRef: string;
  piece: LetterPiece;
  pieceCode: string;
  variantId?: string;
  variantPieceCode?: string;
  outcome: DryRunOutcome;
  /** Suppression / skip reason when `outcome === "suppressed"`. */
  reason?: string;
  /** Content hash of the exact proofed bytes (binds the audit to the proof). */
  contentHash?: string;
  /** Unresolved merge tokens, if any (surfaces an under-populated template). */
  missingTokens?: string[];
  /** Mode is ALWAYS dry-run; `submitted` is ALWAYS false (structural guarantee). */
  mode: "dry_run";
  submitted: false;
}

/** A rendered proof bound to its audit row (AC1: the gate preview). */
export interface DryRunProof {
  recipientRef: string;
  piece: LetterPiece;
  variantId: string;
  variantLabel: string;
  contentHash: string;
  document: MailDocument;
  missingTokens: string[];
}

export interface DryRunResult {
  runId: string;
  /** One row per attempted piece across all recipients. */
  audit: DryRunAuditRow[];
  /** Rendered proofs for the cleared (previewed) pieces. */
  proofs: DryRunProof[];
  counts: {
    recipients: number;
    attempted: number;
    previewed: number;
    suppressed: number;
  };
}

/** Build the engine-level (recipient/household) do-not-mail list from the rows.
 *  Piece scope is intentionally NOT consulted here — that is per-piece dedup. */
function recipientSuppressionList(
  rows: readonly SuppressionRow[],
  asOf: string
): SuppressionList {
  return {
    has(key: string): boolean {
      // `key` is the household OR recipient key; check both scopes (no piece).
      const res = evaluateSuppression(rows, {
        householdKey: key,
        recipientHash: key,
        asOf,
      });
      return res.suppressed;
    },
    reason(key: string): string | undefined {
      return evaluateSuppression(rows, { householdKey: key, recipientHash: key, asOf }).reason;
    },
  };
}

/**
 * Run the dry run over all recipients. Never mails — returns the proofs + the
 * full audit. Determinism: identical (recipients, options) → identical result.
 */
export function runLetterMatrixDryRun(
  recipients: readonly DryRunRecipient[],
  options: DryRunOptions
): DryRunResult {
  const { runId } = options;
  const asOf = options.asOf ?? "1970-01-01"; // caller should pass a real as-of
  const rows = options.suppressionRows ?? [];
  const suppressionList = recipientSuppressionList(rows, asOf);

  const audit: DryRunAuditRow[] = [];
  const proofs: DryRunProof[] = [];
  let attempted = 0;
  let previewed = 0;
  let suppressed = 0;

  const recordSuppressed = (
    recipientRef: string,
    piece: LetterPiece,
    pieceCode: string,
    reason: string,
    variantId?: string
  ): void => {
    attempted++;
    suppressed++;
    audit.push({
      runId,
      recipientRef,
      piece,
      pieceCode,
      variantId,
      outcome: "suppressed",
      reason,
      mode: "dry_run",
      submitted: false,
    });
  };

  for (const r of recipients) {
    const recipientKey = r.householdKey ?? r.recipientHash ?? r.ref;

    const plan = buildLetterPlan(r.attrs, {
      suppressionKey: recipientKey,
      suppressionList,
    });

    // Earned-but-engine-suppressed (do_not_mail / fleet / disengaged) → audit.
    for (const s of plan.suppressed) {
      const def = definitionForPiece(s.piece);
      recordSuppressed(r.ref, s.piece, def.pieceCode, s.suppressionReason);
    }

    for (const letter of plan.letters) {
      const def = definitionForPiece(letter.piece);

      // Piece-scoped anti-repeat: never re-mail THIS piece to THIS household.
      const pieceDedup = evaluateSuppression(rows, {
        householdKey: r.householdKey,
        recipientHash: r.recipientHash,
        pieceCode: def.pieceCode,
        asOf,
      });
      if (pieceDedup.suppressed) {
        recordSuppressed(r.ref, letter.piece, def.pieceCode, pieceDedup.reason ?? "already_mailed");
        continue;
      }

      // Variant rotation: never repeat a creative this recipient already got.
      const prior = r.priorVariantsByPieceCode?.[def.pieceCode];
      const selection = selectVariant(def, {
        runId,
        recipientKey,
        priorVariantIds: prior,
      });
      if (!isVariantSelected(selection)) {
        recordSuppressed(r.ref, letter.piece, def.pieceCode, selection.skip);
        continue;
      }

      // Render the exact proof (no adapter, ever).
      const template = definitionTemplate(def, selection.variant.id);
      const { document, missing } = buildMailDocument({
        template,
        data: r.merge,
        documentId: `dryrun:${runId}:${r.ref}:${selection.variantPieceCode}`,
        to: r.to,
        from: r.from,
        description: `[DRY RUN] ${def.name} (${selection.variant.label})`,
        metadata: { mode: "dry_run", runId, piece: letter.piece, variant: selection.variant.id },
      });

      // Recovery must never carry an offer/coupon — fail closed if it does.
      if (def.category === "recovery") {
        const html = document.file ?? "";
        const check = validateRecoveryContent(html);
        if (!check.ok) {
          recordSuppressed(
            r.ref,
            letter.piece,
            def.pieceCode,
            `recovery_offer_violation:${check.offenders.join(",")}`,
            selection.variant.id
          );
          continue;
        }
      }

      const contentHash = templateContentHash(template);
      attempted++;
      previewed++;
      audit.push({
        runId,
        recipientRef: r.ref,
        piece: letter.piece,
        pieceCode: def.pieceCode,
        variantId: selection.variant.id,
        variantPieceCode: selection.variantPieceCode,
        outcome: "previewed",
        contentHash,
        missingTokens: missing,
        mode: "dry_run",
        submitted: false,
      });
      proofs.push({
        recipientRef: r.ref,
        piece: letter.piece,
        variantId: selection.variant.id,
        variantLabel: selection.variant.label,
        contentHash,
        document,
        missingTokens: missing,
      });
    }
  }

  return {
    runId,
    audit,
    proofs,
    counts: { recipients: recipients.length, attempted, previewed, suppressed },
  };
}

// Resolve the variant template via the matrix (the matrix owns composition).
function definitionTemplate(def: LetterDefinition, variantId: string) {
  const variant = def.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`Variant "${variantId}" not found on piece "${def.piece}"`);
  return templateForVariant(def, variant);
}
