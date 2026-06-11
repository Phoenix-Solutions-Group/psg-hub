import { describe, it, expect } from "vitest";
import { formatNumber, formatShortDate } from "@/lib/analytics/aggregate";
import type { ReportData, SourceReportBlock } from "@/lib/report/types";
import type { ReportNarrative } from "@/lib/report/schema";
import { renderReportHtml } from "@/lib/report/render";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Frozen ReportData + ReportNarrative. semrush is a COLD START (prior=null) to
// exercise the within-period branch. Narrative prose is intentionally number-free
// so the "no invented numbers" check can attribute every body numeral to data.

function block(
  source: SourceReportBlock["source"],
  current: Record<string, number | null>,
  prior: Record<string, number | null> | null,
  trend: Record<string, { date: string; value: number }[]>
): SourceReportBlock {
  const momDelta: Record<string, number | null> = {};
  for (const k of Object.keys(current)) {
    const c = current[k];
    const p = prior ? prior[k] ?? null : null;
    momDelta[k] = c === null || p === null || p === 0 ? null : (c - p) / p;
  }
  return { source, current, prior, momDelta, trend };
}

const fullData: ReportData = {
  shopId: "11111111-1111-1111-1111-111111111111",
  periodMonth: "2026-05",
  window: { start: "2026-05-01", end: "2026-05-31" },
  sources: {
    ga4: block(
      "ga4",
      { sessions: 1200, key_events: 34 },
      { sessions: 1000, key_events: 30 },
      { sessions: [
        { date: "2026-05-01", value: 30 },
        { date: "2026-05-15", value: 45 },
        { date: "2026-05-31", value: 50 },
      ] }
    ),
    gsc: block(
      "gsc",
      { clicks: 500, impressions: 9000 },
      { clicks: 450, impressions: 8000 },
      { clicks: [
        { date: "2026-05-01", value: 12 },
        { date: "2026-05-31", value: 18 },
      ] }
    ),
    google_ads: block(
      "google_ads",
      { conversions: 25, spend: 800 },
      { conversions: 20, spend: 700 },
      { conversions: [
        { date: "2026-05-01", value: 0 },
        { date: "2026-05-31", value: 3 },
      ] }
    ),
    semrush: block(
      "semrush",
      { organic_keywords: 340, organic_traffic: 1290 },
      null,
      { organic_keywords: [
        { date: "2026-05-01", value: 330 },
        { date: "2026-05-31", value: 340 },
      ] }
    ),
  },
  linkedSources: ["ga4", "gsc", "google_ads", "semrush"],
  sourcesWithPriorMonth: ["ga4", "gsc", "google_ads"],
  generatedAt: "2026-06-11T12:00:00Z",
};

const narrative: ReportNarrative = {
  headline: "A steady month of growth across your marketing channels",
  executiveSummary:
    "Your search and paid channels both moved up this month while organic SEO continues to build. The gains are consistent across sources.",
  sourceSummaries: {
    ga4: "Website sessions rose as more visitors found the site.",
    gsc: "Organic search clicks climbed on stronger impressions.",
    google_ads: "Paid conversions improved on steady spend.",
    semrush: "Organic keyword coverage is building from a fresh baseline.",
  },
  recommendations: [
    "Keep investing in the service pages that are gaining search traffic.",
    "Maintain the current paid budget while conversions trend up.",
  ],
};

// Replicate render.ts visible-number formatting to build the allowed set.
function fmtValue(key: string, value: number | null): string {
  if (value === null) return "n/a";
  if (["ctr", "engagement_rate"].includes(key)) return `${(value * 100).toFixed(1)}%`;
  if (key === "position") return value.toFixed(1);
  if (["spend", "organic_traffic_cost", "cpl"].includes(key)) return `$${formatNumber(Math.round(value))}`;
  return formatNumber(Math.round(value));
}
function fmtMom(r: number | null): string {
  if (r === null) return "";
  const p = Math.round(r * 100);
  return p === 0 ? "flat" : `${p > 0 ? "+" : ""}${p}%`;
}

function allowedNumberStrings(data: ReportData): string[] {
  const out: string[] = [];
  for (const source of data.linkedSources) {
    const b = data.sources[source] as SourceReportBlock;
    for (const [k, v] of Object.entries(b.current)) {
      out.push(fmtValue(k, v));
      out.push(fmtMom(b.momDelta[k] ?? null));
    }
    if (b.prior) for (const [k, v] of Object.entries(b.prior)) out.push(fmtValue(k, v));
    for (const series of Object.values(b.trend)) {
      const key = Object.keys(b.trend)[0];
      for (const p of series) out.push(fmtValue(key, p.value), formatShortDate(p.date));
    }
  }
  out.push(formatShortDate(data.window.start), formatShortDate(data.window.end));
  // footer date (June 11, 2026) + month label year (May 2026).
  out.push("11", "2026");
  return out;
}

function bodyText(html: string): string {
  const body = html.slice(html.indexOf("<body>"));
  return body.replace(/<[^>]*>/g, " ");
}

describe("renderReportHtml", () => {
  it("renders all linked source sections in canon order", () => {
    const html = renderReportHtml(fullData, narrative);
    expect(html).toContain("Google Search Console");
    expect(html).toContain("Google Analytics");
    expect(html).toContain("Google Ads");
    expect(html).toContain("SEMrush");
    // per-source order GSC -> GA4 -> Ads -> SEMrush
    expect(html.indexOf("Google Search Console")).toBeLessThan(html.indexOf("Google Ads"));
  });

  it("omits sources not in linkedSources (never zero-filled)", () => {
    const partial: ReportData = {
      ...fullData,
      sources: { ga4: fullData.sources.ga4, gsc: fullData.sources.gsc },
      linkedSources: ["ga4", "gsc"],
      sourcesWithPriorMonth: ["ga4", "gsc"],
    };
    const html = renderReportHtml(partial, narrative);
    expect(html).not.toContain("badge-src\">Google Ads");
    expect(html).not.toContain("badge-src\">SEMrush");
    // exactly 2 KPI cards when 2 sources linked
    expect(html.match(/class="kpi"/g)?.length).toBe(2);
  });

  it("renders the 4 KPI cards when all sources are linked", () => {
    const html = renderReportHtml(fullData, narrative);
    expect(html.match(/class="kpi"/g)?.length).toBe(4);
    expect(html).toContain("Website sessions");
    expect(html).toContain("Search clicks");
    expect(html).toContain("Ads conversions");
    expect(html).toContain("Organic keywords");
  });

  it("frames a cold-start source within-period, not as a MoM delta", () => {
    const html = renderReportHtml(fullData, narrative);
    // semrush has no prior -> its KPI card + rows say within-period, no percent delta
    expect(html).toContain("New this period");
    expect(html).toContain("Within period");
    // the semrush KPI value is present and grounded
    expect(html).toContain("340");
  });

  it("grounds every body numeral in ReportData (no invented numbers)", () => {
    const html = renderReportHtml(fullData, narrative);
    const allowed = new Set(
      allowedNumberStrings(fullData)
        .join(" ")
        .match(/\d+/g) ?? []
    );
    const bodyNums = bodyText(html).match(/\d+/g) ?? [];
    const invented = bodyNums.filter((n) => !allowed.has(n));
    expect(invented).toEqual([]);
  });

  it("emits no em dash or emoji (brand backstop)", () => {
    const html = renderReportHtml(fullData, narrative);
    expect(html).not.toMatch(/[—–]/); // em/en dash
    // emoji ranges
    expect(html).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("includes the PSG footer and root-relative font faces", () => {
    const html = renderReportHtml(fullData, narrative);
    expect(html).toContain("Prepared by Phoenix Solutions Group");
    expect(html).toContain('url("/fonts/Gotham-Book.otf")');
    // never the path-relative trap the worker cannot resolve
    expect(html).not.toMatch(/url\("fonts\//);
  });
});
