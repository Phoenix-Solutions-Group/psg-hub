// Wave 1A / PSG-236 — Live provider adapter tests.
//
// Each adapter maps an injected live integration onto a pure engine seam. These assert:
//   • keyword: no-seat fallback chain (first non-empty wins), baseline always unioned,
//     live wins on phrase collision, source tagging, difficulty clamp, cap, greenfield;
//   • audit: greenfield short-circuit, crawl/audit failure handling, dedupe, cap;
//   • content-gap: no-competitor + null-completion degrade, source tag, dedupe;
//   • cluster-refiner: null degrade, label/pageType refine WITHOUT touching keywords.

import { describe, expect, it, vi } from "vitest";
import {
  makeAuditProvider,
  makeClusterRefiner,
  makeContentGapProvider,
  makeKeywordProvider,
  type StructuredCompletion,
} from "../providers";
import { clusterKeywords, deterministicKeywordProvider } from "../index";
import type { ShopBrief } from "../types";

const BRIEF: ShopBrief = {
  shopId: "shop-1",
  businessName: "Courtesy Body Works",
  domain: "courtesybodyworks.com",
  vertical: "collision_repair",
  services: ["collision repair", "frame straightening"],
  locations: [{ city: "Lincoln", state: "NE", primary: true }],
  competitors: ["caliber-collision.com"],
};
const GREENFIELD: ShopBrief = { ...BRIEF, domain: null, competitors: [] };

/* -------------------------------------------------------------------------- */
/* KeywordProvider                                                            */
/* -------------------------------------------------------------------------- */

describe("makeKeywordProvider — no-seat fallback chain", () => {
  it("uses the first source that yields keywords; later sources are not consulted", async () => {
    const semrush = vi.fn().mockResolvedValue([{ keyword: "collision repair lincoln ne", searchVolume: 90, difficulty: 40 }]);
    const dataforseo = vi.fn().mockResolvedValue([{ keyword: "auto body shop" }]);
    const provider = makeKeywordProvider([
      { name: "semrush", fetch: semrush },
      { name: "dataforseo", fetch: dataforseo },
    ]);
    const out = await provider(BRIEF);
    expect(semrush).toHaveBeenCalledOnce();
    expect(dataforseo).not.toHaveBeenCalled();
    const hit = out.find((k) => k.keyword === "collision repair lincoln ne");
    expect(hit?.source).toBe("semrush");
    expect(hit?.searchVolume).toBe(90);
    expect(hit?.difficulty).toBe(40);
  });

  it("falls through to the next source when one throws or returns empty", async () => {
    const semrush = vi.fn().mockRejectedValue(new Error("no seat"));
    const dataforseo = vi.fn().mockResolvedValue([]);
    const gsc = vi.fn().mockResolvedValue([{ keyword: "frame straightening near me", searchVolume: 20 }]);
    const onSourceError = vi.fn();
    const provider = makeKeywordProvider(
      [
        { name: "semrush", fetch: semrush },
        { name: "dataforseo", fetch: dataforseo },
        { name: "gsc", fetch: gsc },
      ],
      { onSourceError },
    );
    const out = await provider(BRIEF);
    expect(gsc).toHaveBeenCalledOnce();
    expect(onSourceError).toHaveBeenCalledWith("semrush", expect.any(Error));
    expect(out.find((k) => k.keyword === "frame straightening near me")?.source).toBe("gsc");
  });

  it("always unions the deterministic baseline so coverage never thins below zero-cost", async () => {
    const baseline = await deterministicKeywordProvider(BRIEF);
    const provider = makeKeywordProvider([{ name: "semrush", fetch: async () => [{ keyword: "zzz custom kw" }] }]);
    const out = await provider(BRIEF);
    expect(out.length).toBeGreaterThanOrEqual(baseline.length); // baseline + the live one
    expect(out.some((k) => k.keyword === "zzz custom kw")).toBe(true);
  });

  it("live keyword wins on phrase collision with the baseline (keeps its volume/source)", async () => {
    const baseline = await deterministicKeywordProvider(BRIEF);
    const shared = baseline[0].keyword;
    const provider = makeKeywordProvider([
      { name: "semrush", fetch: async () => [{ keyword: shared, searchVolume: 1234, difficulty: 55 }] },
    ]);
    const out = await provider(BRIEF);
    const hit = out.filter((k) => k.keyword.toLowerCase() === shared.toLowerCase());
    expect(hit).toHaveLength(1); // deduped
    expect(hit[0].source).toBe("semrush");
    expect(hit[0].searchVolume).toBe(1234);
  });

  it("clamps out-of-range difficulty and honors maxKeywords", async () => {
    const provider = makeKeywordProvider(
      [{ name: "semrush", fetch: async () => [{ keyword: "kw a", difficulty: 250 }, { keyword: "kw b", difficulty: -5 }] }],
      { includeDeterministicBaseline: false, maxKeywords: 1 },
    );
    const out = await provider(BRIEF);
    expect(out).toHaveLength(1);
    expect(out[0].difficulty).toBe(100);
  });

  it("falls back to baseline when every source is empty (greenfield works too)", async () => {
    const provider = makeKeywordProvider([{ name: "semrush", fetch: async () => [] }]);
    const out = await provider(GREENFIELD);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((k) => k.source === "derived")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* AuditProvider                                                              */
/* -------------------------------------------------------------------------- */

describe("makeAuditProvider — firecrawl-map + seo-auditor", () => {
  it("greenfield (no domain) short-circuits to [] without crawling", async () => {
    const crawl = vi.fn();
    const out = await makeAuditProvider({ crawl })(GREENFIELD);
    expect(out).toEqual([]);
    expect(crawl).not.toHaveBeenCalled();
  });

  it("maps crawled URLs to Keep by default and applies the audit verdict", async () => {
    const provider = makeAuditProvider({
      crawl: async () => [
        { url: "https://courtesybodyworks.com/services", title: "Services" },
        { url: "https://courtesybodyworks.com/old", title: "Old" },
      ],
      audit: async (u) => (u.url.endsWith("/old") ? { disposition: "improve", note: "thin content" } : { disposition: "keep" }),
    });
    const out = await provider(BRIEF);
    expect(out).toHaveLength(2);
    expect(out.find((u) => u.url.endsWith("/services"))?.disposition).toBe("keep");
    const old = out.find((u) => u.url.endsWith("/old"));
    expect(old?.disposition).toBe("improve");
    expect(old?.note).toBe("thin content");
  });

  it("crawl failure → [] (run continues); a thrown audit downgrades that URL to Improve, never drops it", async () => {
    const onError = vi.fn();
    expect(await makeAuditProvider({ crawl: async () => { throw new Error("map down"); }, onError })(BRIEF)).toEqual([]);
    expect(onError).toHaveBeenCalledWith("crawl", expect.any(Error));

    const out = await makeAuditProvider({
      crawl: async () => [{ url: "https://courtesybodyworks.com/x" }],
      audit: async () => { throw new Error("auditor 500"); },
      onError,
    })(BRIEF);
    expect(out).toHaveLength(1);
    expect(out[0].disposition).toBe("improve");
  });

  it("dedupes by URL and caps at maxUrls", async () => {
    const provider = makeAuditProvider({
      crawl: async () => [
        { url: "https://x.com/a" },
        { url: "https://x.com/a" },
        { url: "https://x.com/b" },
        { url: "https://x.com/c" },
      ],
      maxUrls: 2,
    });
    const out = await provider(BRIEF);
    expect(out.map((u) => u.url)).toEqual(["https://x.com/a", "https://x.com/b"]);
  });
});

/* -------------------------------------------------------------------------- */
/* ContentGapProvider                                                         */
/* -------------------------------------------------------------------------- */

describe("makeContentGapProvider — intel content-gap", () => {
  it("no competitors → [] without calling the LLM", async () => {
    const complete = vi.fn();
    const out = await makeContentGapProvider({ complete: complete as unknown as StructuredCompletion })(GREENFIELD);
    expect(out).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it("null completion (pre-G5 / spend cap) degrades to []", async () => {
    const complete: StructuredCompletion = async () => null;
    expect(await makeContentGapProvider({ complete })(BRIEF)).toEqual([]);
  });

  it("maps returned keywords with source=competitor_gap and dedupes", async () => {
    const complete: StructuredCompletion = async ({ schema }) =>
      schema.parse({ keywords: [{ keyword: "rental car while repair" }, { keyword: "Rental Car While Repair" }, { keyword: "oem parts collision", searchVolume: 50 }] });
    const out = await makeContentGapProvider({ complete })(BRIEF);
    expect(out).toHaveLength(2);
    expect(out.every((k) => k.source === "competitor_gap")).toBe(true);
    expect(out.find((k) => k.keyword === "oem parts collision")?.searchVolume).toBe(50);
  });
});

/* -------------------------------------------------------------------------- */
/* ClusterRefiner                                                             */
/* -------------------------------------------------------------------------- */

describe("makeClusterRefiner — optional LLM refine (annotate only)", () => {
  it("empty clusters or null completion → null (engine keeps deterministic clusters)", async () => {
    const nullComplete: StructuredCompletion = async () => null;
    expect(await makeClusterRefiner({ complete: nullComplete })([])).toBeNull();
    const someClusters = await clusterKeywords(await deterministicKeywordProvider(BRIEF), { cityTokens: new Set(["lincoln"]) });
    expect(await makeClusterRefiner({ complete: nullComplete })(someClusters)).toBeNull();
  });

  it("refines label/pageType WITHOUT moving any keywords", async () => {
    const clusters = await clusterKeywords(await deterministicKeywordProvider(BRIEF), { cityTokens: new Set(["lincoln"]) });
    const target = clusters[0];
    const complete: StructuredCompletion = async ({ schema }) =>
      schema.parse({ clusters: [{ id: target.id, label: "Refined Label", pageType: "landing" }] });
    const out = await makeClusterRefiner({ complete })(clusters);
    expect(out).not.toBeNull();
    const refined = out!.find((c) => c.id === target.id)!;
    expect(refined.label).toBe("Refined Label");
    expect(refined.pageType).toBe("landing");
    // keyword membership + priority untouched
    expect(refined.keywords).toEqual(target.keywords);
    expect(refined.priority).toBe(target.priority);
    // untouched clusters pass through unchanged
    expect(out!.filter((c) => c.id !== target.id)).toEqual(clusters.filter((c) => c.id !== target.id));
  });
});
