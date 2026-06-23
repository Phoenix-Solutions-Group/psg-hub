import { describe, it, expect } from "vitest";
import {
  LETTER_MATRIX,
  LETTER_DEFINITIONS,
  definitionForPiece,
  templateForVariant,
  variantPieceCode,
} from "@/lib/production/letter-matrix";
import { selectVariant, isVariantSelected } from "@/lib/production/variant-select";
import {
  runLetterMatrixDryRun,
  type DryRunRecipient,
} from "@/lib/production/dry-run";
import type { CustomerAttributes, LetterPiece } from "@/lib/production/triggers";
import { TRIGGER_RULES, validateRecoveryContent } from "@/lib/production/triggers";
import type { MailMergeData } from "@/lib/production/templates";
import { SAMPLE_MERGE_DATA } from "@/lib/production/template-gate";
import type { MailAddress } from "@/lib/production/types";
import { alreadyMailedRow, type SuppressionRow } from "@/lib/ops/mail/suppression";

/* -------------------------------------------------------------------------- */
/* Shared fixtures — fully-populated sample so a complete template shows 0     */
/* missing tokens; de-identified throughout (never a real customer).          */
/* -------------------------------------------------------------------------- */

// Reuse the canonical, fully-populated proof sample (PSG-308) so the approved
// W1 masters reused as canonical variants render with 0 missing tokens; extend
// it with `offer` for the upsell pieces' coupon block.
const SAMPLE_MERGE: MailMergeData = {
  ...SAMPLE_MERGE_DATA,
  // SAMPLE_MERGE_DATA.program already carries warrantyTerm (PSG-316 C1); add the
  // upsell coupon. reviewLink stays unset → perfect_score falls back to "online".
  program: { ...SAMPLE_MERGE_DATA.program, offer: "$25 off" },
};

const TO: MailAddress = {
  name: "Jordan Rivera",
  addressLine1: "100 Example St",
  city: "Lincoln",
  state: "NE",
  zip: "68508",
};
const FROM: MailAddress = {
  name: "ABC Collision",
  addressLine1: "1 Shop Way",
  city: "Lincoln",
  state: "NE",
  zip: "68508",
};

/** Minimal attributes that guarantee `piece` is earned by the trigger tree. */
function attrsFor(piece: LetterPiece): CustomerAttributes {
  switch (piece) {
    case "service_recovery":
      return { estimateOnly: false, surveyReturned: true, unresolvedIssue: true };
    case "perfect_score":
      return { estimateOnly: false, surveyReturned: true, emi: 1, wouldRecommend: true };
    case "recommend_agent":
      // offersAgentReferral is the per-shop capability gate (PSG-316 C2): the
      // piece only earns for a shop that actually keeps vetted agent relationships.
      return { estimateOnly: false, agentDissatisfied: true, offersAgentReferral: true };
    case "agent_acknowledgement":
      return { estimateOnly: false, agentIdentified: true };
    case "call_your_agent":
      return {
        estimateOnly: false,
        surveyReturned: true,
        agentIdentified: true,
        emi: 0.9,
        wouldRecommend: true,
      };
    case "totaled_vehicle":
      return { totalLoss: true };
    case "estimate_followup":
      return { estimateOnly: true };
    case "warranty":
      return { estimateOnly: false, totalLoss: false, inWarranty: true };
    case "thank_you":
      return { estimateOnly: false, totalLoss: false };
    case "cycle_anniversary":
      return { estimateOnly: false, totalLoss: false, daysSinceService: 400 };
    case "seasonal_greeting":
      return { greetingOccasion: "birthday" };
  }
}

function recipientFor(piece: LetterPiece, overrides: Partial<DryRunRecipient> = {}): DryRunRecipient {
  return {
    ref: `r-${piece}`,
    attrs: attrsFor(piece),
    merge: SAMPLE_MERGE,
    to: TO,
    from: FROM,
    householdKey: `hh-${piece}`,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Matrix integrity                                                            */
/* -------------------------------------------------------------------------- */

describe("LETTER_MATRIX integrity", () => {
  it("registers a definition for every piece in the trigger tree", () => {
    const triggerPieces = new Set(TRIGGER_RULES.map((r) => r.piece));
    for (const piece of triggerPieces) {
      expect(LETTER_MATRIX[piece], `missing matrix entry for ${piece}`).toBeDefined();
    }
  });

  it("every piece carries >= 2 variants (the anti-repeat rotation axis)", () => {
    for (const def of LETTER_DEFINITIONS) {
      expect(def.variants.length, `${def.piece} needs >= 2 variants`).toBeGreaterThanOrEqual(2);
    }
  });

  it("variant ids are unique within a piece", () => {
    for (const def of LETTER_DEFINITIONS) {
      const ids = def.variants.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("piece codes are unique across the matrix (clean suppression keys)", () => {
    const codes = LETTER_DEFINITIONS.map((d) => d.pieceCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("matrix category/recipient mirror the trigger rule for each piece", () => {
    for (const rule of TRIGGER_RULES) {
      const def = definitionForPiece(rule.piece);
      expect(def.category).toBe(rule.category);
      expect(def.recipient).toBe(rule.recipient);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* AC1 — every letter resolves end-to-end to a clean proof                     */
/* -------------------------------------------------------------------------- */

describe("AC1: every letter resolves trigger → template + variant → merge → proof", () => {
  for (const def of LETTER_DEFINITIONS) {
    it(`${def.piece} resolves to a rendered proof with 0 unresolved tokens`, () => {
      const result = runLetterMatrixDryRun([recipientFor(def.piece)], { runId: "run-1" });
      const proof = result.proofs.find((p) => p.piece === def.piece);
      expect(proof, `no proof produced for ${def.piece}`).toBeDefined();
      expect(proof!.missingTokens).toEqual([]);
      // The proof is a real letter document with rendered HTML body.
      expect(proof!.document.file).toMatch(/<html/i);
      expect(proof!.document.file).toContain("Demo Body Works");
    });
  }

  it("renders every variant of every piece with 0 unresolved tokens", () => {
    for (const def of LETTER_DEFINITIONS) {
      for (const v of def.variants) {
        const template = templateForVariant(def, v);
        // Render directly through the engine path the proof uses.
        const result = runLetterMatrixDryRun(
          [recipientFor(def.piece, { priorVariantsByPieceCode: { [def.pieceCode]: def.variants.filter((x) => x.id !== v.id).map((x) => x.id) } })],
          { runId: "run-variant" }
        );
        const proof = result.proofs.find((p) => p.piece === def.piece);
        expect(proof?.variantId, `${def.piece} should select ${v.id}`).toBe(v.id);
        expect(proof?.missingTokens, `${def.piece}/${v.id} has unresolved tokens`).toEqual([]);
        expect(template.bodyHtml).toBeTruthy();
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* AC2 — per-recipient anti-repeat                                             */
/* -------------------------------------------------------------------------- */

describe("AC2: per-recipient anti-repeat (letter + variant)", () => {
  it("rotates to a fresh variant when one was already sent", () => {
    const def = definitionForPiece("thank_you");
    const result = runLetterMatrixDryRun(
      [recipientFor("thank_you", { priorVariantsByPieceCode: { [def.pieceCode]: ["A"] } })],
      { runId: "run-x" }
    );
    const proof = result.proofs.find((p) => p.piece === "thank_you");
    expect(proof?.variantId).toBe("B"); // A excluded → must pick B
  });

  it("suppresses a piece entirely once every variant has been sent", () => {
    const def = definitionForPiece("thank_you");
    const allIds = def.variants.map((v) => v.id);
    const result = runLetterMatrixDryRun(
      [recipientFor("thank_you", { priorVariantsByPieceCode: { [def.pieceCode]: allIds } })],
      { runId: "run-x" }
    );
    expect(result.proofs.find((p) => p.piece === "thank_you")).toBeUndefined();
    const row = result.audit.find((a) => a.piece === "thank_you");
    expect(row?.outcome).toBe("suppressed");
    expect(row?.reason).toBe("all_variants_exhausted");
  });

  it("honors piece-scoped already_mailed dedup from the 30-yr history", () => {
    const def = definitionForPiece("thank_you");
    const rows: SuppressionRow[] = [
      alreadyMailedRow({
        householdKey: "hh-thank_you",
        pieceCode: def.pieceCode,
        sentDate: "2010-01-01",
      }),
    ];
    const result = runLetterMatrixDryRun([recipientFor("thank_you")], {
      runId: "run-x",
      asOf: "2026-06-23",
      suppressionRows: rows,
    });
    expect(result.proofs.find((p) => p.piece === "thank_you")).toBeUndefined();
    const row = result.audit.find((a) => a.piece === "thank_you" && a.outcome === "suppressed");
    expect(row?.reason).toBe("already_mailed");
  });

  it("a household opt-out drops ALL of that recipient's pieces", () => {
    const rows: SuppressionRow[] = [
      {
        scope: "household",
        household_key: "hh-thank_you",
        recipient_hash: null,
        piece_code: null,
        reason: "opt_out",
        effective_from: "2020-01-01",
      },
    ];
    const result = runLetterMatrixDryRun([recipientFor("thank_you")], {
      runId: "run-x",
      asOf: "2026-06-23",
      suppressionRows: rows,
    });
    expect(result.proofs.length).toBe(0);
    expect(result.audit.every((a) => a.outcome === "suppressed")).toBe(true);
    expect(result.audit.some((a) => a.reason === "do_not_mail")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* AC3 — determinism                                                          */
/* -------------------------------------------------------------------------- */

describe("AC3: deterministic in runId", () => {
  const recipients = LETTER_DEFINITIONS.map((d) => recipientFor(d.piece));

  it("same runId reproduces an identical audit + proof selection", () => {
    const a = runLetterMatrixDryRun(recipients, { runId: "run-determinism" });
    const b = runLetterMatrixDryRun(recipients, { runId: "run-determinism" });
    expect(b.audit).toEqual(a.audit);
    expect(b.proofs.map((p) => [p.recipientRef, p.piece, p.variantId, p.contentHash])).toEqual(
      a.proofs.map((p) => [p.recipientRef, p.piece, p.variantId, p.contentHash])
    );
  });

  it("content hash binds the audit row to the exact proofed bytes", () => {
    const r = runLetterMatrixDryRun([recipientFor("perfect_score")], { runId: "run-h" });
    const proof = r.proofs.find((p) => p.piece === "perfect_score")!;
    const row = r.audit.find((a) => a.piece === "perfect_score" && a.outcome === "previewed")!;
    expect(row.contentHash).toBe(proof.contentHash);
    expect(row.variantPieceCode).toBe(variantPieceCode(definitionForPiece("perfect_score"), proof.variantId));
  });
});

/* -------------------------------------------------------------------------- */
/* AC4 — zero live submits, audit row per attempt                             */
/* -------------------------------------------------------------------------- */

describe("AC4: dry-run only — zero live submits, audit per attempt", () => {
  const recipients = LETTER_DEFINITIONS.map((d) => recipientFor(d.piece));
  const result = runLetterMatrixDryRun(recipients, { runId: "run-audit" });

  it("every audit row is dry-run and never submitted", () => {
    expect(result.audit.length).toBeGreaterThan(0);
    for (const row of result.audit) {
      expect(row.mode).toBe("dry_run");
      expect(row.submitted).toBe(false);
    }
  });

  it("counts reconcile: attempted == previewed + suppressed", () => {
    const { attempted, previewed, suppressed } = result.counts;
    expect(attempted).toBe(previewed + suppressed);
    expect(result.audit.length).toBe(attempted);
    expect(result.proofs.length).toBe(previewed);
  });
});

/* -------------------------------------------------------------------------- */
/* Recovery offer guard + variant selector unit                               */
/* -------------------------------------------------------------------------- */

describe("recovery is offer-free and variant selection is sound", () => {
  it("no recovery variant trips the LIVE offer guard (validateRecoveryContent)", () => {
    const def = definitionForPiece("service_recovery");
    for (const v of def.variants) {
      const t = templateForVariant(def, v);
      expect(validateRecoveryContent(t.bodyHtml ?? "").ok, `${def.piece}/${v.id}`).toBe(true);
    }
  });

  // PSG-311 regression: the live guard must catch BARE dollar offers. The prior
  // `\b\$\d` branch silently passed "$25 off" (the literal program.offer value).
  it("validateRecoveryContent fails closed on bare dollar offers", () => {
    for (const bad of ["Present this letter for $25 off.", "save $50 today", "$5 off your visit"]) {
      const res = validateRecoveryContent(`<p>${bad}</p>`);
      expect(res.ok, `should reject: ${bad}`).toBe(false);
      expect(res.offenders.length).toBeGreaterThan(0);
    }
  });

  it("validateRecoveryContent also still catches word offers and passes clean copy", () => {
    expect(validateRecoveryContent("<p>here is a coupon</p>").ok).toBe(false);
    expect(validateRecoveryContent("<p>20% off</p>").ok).toBe(false);
    expect(validateRecoveryContent("<p>Please call me directly. I will make it right.</p>").ok).toBe(
      true
    );
  });

  it("selectVariant skips when all variants are exhausted", () => {
    const def = definitionForPiece("thank_you");
    const res = selectVariant(def, {
      runId: "r",
      recipientKey: "k",
      priorVariantIds: def.variants.map((v) => v.id),
    });
    expect(isVariantSelected(res)).toBe(false);
  });

  it("selectVariant is stable for the same (runId, recipient, piece)", () => {
    const def = definitionForPiece("thank_you");
    const a = selectVariant(def, { runId: "r1", recipientKey: "k1" });
    const b = selectVariant(def, { runId: "r1", recipientKey: "k1" });
    expect(isVariantSelected(a) && isVariantSelected(b)).toBe(true);
    if (isVariantSelected(a) && isVariantSelected(b)) expect(a.variant.id).toBe(b.variant.id);
  });
});

/* -------------------------------------------------------------------------- */
/* Honest-claims go-live gates (PSG-316)                                       */
/* -------------------------------------------------------------------------- */

/** Render every previewed proof for one recipient with a given merge override. */
function proofsWithMerge(piece: LetterPiece, program: MailMergeData["program"]) {
  const merge: MailMergeData = { ...SAMPLE_MERGE, program };
  const result = runLetterMatrixDryRun(
    [recipientFor(piece, { merge })],
    { runId: "run-honest" }
  );
  return result.proofs;
}

describe("C1: warranty term is per-shop, fail-closed when unconfigured", () => {
  // Block-composed matrix copy (the surface PSG-316 owns) carries NO hardcoded
  // duration phrase anymore — it is a token. Approved W1 masters reused via
  // `useDefaultProduct` are governed by their own proof approval (PSG-308); the
  // residual term still in the service_recovery master is tracked separately as a
  // C1 extension that requires re-proof/re-approval — NOT silently edited here.
  it("block-composed matrix warranty copy no longer hardcodes 'as long as you own the vehicle'", () => {
    for (const def of LETTER_DEFINITIONS) {
      for (const v of def.variants) {
        if (v.useDefaultProduct) continue; // approved master — separate governance
        const t = templateForVariant(def, v);
        expect(t.bodyHtml, `${def.piece}/${v.id}`).not.toMatch(/as long as you own the vehicle/i);
      }
    }
  });

  it("a shop with NO warrantyTerm leaves {{program.warrantyTerm}} unresolved (proof gate blocks)", () => {
    // Drop the per-shop term; the warranty piece must surface the missing token.
    const noTerm = { ...SAMPLE_MERGE.program };
    delete noTerm.warrantyTerm;
    const proof = proofsWithMerge("warranty", noTerm).find((p) => p.piece === "warranty");
    expect(proof, "warranty still previews (it is the proof gate that blocks it)").toBeDefined();
    expect(proof!.missingTokens).toContain("program.warrantyTerm");
  });

  it("renders the shop's own term when configured, with 0 missing tokens", () => {
    const term = "for 12 months or 12,000 miles, whichever comes first";
    const proof = proofsWithMerge("warranty", { ...SAMPLE_MERGE.program, warrantyTerm: term }).find(
      (p) => p.piece === "warranty"
    );
    expect(proof!.missingTokens).toEqual([]);
    expect(proof!.document.file).toContain(term);
  });
});

describe("C3: perfect_score review ask uses a one-click link when configured", () => {
  it("falls back to the generic 'online' ask when no reviewLink is set", () => {
    // SAMPLE_MERGE.program carries no reviewLink — the generic fallback applies.
    const proof = proofsWithMerge("perfect_score", SAMPLE_MERGE.program).find(
      (p) => p.piece === "perfect_score"
    );
    expect(proof!.missingTokens).toEqual([]); // optional — never blocks the send
    expect(proof!.document.file).toMatch(/\bonline\b/);
  });

  it("renders the configured review link as a one-click ask", () => {
    const reviewLink = "https://g.page/r/abc-collision/review";
    const proof = proofsWithMerge("perfect_score", {
      ...SAMPLE_MERGE.program,
      reviewLink,
    }).find((p) => p.piece === "perfect_score");
    expect(proof!.missingTokens).toEqual([]);
    expect(proof!.document.file).toContain(reviewLink);
  });
});
