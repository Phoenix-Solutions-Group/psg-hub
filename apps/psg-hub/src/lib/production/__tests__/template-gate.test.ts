import { describe, it, expect } from "vitest";
import {
  TEMPLATE_KEYS,
  RIVERSIDE_DEMO_MERGE_DATA,
  assertTemplateEligibleForLiveBatch,
  buildTemplateProof,
  currentTemplateHash,
  ineligibleReason,
  isTemplateEligibleForLiveBatch,
  isTemplateKey,
  templateContentHash,
  TemplateNotApprovedError,
  validateApprovalTransition,
  type TemplateApprovalState,
} from "../template-gate";
import { defaultTemplate, type MailMergeData, type MailTemplate } from "../templates";

describe("templateContentHash", () => {
  it("is deterministic for the same template", () => {
    const t = defaultTemplate("thank_you");
    expect(templateContentHash(t)).toBe(templateContentHash(t));
  });

  it("changes when any rendered byte changes", () => {
    const base = defaultTemplate("thank_you");
    const edited: MailTemplate = { ...base, frontHtml: `${base.frontHtml}<!-- edit -->` };
    expect(templateContentHash(edited)).not.toBe(templateContentHash(base));
  });

  it("differs across the three template products", () => {
    const hashes = TEMPLATE_KEYS.map((k) => currentTemplateHash(k));
    expect(new Set(hashes).size).toBe(TEMPLATE_KEYS.length);
  });
});

describe("isTemplateKey", () => {
  it("accepts known keys and rejects others", () => {
    expect(isTemplateKey("warranty")).toBe(true);
    expect(isTemplateKey("self_mailer")).toBe(true);
    expect(isTemplateKey("postcard")).toBe(false);
    expect(isTemplateKey("")).toBe(false);
  });
});

describe("buildTemplateProof", () => {
  it("renders merged HTML with the matching content hash and no missing tokens on full sample data", () => {
    for (const key of TEMPLATE_KEYS) {
      const proof = buildTemplateProof(key);
      expect(proof.contentHash).toBe(currentTemplateHash(key));
      // The sample data fills every standard merge field.
      expect(proof.content.missing).toEqual([]);
      const rendered = proof.content.front ?? proof.content.file ?? proof.content.inside;
      expect(rendered).toBeTruthy();
      // Substituted sample values appear in the rendered HTML.
      expect(rendered).toContain("Demo Body Works");
    }
  });

  it("surfaces unresolved tokens for thin merge data", () => {
    const thin: MailMergeData = { customer: {}, company: {}, program: {} };
    const proof = buildTemplateProof("warranty", thin);
    expect(proof.content.missing.length).toBeGreaterThan(0);
    expect(proof.content.missing).toContain("company.name");
  });

  it("renders the Riverside/Maria governance demo proof without unresolved tokens", () => {
    const proof = buildTemplateProof("thank_you", RIVERSIDE_DEMO_MERGE_DATA);
    const rendered = proof.content.front ?? proof.content.file ?? proof.content.inside ?? "";

    expect(proof.content.missing).toEqual([]);
    expect(rendered).toContain("Riverside Collision");
    expect(rendered).toContain("Maria Alvarez");
    expect(rendered).not.toContain("Demo Body Works");
    expect(rendered).not.toContain("Jordan Rivera");
  });
});

describe("eligibility (ineligibleReason / isTemplateEligibleForLiveBatch)", () => {
  const hash = "abc123";
  const released: TemplateApprovalState = {
    templateKey: "warranty",
    contentHash: hash,
    status: "released",
  };

  it("no approval row → not eligible (no_approval)", () => {
    expect(ineligibleReason(null, hash)).toBe("no_approval");
    expect(isTemplateEligibleForLiveBatch(null, hash)).toBe(false);
  });

  it("approved but not released → not_released", () => {
    expect(ineligibleReason({ ...released, status: "approved" }, hash)).toBe("not_released");
  });

  it("revoked → not_released", () => {
    expect(ineligibleReason({ ...released, status: "revoked" }, hash)).toBe("not_released");
  });

  it("released against a different hash → stale_hash", () => {
    expect(ineligibleReason(released, "different")).toBe("stale_hash");
  });

  it("released and matching → eligible", () => {
    expect(ineligibleReason(released, hash)).toBeNull();
    expect(isTemplateEligibleForLiveBatch(released, hash)).toBe(true);
  });
});

describe("assertTemplateEligibleForLiveBatch", () => {
  it("throws TemplateNotApprovedError with the reason when ineligible", () => {
    try {
      assertTemplateEligibleForLiveBatch("warranty", null, "h");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateNotApprovedError);
      expect((err as TemplateNotApprovedError).reason).toBe("no_approval");
      expect((err as TemplateNotApprovedError).templateKey).toBe("warranty");
    }
  });

  it("does not throw when eligible", () => {
    expect(() =>
      assertTemplateEligibleForLiveBatch(
        "warranty",
        { templateKey: "warranty", contentHash: "h", status: "released" },
        "h"
      )
    ).not.toThrow();
  });
});

describe("validateApprovalTransition", () => {
  it("approve allowed from none/draft/approved/revoked, blocked from released", () => {
    expect(validateApprovalTransition(null, "approve").ok).toBe(true);
    expect(validateApprovalTransition("draft", "approve").ok).toBe(true);
    expect(validateApprovalTransition("approved", "approve").ok).toBe(true);
    expect(validateApprovalTransition("revoked", "approve").ok).toBe(true);
    expect(validateApprovalTransition("released", "approve").ok).toBe(false);
  });

  it("release only from approved", () => {
    expect(validateApprovalTransition("approved", "release").ok).toBe(true);
    expect(validateApprovalTransition(null, "release").ok).toBe(false);
    expect(validateApprovalTransition("draft", "release").ok).toBe(false);
    expect(validateApprovalTransition("released", "release").ok).toBe(false);
  });

  it("revoke only from approved or released", () => {
    expect(validateApprovalTransition("approved", "revoke").ok).toBe(true);
    expect(validateApprovalTransition("released", "revoke").ok).toBe(true);
    expect(validateApprovalTransition(null, "revoke").ok).toBe(false);
    expect(validateApprovalTransition("draft", "revoke").ok).toBe(false);
  });
});
