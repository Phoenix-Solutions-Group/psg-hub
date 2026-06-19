import { describe, it, expect } from "vitest";
import {
  validateMutationRequest,
  assertMutationAllowed,
  GovernanceError,
  isUuid,
  parseApprovalAllowlist,
} from "@/lib/ads-mutations/governance";
import { DisabledBridge, SandboxGatedError, isSandboxEnabled } from "@/lib/ads-mutations/bridge";
import type { MutationRequest } from "@/lib/ads-mutations/types";

// A real board-confirmation UUID shape (PSG-126: free-text refs are no longer accepted).
const APPROVAL_UUID = "8b576490-f30a-48d8-b360-2a443bf2713e";

const validHighRisk: MutationRequest = {
  mutationKey: "google_ads.campaign_bidding",
  mode: "execute",
  targetRef: "6048611995",
  params: { changes: [{ campaign_id: 1, strategy: "TARGET_CPA" }] },
  approvalId: APPROVAL_UUID,
};

describe("validateMutationRequest", () => {
  it("accepts a well-formed high-risk execute with approval", () => {
    expect(validateMutationRequest(validHighRisk).ok).toBe(true);
  });

  it("rejects an unknown mutation key", () => {
    const r = validateMutationRequest({ ...validHighRisk, mutationKey: "x.y" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Unknown mutation key/);
  });

  it("requires a target ref (customer-id governance)", () => {
    const r = validateMutationRequest({ ...validHighRisk, targetRef: "  " });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/Target required/);
  });

  it("blocks high-risk execute without approval", () => {
    const r = validateMutationRequest({ ...validHighRisk, approvalId: undefined });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/high-risk/);
  });

  it("allows high-risk DRY-RUN without approval", () => {
    const r = validateMutationRequest({ ...validHighRisk, mode: "dry_run", approvalId: undefined });
    expect(r.ok).toBe(true);
  });

  it("does not require approval for low-risk execute", () => {
    const r = validateMutationRequest({
      mutationKey: "google_ads.negative_keywords",
      mode: "execute",
      targetRef: "6048611995",
      params: { campaign_id: 1, negatives: [{ text: "free", match_type: "BROAD" }] },
    });
    expect(r.ok).toBe(true);
  });

  it("flags missing required params", () => {
    const r = validateMutationRequest({ ...validHighRisk, params: {} });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/Missing required param "changes"/);
  });

  it("assertMutationAllowed throws GovernanceError on violation", () => {
    expect(() => assertMutationAllowed({ ...validHighRisk, targetRef: "" })).toThrow(
      GovernanceError
    );
  });

  // ── PSG-126: execute approvalId must be a real board-confirmation UUID ──────────
  it("rejects a fabricated free-text approvalId for high-risk execute", () => {
    const r = validateMutationRequest({ ...validHighRisk, approvalId: "board-card-8b576490" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/must be a board-confirmation UUID/);
  });

  it("rejects a non-UUID approvalId even if non-empty (old behavior was to pass)", () => {
    const r = validateMutationRequest({ ...validHighRisk, approvalId: "appr_123" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/must be a board-confirmation UUID/);
  });

  it("accepts a UUID approvalId when no allowlist is configured (shape gate only)", () => {
    expect(validateMutationRequest({ ...validHighRisk }).ok).toBe(true);
  });

  it("accepts a UUID approvalId that is on the accepted-approval allowlist", () => {
    const r = validateMutationRequest(validHighRisk, { approvalAllowlist: [APPROVAL_UUID] });
    expect(r.ok).toBe(true);
  });

  it("rejects a UUID approvalId that is NOT on a configured allowlist (fail-closed)", () => {
    const other = "11111111-2222-3333-4444-555555555555";
    const r = validateMutationRequest(
      { ...validHighRisk, approvalId: other },
      { approvalAllowlist: [APPROVAL_UUID] }
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/does not match an accepted board confirmation/);
  });

  it("allowlist match is case-insensitive", () => {
    const r = validateMutationRequest(
      { ...validHighRisk, approvalId: APPROVAL_UUID.toUpperCase() },
      { approvalAllowlist: [APPROVAL_UUID] }
    );
    expect(r.ok).toBe(true);
  });
});

describe("isUuid", () => {
  it("accepts a well-formed UUID", () => {
    expect(isUuid("8b576490-f30a-48d8-b360-2a443bf2713e")).toBe(true);
  });
  it("rejects free text and malformed UUIDs", () => {
    expect(isUuid("board-card-8b576490")).toBe(false);
    expect(isUuid("appr_123")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("8b576490-f30a-48d8-b360")).toBe(false);
  });
});

describe("parseApprovalAllowlist", () => {
  it("returns [] for empty/undefined", () => {
    expect(parseApprovalAllowlist(undefined)).toEqual([]);
    expect(parseApprovalAllowlist("")).toEqual([]);
  });
  it("parses comma/space/newline separated UUIDs and lowercases them", () => {
    const raw = "8B576490-F30A-48D8-B360-2A443BF2713E, 11111111-2222-3333-4444-555555555555";
    expect(parseApprovalAllowlist(raw)).toEqual([
      "8b576490-f30a-48d8-b360-2a443bf2713e",
      "11111111-2222-3333-4444-555555555555",
    ]);
  });
  it("drops non-UUID entries so malformed env can never authorize", () => {
    expect(parseApprovalAllowlist("board-card-1, , appr_2")).toEqual([]);
  });
});

describe("bridge gate", () => {
  it("is disabled by default (Vercel Sandbox board gate)", () => {
    expect(isSandboxEnabled()).toBe(false);
  });

  it("DisabledBridge fails closed on dryRun and execute", async () => {
    const bridge = new DisabledBridge();
    await expect(bridge.dryRun()).rejects.toBeInstanceOf(SandboxGatedError);
    await expect(bridge.execute()).rejects.toBeInstanceOf(SandboxGatedError);
  });
});
