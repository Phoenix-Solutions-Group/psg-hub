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
    expect(html).not.toMatch(/address|phone|email|household key/i);
  });

  it("renders activity, pieces, recent activity, and ready results", () => {
    const html = renderPanel({
      ...EMPTY_DIRECT_MAIL_METRICS,
      activity: {
        lettersMailed: 42,
        householdsReached: 31,
        latestSentDate: "2026-07-10",
        lastUpdatedAt: "2026-07-11T00:00:00Z",
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
        lastUpdatedAt: "2026-07-11T00:00:00Z",
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
    expect(html).toContain("Households reached");
    expect(html).toContain("31");
    expect(html).toContain("Thank-you, warranty, and survey notice (A)");
    expect(html).toContain("30.0%");
    expect(html).toContain("Jul 10");
  });

  it("renders partial activity with an honest results-unavailable state", () => {
    const html = renderPanel({
      ...EMPTY_DIRECT_MAIL_METRICS,
      activity: {
        ...EMPTY_DIRECT_MAIL_METRICS.activity,
        lettersMailed: 8,
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
    expect(html).toContain("Not available yet");
  });

  it("formats percentages to one decimal place", () => {
    expect(formatPercent(0.1234)).toBe("12.3%");
  });
});
