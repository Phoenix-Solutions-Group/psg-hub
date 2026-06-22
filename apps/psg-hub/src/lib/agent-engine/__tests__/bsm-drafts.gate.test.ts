// BSM Phase 0 / PSG-193 — Reproducible gate runner for the 9 real BSM drafts.
//
// This IS the committed runner the acceptance criteria call for: it feeds the 3
// `VerifiedFacts` records + the 9 generated assets through the PSG-191 harness
// (`gateGeneratedAsset` → PSG-143 `checkClaimIntegrity`) and asserts `ship` for
// all 9, then shapes each into a persistable `content_items` draft (Ravi/Child B
// consumes that shape). QA reproduces it with:
//
//   pnpm --filter=psg-hub test -- bsm-drafts
//
// It prints the ship table (`9/9 ship`) so the result is visible in CI logs.

import { describe, it, expect } from "vitest";
import {
  BSM_GENERATED_ASSETS,
  BSM_VERIFIED_FACTS,
  CONVERSION_JOBS,
  formatGateReport,
  gateAllBsmDrafts,
} from "../__fixtures__/bsm-drafts";
import { toContentItemDraft } from "../content-writer-run";

describe("PSG-193 — 9 real BSM drafts gate to ship", () => {
  const results = gateAllBsmDrafts();

  it("prints the ship report and ships all 9 assets", () => {
    // Surfaced in CI output so QA can eyeball the verdicts.
    console.log("\n" + formatGateReport(results) + "\n");

    expect(results).toHaveLength(9);
    for (const r of results) {
      expect(
        r.shipped,
        `${r.key} did not ship: ${r.gated.result.verdict} (${r.gated.result.violations
          .map((v) => `${v.code}: ${v.message}`)
          .join("; ")})`,
      ).toBe(true);
      expect(r.gated.result.verdict).toBe("ship");
      expect(r.gated.result.hardFail).toBe(false);
      expect(r.gated.result.violations).toHaveLength(0);
    }
    expect(results.filter((r) => r.shipped)).toHaveLength(9);
  });

  it("covers all 3 clients, 3 asset types each, one conversion job per asset", () => {
    const byShop = new Map<string, Set<string>>();
    for (const { asset } of BSM_GENERATED_ASSETS) {
      const set = byShop.get(asset.shopId) ?? new Set<string>();
      set.add(asset.contentType);
      byShop.set(asset.shopId, set);
    }
    expect([...byShop.keys()].sort()).toEqual(["shop-tedesco", "shop-tracys", "shop-wallace"]);
    for (const set of byShop.values()) {
      expect([...set].sort()).toEqual(["blog_post", "meta_description", "service_page"]);
    }
    // Every asset declares exactly one conversion job.
    for (const { key } of BSM_GENERATED_ASSETS) {
      expect(CONVERSION_JOBS[key]).toBeDefined();
    }
  });

  it("shapes every shipped asset into a content_items draft for Ravi/Child B", () => {
    for (const r of results) {
      const draft = toContentItemDraft(r.gated, `loc-${r.shopId}`);
      expect(draft.status).toBe("draft");
      expect(draft.shopId).toBe(r.shopId);
      expect(draft.claimIntegrityVerdict.verdict).toBe("ship");
      // A bare meta_description carries a null title; everything else keeps it.
      if (r.contentType === "meta_description") {
        expect(draft.title).toBeNull();
      } else {
        expect(draft.title).toBeTruthy();
      }
    }
  });

  it("every verified-facts record keeps DRP disclosure default-deny", () => {
    for (const facts of Object.values(BSM_VERIFIED_FACTS)) {
      expect(facts.drpDisclosure.allowed).toBe(false);
      expect(facts.drpDisclosure.authorizedCarriers).toHaveLength(0);
    }
  });
});
