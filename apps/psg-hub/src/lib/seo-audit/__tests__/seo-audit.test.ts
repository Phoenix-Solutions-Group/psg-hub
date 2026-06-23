import { describe, it, expect, vi } from "vitest";
import {
  evaluatePage,
  auditCrawledSite,
  deriveKeywordTargets,
} from "../auditor";
import {
  buildShopAuditReport,
  computeHealthScore,
  gradeForScore,
  makeAuditProvider,
} from "../report";
import { renderShopAuditReportHtml } from "../render";
import {
  noopCrawlProvider,
  createFirecrawlProvider,
  selectCrawlProvider,
  normalizeDomain,
  scrapeResultToPage,
  type FetchLike,
} from "../crawl";
import { shopBriefSchema, shopAuditReportSchema, type CrawledPage, type ShopBrief } from "../types";

const T = "2026-06-23T12:00:00.000Z";

function brief(over: Partial<ShopBrief> = {}): ShopBrief {
  return shopBriefSchema.parse({
    shopId: "shop-1",
    businessName: "Tracy's Collision Center",
    domain: "tracyscollision.com",
    vertical: "collision_repair",
    services: ["collision repair", "frame straightening"],
    locations: [{ city: "Lincoln", state: "NE", primary: true }],
    ...over,
  });
}

/* -------------------------------------------------------------------------- */
/* evaluatePage — deterministic rules                                          */
/* -------------------------------------------------------------------------- */

describe("evaluatePage", () => {
  it("returns no issues for a clean page", () => {
    const page: CrawledPage = {
      url: "https://x.com/",
      title: "Collision Repair in Lincoln NE | Tracy's",
      statusCode: 200,
      wordCount: 800,
      h1Count: 1,
      metaDescription: "We fix cars.",
      indexable: true,
    };
    expect(evaluatePage(page)).toEqual([]);
  });

  it("flags a 4xx/5xx as critical", () => {
    const issues = evaluatePage({ url: "u", statusCode: 404 });
    expect(issues.some((i) => i.severity === "critical")).toBe(true);
  });

  it("flags noindex as high", () => {
    const issues = evaluatePage({ url: "u", indexable: false });
    expect(issues.some((i) => i.severity === "high" && /indexable/i.test(i.note))).toBe(true);
  });

  it("flags empty + short titles distinctly", () => {
    expect(evaluatePage({ url: "u", title: "" }).some((i) => /Missing <title>/.test(i.note))).toBe(true);
    expect(evaluatePage({ url: "u", title: "short" }).some((i) => /too short/.test(i.note))).toBe(true);
  });

  it("flags thin content under the threshold but not above", () => {
    expect(evaluatePage({ url: "u", wordCount: 50 }).some((i) => /Thin/.test(i.note))).toBe(true);
    expect(evaluatePage({ url: "u", wordCount: 500 }).some((i) => /Thin/.test(i.note))).toBe(false);
  });

  it("flags zero and multiple h1s differently", () => {
    expect(evaluatePage({ url: "u", h1Count: 0 }).some((i) => /No <h1>/.test(i.note))).toBe(true);
    expect(evaluatePage({ url: "u", h1Count: 3 }).some((i) => /Multiple <h1>/.test(i.note))).toBe(true);
  });

  it("treats unknown signals as no defect (never a false Improve)", () => {
    // URL-only row (sitemap-only crawl): nothing known ⇒ nothing flagged.
    expect(evaluatePage({ url: "https://x.com/page" })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* auditCrawledSite                                                            */
/* -------------------------------------------------------------------------- */

describe("auditCrawledSite", () => {
  it("buckets keep vs improve and emits a finding per issue", () => {
    const pages: CrawledPage[] = [
      { url: "https://x.com/", title: "Good homepage title here", statusCode: 200, wordCount: 600, h1Count: 1, metaDescription: "ok" },
      { url: "https://x.com/thin", title: "", statusCode: 200, wordCount: 20, h1Count: 0 },
    ];
    const { inventory, findings } = auditCrawledSite(pages);
    expect(inventory.find((u) => u.url.endsWith("/"))?.disposition).toBe("keep");
    const thin = inventory.find((u) => u.url.endsWith("/thin"));
    expect(thin?.disposition).toBe("improve");
    expect(thin?.note).toBeTruthy();
    // 3 issues on the thin page (missing title, no h1, thin content).
    expect(findings.length).toBe(3);
  });

  it("sorts findings critical-first", () => {
    const pages: CrawledPage[] = [
      { url: "https://x.com/low", h1Count: 2 }, // low
      { url: "https://x.com/dead", statusCode: 500 }, // critical
    ];
    const { findings } = auditCrawledSite(pages);
    expect(findings[0].severity).toBe("critical");
  });

  it("does not mutate the input array", () => {
    const pages: CrawledPage[] = [{ url: "u", statusCode: 404 }];
    const copy = JSON.parse(JSON.stringify(pages));
    auditCrawledSite(pages);
    expect(pages).toEqual(copy);
  });
});

/* -------------------------------------------------------------------------- */
/* deriveKeywordTargets                                                        */
/* -------------------------------------------------------------------------- */

describe("deriveKeywordTargets", () => {
  it("ranks transactional/local above informational and dedupes", () => {
    const targets = deriveKeywordTargets(brief(), 50);
    // sorted desc by priority
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i - 1].priority).toBeGreaterThanOrEqual(targets[i].priority);
    }
    // no dup keywords
    const keys = targets.map((t) => t.keyword.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("respects the limit and a non-positive limit yields []", () => {
    expect(deriveKeywordTargets(brief(), 3)).toHaveLength(3);
    expect(deriveKeywordTargets(brief(), 0)).toEqual([]);
  });

  it("includes collision evergreens only for the collision vertical", () => {
    const c = deriveKeywordTargets(brief({ vertical: "collision_repair" }), 100);
    expect(c.some((t) => /how long does collision repair take/.test(t.keyword))).toBe(true);
    const g = deriveKeywordTargets(brief({ vertical: "general", services: ["oil change"] }), 100);
    expect(g.some((t) => /how long does collision/.test(t.keyword))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* scoring                                                                     */
/* -------------------------------------------------------------------------- */

describe("scoring", () => {
  it("computeHealthScore floors at 0 and starts at 100", () => {
    expect(computeHealthScore([])).toBe(100);
    expect(
      computeHealthScore([
        { severity: "critical", area: "a", detail: "d" },
        { severity: "critical", area: "a", detail: "d" },
        { severity: "critical", area: "a", detail: "d" },
        { severity: "critical", area: "a", detail: "d" },
        { severity: "critical", area: "a", detail: "d" },
      ]),
    ).toBe(0);
  });

  it("maps scores to grades", () => {
    expect(gradeForScore(100)).toBe("A");
    expect(gradeForScore(85)).toBe("B");
    expect(gradeForScore(72)).toBe("C");
    expect(gradeForScore(61)).toBe("D");
    expect(gradeForScore(40)).toBe("F");
  });
});

/* -------------------------------------------------------------------------- */
/* buildShopAuditReport                                                        */
/* -------------------------------------------------------------------------- */

describe("buildShopAuditReport", () => {
  it("audited mode: scores, counts keep/improve, validates against the schema", () => {
    const pages: CrawledPage[] = [
      { url: "https://x.com/", title: "Homepage title that is long enough", statusCode: 200, wordCount: 600, h1Count: 1, metaDescription: "ok" },
      { url: "https://x.com/bad", statusCode: 404 },
    ];
    const report = buildShopAuditReport(brief(), { generatedAt: T, pages });
    expect(report.mode).toBe("audited");
    expect(report.summary.pagesCrawled).toBe(2);
    expect(report.summary.keepCount).toBe(1);
    expect(report.summary.improveCount).toBe(1);
    expect(report.healthScore).toBeLessThan(100);
    expect(report.keywordTargets.length).toBeGreaterThan(0);
    expect(() => shopAuditReportSchema.parse(report)).not.toThrow();
  });

  it("greenfield: no domain ⇒ build plan, null score, empty inventory", () => {
    const report = buildShopAuditReport(brief({ domain: null }), { generatedAt: T });
    expect(report.mode).toBe("greenfield");
    expect(report.healthScore).toBeNull();
    expect(report.grade).toBe("—");
    expect(report.inventory).toEqual([]);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.keywordTargets.length).toBeGreaterThan(0);
    expect(() => shopAuditReportSchema.parse(report)).not.toThrow();
  });

  it("greenfield: domain present but crawl returned nothing also degrades", () => {
    const report = buildShopAuditReport(brief(), { generatedAt: T, pages: [] });
    expect(report.mode).toBe("greenfield");
  });
});

/* -------------------------------------------------------------------------- */
/* makeAuditProvider — 1A reuse                                                */
/* -------------------------------------------------------------------------- */

describe("makeAuditProvider (sitemap pipeline reuse)", () => {
  it("returns Keep/Improve rows as a 1A AuditProvider", async () => {
    const crawl = vi.fn(async () => [
      { url: "https://x.com/", title: "A long enough title", statusCode: 200, wordCount: 600, h1Count: 1, metaDescription: "ok" },
      { url: "https://x.com/bad", statusCode: 500 },
    ] as CrawledPage[]);
    const provider = makeAuditProvider(crawl);
    const inv = await provider(brief());
    expect(inv).toHaveLength(2);
    expect(inv.map((u) => u.disposition).sort()).toEqual(["improve", "keep"]);
  });

  it("greenfield brief ⇒ [] and never crawls", async () => {
    const crawl = vi.fn(async () => []);
    const provider = makeAuditProvider(crawl);
    expect(await provider(brief({ domain: null }))).toEqual([]);
    expect(crawl).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* render                                                                      */
/* -------------------------------------------------------------------------- */

describe("renderShopAuditReportHtml", () => {
  it("audited report renders score, KPIs, inventory + escapes html", () => {
    const pages: CrawledPage[] = [
      { url: "https://x.com/<script>", title: "T&T <b>", statusCode: 200, wordCount: 30, h1Count: 0 },
    ];
    const report = buildShopAuditReport(brief({ businessName: "A&B <Body>" }), { generatedAt: T, pages });
    const html = renderShopAuditReportHtml(report);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Your SEO health score");
    expect(html).toContain("Page inventory");
    // escaping: no raw injected tag
    expect(html).not.toContain("<script>");
    expect(html).toContain("A&amp;B &lt;Body&gt;");
    expect(html).toContain("Keyword opportunities");
  });

  it("greenfield report renders the build-plan framing, not a score", () => {
    const report = buildShopAuditReport(brief({ domain: null }), { generatedAt: T });
    const html = renderShopAuditReportHtml(report);
    expect(html).toContain("Greenfield build plan");
    expect(html).toContain("No live site");
    expect(html).not.toContain("Your SEO health score");
  });
});

/* -------------------------------------------------------------------------- */
/* crawl seam                                                                  */
/* -------------------------------------------------------------------------- */

describe("crawl seam", () => {
  it("normalizeDomain adds https and trims trailing slashes", () => {
    expect(normalizeDomain("example.com/")).toBe("https://example.com");
    expect(normalizeDomain("http://x.com")).toBe("http://x.com");
  });

  it("scrapeResultToPage extracts title/desc/words/h1 defensively", () => {
    const page = scrapeResultToPage("https://x.com/", {
      metadata: { title: "Hi", description: "d", statusCode: 200 },
      markdown: "one two three",
      html: "<h1>a</h1><h1>b</h1>",
    });
    expect(page.title).toBe("Hi");
    expect(page.wordCount).toBe(3);
    expect(page.h1Count).toBe(2);
    expect(page.statusCode).toBe(200);
  });

  it("noopCrawlProvider returns []", async () => {
    expect(await noopCrawlProvider.crawl("x.com")).toEqual([]);
  });

  it("firecrawl provider maps then scrapes a capped sample, remainder URL-only", async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/map")) {
        return { ok: true, status: 200, json: async () => ({ links: ["https://x.com/a", "https://x.com/b", "https://x.com/a"] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { metadata: { title: "P", statusCode: 200 }, markdown: "w w w w w", html: "<h1>x</h1>" } }),
      };
    });
    const provider = createFirecrawlProvider({ apiKey: "k", fetchImpl, scrapeLimit: 1 });
    const pages = await provider.crawl("x.com");
    // 2 unique links; 1 scraped (metrics), 1 remainder (URL-only)
    expect(pages).toHaveLength(2);
    expect(pages[0].title).toBe("P");
    expect(pages[1]).toEqual({ url: "https://x.com/b" });
  });

  it("firecrawl provider: a per-page scrape failure degrades to URL-only", async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/map")) {
        return { ok: true, status: 200, json: async () => ({ links: ["https://x.com/a"] }) };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });
    const provider = createFirecrawlProvider({ apiKey: "k", fetchImpl });
    const pages = await provider.crawl("x.com");
    expect(pages).toEqual([{ url: "https://x.com/a" }]);
  });

  it("firecrawl provider throws when map fails (fail-closed crawl)", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    const provider = createFirecrawlProvider({ apiKey: "k", fetchImpl });
    await expect(provider.crawl("x.com")).rejects.toThrow(/map failed/);
  });

  it("selectCrawlProvider degrades to noop without a key, firecrawl with one", () => {
    expect(selectCrawlProvider({}).name).toBe("noop");
    expect(selectCrawlProvider({ FIRECRAWL_API_KEY: "k" }).name).toBe("firecrawl");
  });
});
