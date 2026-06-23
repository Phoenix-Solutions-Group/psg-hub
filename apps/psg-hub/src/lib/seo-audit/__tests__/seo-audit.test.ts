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
    expect(issues.some((i) => i.severity === "high" && /hidden from Google/i.test(i.note))).toBe(true);
  });

  it("flags empty + short titles distinctly", () => {
    expect(evaluatePage({ url: "u", title: "" }).some((i) => /has no title/.test(i.note))).toBe(true);
    expect(evaluatePage({ url: "u", title: "short" }).some((i) => /too short/.test(i.note))).toBe(true);
  });

  it("flags thin content under the threshold but not above", () => {
    expect(evaluatePage({ url: "u", wordCount: 50 }).some((i) => /too thin/.test(i.note))).toBe(true);
    expect(evaluatePage({ url: "u", wordCount: 500 }).some((i) => /too thin/.test(i.note))).toBe(false);
  });

  it("flags zero and multiple h1s differently", () => {
    expect(evaluatePage({ url: "u", h1Count: 0 }).some((i) => /no clear main headline/.test(i.note))).toBe(true);
    expect(evaluatePage({ url: "u", h1Count: 3 }).some((i) => /competing main headlines/.test(i.note))).toBe(true);
  });

  it("findings copy is plain-language — no SEO jargon leaks to the customer (PSG-264 item 1)", () => {
    const issues = evaluatePage({
      url: "u",
      statusCode: 404,
      indexable: false,
      title: "",
      metaDescription: "",
      h1Count: 0,
      wordCount: 10,
      hasImageAltGaps: true,
    });
    const all = issues.map((i) => i.note).join(" ");
    expect(all).not.toMatch(/<title>|<h1>|noindex|canonical|crawl budget|meta description|HTTP \d/i);
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
    // PSG-264 item 2: hero H2 reworded to customer voice.
    expect(html).toContain("Your website build plan");
    expect(html).not.toContain("Greenfield build plan");
    expect(html).toContain("No live site");
    expect(html).not.toContain("Your SEO health score");
  });

  it("greenfield KPIs show plan metrics, not 0/0/0 crawl counts (PSG-264 item 3)", () => {
    const report = buildShopAuditReport(
      brief({
        domain: null,
        services: ["collision repair", "frame straightening", "dent removal"],
        locations: [
          { city: "Lincoln", state: "NE", primary: true },
          { city: "Omaha", state: "NE", primary: false },
        ],
      }),
      { generatedAt: T },
    );
    // 4 foundation + 3 services + 2 cities = 9 pages to build, all grounded in the brief.
    expect(report.summary.plan).toEqual({ pagesToBuild: 9, servicePages: 3, citiesToCover: 2 });
    const html = renderShopAuditReportHtml(report);
    expect(html).toContain("Pages to build");
    expect(html).toContain("Service pages");
    expect(html).toContain("Cities to cover");
    expect(html).toContain("Keyword targets");
    // No misleading "Pages reviewed" / "Pages to keep" labels for a no-site report.
    expect(html).not.toContain("Pages reviewed");
    expect(html).not.toContain("Pages to keep");
  });

  it("audited summary carries plan: null and keeps crawl-count KPIs", () => {
    const pages: CrawledPage[] = [
      { url: "https://x.com/", title: "Homepage title long enough", statusCode: 200, wordCount: 600, h1Count: 1, metaDescription: "ok" },
    ];
    const report = buildShopAuditReport(brief(), { generatedAt: T, pages });
    expect(report.summary.plan).toBeNull();
    const html = renderShopAuditReportHtml(report);
    expect(html).toContain("Pages reviewed");
    expect(html).not.toContain("Pages to build");
  });

  it("findings table uses a 'Page' header with the path trimmed (PSG-264 item 4)", () => {
    const pages: CrawledPage[] = [
      { url: "https://shop.example.com/services/dent-repair", statusCode: 404 },
    ];
    const report = buildShopAuditReport(brief(), { generatedAt: T, pages });
    const html = renderShopAuditReportHtml(report);
    expect(html).toContain("<th>Page</th>");
    expect(html).not.toContain("<th>Area</th>");
    // value trimmed to the path — protocol + domain stripped in the findings column.
    expect(html).toContain('<td class="page">/services/dent-repair</td>');
    expect(html).not.toContain('<td class="page">https://shop.example.com/services/dent-repair</td>');
  });

  it("renders findings critical → low regardless of input order (PSG-264 item 5)", () => {
    // Hand-build a report with a Low ordered before a Critical to prove the
    // renderer sorts for display (not relying on upstream order).
    const report = buildShopAuditReport(brief({ domain: null }), { generatedAt: T });
    report.findings = [
      { severity: "low", area: "images", detail: "low finding" },
      { severity: "critical", area: "website", detail: "critical finding" },
      { severity: "medium", area: "content", detail: "medium finding" },
    ];
    const html = renderShopAuditReportHtml(report);
    const critPos = html.indexOf("critical finding");
    const medPos = html.indexOf("medium finding");
    const lowPos = html.indexOf("low finding");
    expect(critPos).toBeGreaterThan(-1);
    expect(critPos).toBeLessThan(medPos);
    expect(medPos).toBeLessThan(lowPos);
  });

  it("adds a mobile breakpoint, scroll wrappers, and AA-contrast KPI labels (PSG-264 items 6–7)", () => {
    const report = buildShopAuditReport(brief({ domain: null }), { generatedAt: T });
    const html = renderShopAuditReportHtml(report);
    expect(html).toContain("@media (max-width: 640px)");
    expect(html).toContain("grid-template-columns: repeat(2, 1fr)");
    expect(html).toContain('class="table-scroll"');
    // item 7: KPI label uses dark-ash (AA), not the sub-AA mist token.
    expect(html).toContain(".kpi .l { font-size: var(--fs-13); color: var(--psg-dark-ash);");
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
