import { describe, it, expect } from "vitest";
import {
  validateMutationRequest,
  assertMutationAllowed,
  GovernanceError,
} from "@/lib/ads-mutations/governance";
import { DisabledBridge, SandboxGatedError, isSandboxEnabled } from "@/lib/ads-mutations/bridge";
import type { MutationRequest } from "@/lib/ads-mutations/types";

const validHighRisk: MutationRequest = {
  mutationKey: "google_ads.campaign_bidding",
  mode: "execute",
  targetRef: "6048611995",
  params: { changes: [{ campaign_id: 1, strategy: "TARGET_CPA" }] },
  approvalId: "appr_123",
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
