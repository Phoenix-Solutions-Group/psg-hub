import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DirectMailPanel,
  formatPercent,
} from "@/components/analytics/direct-mail-panel";
import {
  EMPTY_DIRECT_MAIL_METRICS,
  type DirectMailMetrics,
} from "@/lib/analytics/direct-mail";

function renderPanel(metrics: DirectMailMetrics = EMPTY_DIRECT_MAIL_METRICS) {
  return renderToStaticMarkup(
    <DirectMailPanel metrics={metrics} scopeLabel="Wallace Collision" />
  );
}

describe("DirectMailPanel", () => {
  it("renders the empty state without recipient details", () => {
    const html = renderPanel();
    expect(html).toContain("No direct-mail data imported yet");
    expect(html).toContain("customer reach will appear here");
    expect(html).toContain("Privacy:");
    expect(html).not.toMatch(/phone|email|household key|recipient hash/i);
  });

  it("renders activity, pieces, recent activity, and ready results", () => {
    const html = renderPanel({
      ...EMPTY_DIRECT_MAIL_METRICS,
      activity: {
        lettersMailed: 42,
        lettersMailedMonthToDate: 12,
        lettersMailedYearToDate: 30,
        lettersMailedLifetime: 42,
        estimatedReferralReach: {
          monthToDate: 36,
          yearToDate: 90,
          lifetime: 126,
          multiplier: 3,
          label: "Estimated reach: letters mailed x 3 people told",
        },
        householdsReached: 31,
        latestSentDate: "2026-07-10",
        lastUpdatedAt: "2026-08-04T17:15:23.707034+00:00",
        piecesByType: [
          {
            pieceCode: "07",
            label: "Thank-you, warranty, and survey notice",
            variant: "A",
            sent: 30,
            outcomes: 9,
            outcomeRate: 0.3,
          },
        ],
        recentSendActivity: [
          {
            date: "2026-07-10",
            sent: 12,
            pieces: [
              {
                pieceCode: "07",
                label: "Thank-you, warranty, and survey notice",
                variant: "A",
                sent: 12,
                outcomes: 0,
                outcomeRate: null,
              },
            ],
          },
        ],
      },
      results: {
        status: "ready",
        responsesOrOutcomes: 9,
        responseRate: 0.3,
        bestPerformingPiece: {
          pieceCode: "07",
          label: "Thank-you, warranty, and survey notice",
          variant: "A",
          sent: 30,
          outcomes: 9,
          outcomeRate: 0.3,
        },
        monthlyTrend: [
          {
            month: "2026-07",
            mailed: 42,
            outcomes: null,
            outcomeRate: null,
            message:
              "Mined outcomes are available as an overall shop result; month-by-month outcomes need month-scoped mining.",
          },
        ],
        lastUpdatedAt: "2026-07-11T00:00:00Z",
        message: null,
      },
      postRepairSalesShare: {
        status: "ready",
        repairSalesCents: 120000,
        overallShopSalesCents: 200000,
        share: 0.6,
        message: null,
      },
      totalSent: 42,
      recentSent: 42,
      latestSentDate: "2026-07-10",
      totalOutcomes: 9,
      outcomeRate: 0.3,
    });

    expect(html).toContain("Letters mailed");
    expect(html).toContain("42");
    expect(html).toContain("Letters mailed this month");
    expect(html).toContain("12");
    expect(html).toContain("Letters mailed this year");
    expect(html).toContain("90 estimated people reached");
    expect(html).toContain("Measured");
    expect(html).toContain("Estimated referral reach");
    expect(html).toContain("Model: each mailed letter leads to 3 people");
    expect(html).toContain("Estimate");
    expect(html).toContain("Post-repair sales share");
    expect(html).toContain("60.0%");
    expect(html).toContain("$1,200 post-repair sales");
    expect(html).toContain("Customer response signals");
    expect(html).toContain("Response signal rate");
    expect(html).toContain("Best-performing letter");
    expect(html).toContain("Where mail went");
    expect(html).toContain("General service area");
    expect(html).toContain("not show exact recipient locations");
    expect(html).toContain("Letters by campaign type");
    expect(html).toContain("Monthly mail-result trend");
    expect(html).toContain("Jul 2026");
    expect(html).toContain("Results pending");
    expect(html).toContain("Households reached");
    expect(html).toContain("31");
    expect(html).toContain("Thank-you, warranty, and survey notice (A)");
    expect(html).toContain("30.0%");
    expect(html).toContain("Last updated Aug 4");
    expect(html).not.toContain("2026-08-04T17:15:23.707034+00:00");
    expect(html).toContain("Jul 10");
    expect(html).toContain("Some numbers are estimates");
    expect(html).toContain("recipient names");
    expect(html).not.toMatch(/recipient hash|household key|phone number|email address/i);
  });

  it("renders partial activity with an honest results-unavailable state", () => {
    const html = renderPanel({
      ...EMPTY_DIRECT_MAIL_METRICS,
      activity: {
        ...EMPTY_DIRECT_MAIL_METRICS.activity,
        lettersMailed: 8,
        lettersMailedMonthToDate: 8,
        lettersMailedYearToDate: 8,
        lettersMailedLifetime: 8,
        estimatedReferralReach: {
          monthToDate: 24,
          yearToDate: 24,
          lifetime: 24,
          multiplier: 3,
          label: "Estimated reach: letters mailed x 3 people told",
        },
        householdsReached: null,
        latestSentDate: "2026-07-09",
        piecesByType: [
          {
            pieceCode: "postcard",
            label: "Postcard",
            variant: null,
            sent: 8,
            outcomes: 0,
            outcomeRate: null,
          },
        ],
      },
      results: {
        ...EMPTY_DIRECT_MAIL_METRICS.results,
        status: "insufficient_data",
        message: "Not enough mailed pieces yet.",
      },
      totalSent: 8,
      latestSentDate: "2026-07-09",
    });

    expect(html).toContain("Waiting on history");
    expect(html).toContain("Not enough mailed pieces yet.");
    expect(html).toContain("Building history");
    expect(html).toContain("waiting on repair sales and package pricing");
  });

  it("formats percentages to one decimal place", () => {
    expect(formatPercent(0.1234)).toBe("12.3%");
  });
});
