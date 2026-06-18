import { describe, it, expect } from "vitest";
import { MUTATION_REGISTRY } from "@/lib/ads-mutations/registry";
import { MUTATION_FIXTURES, getFixture } from "@/lib/ads-mutations/fixtures";
import {
  diffJson,
  buildDryRunPreview,
  buildAllPreviews,
  type Json,
} from "@/lib/ads-mutations/preview";

const ALL_KEYS = MUTATION_REGISTRY.map((m) => m.key);

describe("fixtures coverage", () => {
  it("ships a fixture for every registered mutation", () => {
    for (const key of ALL_KEYS) {
      expect(getFixture(key), `missing fixture for ${key}`).toBeDefined();
    }
  });

  it("has no orphan fixtures (every fixture maps to a registry key)", () => {
    const keys = new Set(ALL_KEYS);
    for (const fixtureKey of Object.keys(MUTATION_FIXTURES)) {
      expect(keys.has(fixtureKey), `orphan fixture ${fixtureKey}`).toBe(true);
    }
  });

  it("supplies a non-empty target on every fixture (customer-id / container-id)", () => {
    for (const key of ALL_KEYS) {
      expect(getFixture(key)!.targetRef.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("diffJson", () => {
  it("detects a changed scalar leaf with before/after", () => {
    const d = diffJson({ a: 1 } as Json, { a: 2 } as Json);
    expect(d).toEqual([{ path: "a", kind: "changed", before: 1, after: 2 }]);
  });

  it("detects added and removed object keys", () => {
    const d = diffJson({ a: 1, b: 2 } as Json, { a: 1, c: 3 } as Json);
    expect(d).toContainEqual({ path: "b", kind: "removed", before: 2 });
    expect(d).toContainEqual({ path: "c", kind: "added", after: 3 });
    // unchanged `a` is dropped by default
    expect(d.some((e) => e.path === "a")).toBe(false);
  });

  it("diffs arrays index-wise with bracket paths", () => {
    const d = diffJson(["x"] as Json, ["x", "y"] as Json);
    expect(d).toEqual([{ path: "[1]", kind: "added", after: "y" }]);
  });

  it("recurses into nested arrays of objects", () => {
    const before = { items: [{ text: "a", n: 1 }] } as Json;
    const after = { items: [{ text: "a", n: 2 }] } as Json;
    const d = diffJson(before, after);
    expect(d).toEqual([{ path: "items[0].n", kind: "changed", before: 1, after: 2 }]);
  });

  it("returns no entries for equal values, but includes unchanged on request", () => {
    expect(diffJson({ a: 1 } as Json, { a: 1 } as Json)).toEqual([]);
    const withUnchanged = diffJson({ a: 1 } as Json, { a: 1 } as Json, { includeUnchanged: true });
    expect(withUnchanged).toEqual([{ path: "a", kind: "unchanged", before: 1, after: 1 }]);
  });
});

describe("buildDryRunPreview", () => {
  it("produces a before/requestedChanges/after diff for every mutation", () => {
    for (const key of ALL_KEYS) {
      const p = buildDryRunPreview(key);
      expect(p.mutationKey).toBe(key);
      expect(p.diff.before).toBeDefined();
      expect(p.diff.after).toBeDefined();
      expect(p.diff.requestedChanges).toBe(getFixture(key)!.params);
      // Each fixture is authored to actually change state, so the diff is non-trivial.
      expect(p.changes.length, `expected a non-empty diff for ${key}`).toBeGreaterThan(0);
    }
  });

  it("flags high-risk mutations as requiring approval (and only those)", () => {
    for (const p of buildAllPreviews(ALL_KEYS)) {
      expect(p.governance.requiresApproval).toBe(p.def.riskLevel === "high");
      expect(p.governance.targetRequired).toBe(true);
      expect(p.governance.targetProvided).toBe(true);
    }
  });

  it("appends new negative keywords without dropping existing ones (low-risk)", () => {
    const p = buildDryRunPreview("google_ads.negative_keywords");
    const after = p.diff.after as { negative_keywords: { text: string }[] };
    const texts = after.negative_keywords.map((n) => n.text);
    expect(texts).toContain("cheap"); // existing preserved
    expect(texts).toContain("free"); // added
    expect(texts).toContain("diy"); // added
  });

  it("patches the bidding strategy on the targeted campaign only (high-risk)", () => {
    const p = buildDryRunPreview("google_ads.campaign_bidding");
    const after = p.diff.after as { campaigns: { campaign_id: number; strategy: string }[] };
    const patched = after.campaigns.find((c) => c.campaign_id === 200300400)!;
    const untouched = after.campaigns.find((c) => c.campaign_id === 200300401)!;
    expect(patched.strategy).toBe("MAXIMIZE_CONVERSIONS");
    expect(untouched.strategy).toBe("TARGET_ROAS");
  });

  it("increments the GTM live version on publish", () => {
    const p = buildDryRunPreview("gtm.publish_version");
    const before = p.diff.before as { live_version: number };
    const after = p.diff.after as { live_version: number };
    expect(after.live_version).toBe(before.live_version + 1);
  });

  it("throws on an unknown mutation key", () => {
    expect(() => buildDryRunPreview("nope.nope")).toThrow(/Unknown mutation key/);
  });
});
