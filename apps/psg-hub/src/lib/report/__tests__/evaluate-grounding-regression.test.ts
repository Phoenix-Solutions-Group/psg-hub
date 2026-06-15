// TEMP diagnostic — reproduces the demo-shop "held" to find why the template fails eval.
import { describe, it, expect } from "vitest";
import { assembleReportData, type SnapshotReader } from "../report-data";
import { renderTemplateNarrative } from "../generate";
import { evaluateReport } from "../evaluate";
import type { AnalyticsSnapshot, AnalyticsSource } from "../../analytics/types";

const SHOP = "11111111-1111-1111-1111-111111111111";

function days(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  for (let d = s; d <= e; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const SEED: Record<AnalyticsSource, { apr: Record<string, number>; may: Record<string, number> }> = {
  ga4: {
    apr: { sessions: 22, total_users: 19, active_users: 19, new_users: 16, engaged_sessions: 18, key_events: 1 },
    may: { sessions: 26, total_users: 22, active_users: 22, new_users: 19, engaged_sessions: 22, key_events: 1 },
  },
  google_ads: {
    apr: { spend: 70, clicks: 26, impressions: 280, conversions: 4, cost_micros: 70000000 },
    may: { spend: 85, clicks: 32, impressions: 310, conversions: 6, cost_micros: 85000000 },
  },
  gsc: {
    apr: { clicks: 4, impressions: 340, position: 13.5 },
    may: { clicks: 6, impressions: 375, position: 11.5 },
  },
  semrush: {
    apr: { organic_keywords: 110, organic_traffic: 820, organic_traffic_cost: 1350, backlinks: 320, authority_score: 30 },
    may: { organic_keywords: 128, organic_traffic: 940, organic_traffic_cost: 1580, backlinks: 348, authority_score: 33 },
  },
  // GBP daily insights — all FLOW; impressions_total = sum of the four splits (kept consistent).
  gbp: {
    apr: { impressions_desktop_maps: 120, impressions_desktop_search: 80, impressions_mobile_maps: 300, impressions_mobile_search: 200, impressions_total: 700, website_clicks: 18, call_clicks: 12, direction_requests: 9, conversations: 3 },
    may: { impressions_desktop_maps: 140, impressions_desktop_search: 95, impressions_mobile_maps: 330, impressions_mobile_search: 220, impressions_total: 785, website_clicks: 22, call_clicks: 15, direction_requests: 11, conversations: 4 },
  },
};

const reader: SnapshotReader = async ({ source, from, to }) => {
  const rows: AnalyticsSnapshot[] = [];
  for (const date of days(from, to)) {
    const month = date.slice(0, 7);
    const m = month === "2026-04" ? SEED[source].apr : month === "2026-05" ? SEED[source].may : null;
    if (!m) continue;
    rows.push({ shop_id: SHOP, date, source, period: "daily", metrics: m } as unknown as AnalyticsSnapshot);
  }
  return rows;
};

describe("demo diag", () => {
  it("template eval", async () => {
    const rd = await assembleReportData(SHOP, "2026-05", { readSnapshots: reader, generatedAt: "2026-06-11T00:00:00Z" });
    expect(rd.linkedSources).toEqual(["semrush", "google_ads", "ga4", "gsc", "gbp"]);
    const tpl = renderTemplateNarrative(rd);
    const res = evaluateReport(tpl, rd);
    // Regression: the deterministic template MUST pass the eval gate by construction,
    // including the two-token "google_ads" source (was mis-filed under "google" -> F3).
    expect(res.violations).toEqual([]);
    expect(res.verdict).toBe("pass");
  });
});
