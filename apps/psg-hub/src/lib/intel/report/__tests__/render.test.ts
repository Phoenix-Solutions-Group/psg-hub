// v1.6 / 16-03 — Competitor report renderer + PDF seam tests.
// END TO END from a FIXTURE DATASET: raw competitors + scores -> assembleCompetitorReport
// -> renderCompetitorReportHtml -> renderCompetitorReportPdf (mocked Chromium-worker transport).
// Pure: no DB, no network, no real Chromium, no LLM/vendor spend.
import { describe, it, expect, vi } from "vitest";
import { assembleCompetitorReport } from "../report-data";
import { renderCompetitorReportHtml } from "../render";
import {
  renderCompetitorReportPdf,
  type RenderHttpPost,
  type RenderHttpResponse,
} from "../render-pdf";
import { CircuitBreaker } from "@/lib/resilience";
import type { Competitor, CompetitorScore } from "../../competitor/types";
import type { GroundedNarrative } from "../types";

const GEN_AT = "2026-06-18T00:00:00.000Z";
const fastRetry = { retries: 2, baseDelayMs: 0, sleep: async () => {}, jitter: () => 0 };

// ── Fixture dataset: a shop with a Caliber location + two independents ───────────────
function comp(p: Partial<Competitor> & { id: string }): Competitor {
  return {
    id: p.id,
    shopId: p.shopId ?? "shop-fixture",
    name: p.name ?? `Comp ${p.id}`,
    type: p.type ?? "independent",
    consolidatorGroup: p.consolidatorGroup ?? null,
    latitude: null,
    longitude: null,
    distanceMiles: p.distanceMiles ?? null,
    rating: p.rating ?? null,
    reviewCount: p.reviewCount ?? null,
    website: null,
    source: "manual",
  };
}
function sc(p: Partial<CompetitorScore> & { competitorId: string; rank: number }): CompetitorScore {
  return {
    competitorId: p.competitorId,
    shopId: p.shopId ?? "shop-fixture",
    threatScore: p.threatScore ?? 50,
    proximityScore: 0.5,
    presenceScore: 0.5,
    consolidatorWeight: p.consolidatorWeight ?? 1,
    rank: p.rank,
    rationale: p.rationale ?? "rationale",
  };
}

const COMPETITORS: Competitor[] = [
  comp({ id: "a", name: "Caliber Collision <Northside>", type: "consolidator", consolidatorGroup: "Caliber Collision", distanceMiles: 2.1, rating: 4.5, reviewCount: 220 }),
  comp({ id: "b", name: "Joe's Auto Body", distanceMiles: 4.3, rating: 4.1, reviewCount: 60 }),
  comp({ id: "c", name: "Budget Dents", distanceMiles: 7.0, rating: 3.4, reviewCount: 12 }),
];
const SCORES: CompetitorScore[] = [
  sc({ competitorId: "a", rank: 1, threatScore: 88, consolidatorWeight: 1.35, rationale: "Caliber Collision location (x1.35 threat) - 2.1 mi away" }),
  sc({ competitorId: "b", rank: 2, threatScore: 52 }),
  sc({ competitorId: "c", rank: 3, threatScore: 20 }),
];

function pdfResponse(status: number, bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])): RenderHttpResponse {
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => bytes.buffer.slice(0) };
}

describe("renderCompetitorReportHtml", () => {
  it("renders a self-contained, grounded HTML document from the fixture report", async () => {
    const report = await assembleCompetitorReport(COMPETITORS, SCORES, { generatedAt: GEN_AT });
    const html = renderCompetitorReportHtml(report);

    // Self-contained document shell with inlined styles + fonts (worker embeds them).
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("@font-face");
    expect(html).toContain('url("/fonts/Gotham-Book.otf")'); // root-relative (resolves at worker)

    // Deterministic KPIs surfaced from the summary.
    expect(html).toContain("Competitors tracked");
    expect(html).toContain("33%"); // consolidator share 1/3
    expect(html).toContain("Top threat score");

    // Ranked table with every competitor, tier band, and consolidator labelling.
    expect(html).toContain("Threat ranking");
    expect(html).toContain("Joe's Auto Body");
    expect(html).toContain("Budget Dents");
    expect(html).toContain("Caliber Collision");
    expect(html).toContain('class="tier critical"');
    expect(html).toContain('class="tier elevated"');
    expect(html).toContain('class="tier low"');

    // Pre-G5: narrative degrades to the pending-activation notice, not a fake summary.
    expect(html).toContain("pending G5 vendor-spend activation");
  });

  it("escapes untrusted competitor names (no raw HTML injection)", async () => {
    const report = await assembleCompetitorReport(COMPETITORS, SCORES, { generatedAt: GEN_AT });
    const html = renderCompetitorReportHtml(report);
    // "Caliber Collision <Northside>" must have its angle brackets escaped.
    expect(html).toContain("Caliber Collision &lt;Northside&gt;");
    expect(html).not.toContain("<Northside>");
  });

  it("renders the grounded narrative + recommended moves when a narrative is present", async () => {
    const grounded: GroundedNarrative = {
      summary: "A Caliber location anchors the threat set.",
      keyMoves: ["Defend Google reviews", "Geo-target paid ads on Caliber's radius"],
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4.6",
    };
    const report = await assembleCompetitorReport(COMPETITORS, SCORES, {
      generatedAt: GEN_AT,
      narrate: async () => grounded,
    });
    const html = renderCompetitorReportHtml(report);
    expect(html).toContain("A Caliber location anchors the threat set.");
    expect(html).toContain("Recommended moves");
    expect(html).toContain("Defend Google reviews");
    expect(html).toContain("Grounded by anthropic");
    expect(html).not.toContain("pending G5 vendor-spend activation");
  });

  it("renders an empty-state panel when the shop has no competitors", async () => {
    const report = await assembleCompetitorReport([], [], { generatedAt: GEN_AT });
    const html = renderCompetitorReportHtml(report);
    expect(html).toContain("No competitors are currently tracked");
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });
});

describe("renderCompetitorReportPdf — end-to-end fixture -> PDF bytes", () => {
  it("POSTs the rendered HTML to the worker and returns print-ready PDF bytes", async () => {
    const report = await assembleCompetitorReport(COMPETITORS, SCORES, { generatedAt: GEN_AT });
    const html = renderCompetitorReportHtml(report);

    const httpPost = vi.fn<RenderHttpPost>(async () => pdfResponse(200));
    const pdf = await renderCompetitorReportPdf(html, {
      httpPost,
      retry: fastRetry,
      renderUrl: "https://worker.psgweb.me/render",
      token: "tok_test",
    });

    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(Array.from(pdf.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    expect(httpPost).toHaveBeenCalledTimes(1);
    const [url, init] = httpPost.mock.calls[0];
    expect(url).toBe("https://worker.psgweb.me/render");
    expect(init.headers.Authorization).toBe("Bearer tok_test");
    expect(JSON.parse(init.body).html).toBe(html); // setContent path: html shipped inline
  });

  it("retries a transient worker failure then succeeds", async () => {
    const httpPost = vi
      .fn<RenderHttpPost>()
      .mockResolvedValueOnce(pdfResponse(503))
      .mockResolvedValueOnce(pdfResponse(200));
    const pdf = await renderCompetitorReportPdf("<html/>", {
      httpPost,
      retry: fastRetry,
      breaker: new CircuitBreaker({ failureThreshold: 5 }),
      renderUrl: "https://worker.psgweb.me/render",
      token: "tok_test",
    });
    expect(pdf.length).toBe(4);
    expect(httpPost).toHaveBeenCalledTimes(2);
  });

  it("fails loud when the render worker URL is not configured", async () => {
    await expect(
      renderCompetitorReportPdf("<html/>", { retry: fastRetry, token: "tok_test" }),
    ).rejects.toThrow(/INTEL_REPORT_RENDER_URL/);
  });
});
