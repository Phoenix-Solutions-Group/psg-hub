import { describe, expect, it } from "vitest";
import { summarizeDirectMailMetrics } from "../direct-mail";

describe("summarizeDirectMailMetrics", () => {
  it("summarizes shop-scoped send volume, households, pieces, and recent activity", () => {
    const out = summarizeDirectMailMetrics({
      shopIds: ["shop_1"],
      from: "2026-06-14",
      sendHistoryRows: [
        {
          piece_code: "07",
          piece_variant: "letter",
          sent_date: "2026-07-10",
          household_key: "household_a",
          updated_at: "2026-07-10T12:00:00Z",
        },
        {
          piece_code: "07",
          piece_variant: "letter",
          sent_date: "2026-07-09",
          household_key: "household_a",
          updated_at: "2026-07-10T12:00:00Z",
        },
        {
          piece_code: "10",
          piece_variant: "letter",
          sent_date: "2026-07-08",
          household_key: "household_b",
          updated_at: "2026-07-08T12:00:00Z",
        },
      ],
      productionRows: [
        {
          piece_type: "postcard",
          status: "mailed",
          created_at: "2026-07-11T08:00:00Z",
          updated_at: "2026-07-11T08:00:00Z",
        },
      ],
      priorRows: [],
    });

    expect(out.activity.lettersMailed).toBe(4);
    expect(out.activity.householdsReached).toBe(2);
    expect(out.activity.latestSentDate).toBe("2026-07-11");
    expect(out.activity.piecesByType[0]).toMatchObject({
      pieceCode: "07",
      label: "Thank-you, warranty, and survey notice",
      variant: "letter",
      sent: 2,
    });
    expect(out.activity.recentSendActivity[0]).toMatchObject({
      date: "2026-07-11",
      sent: 1,
    });
    expect(out.privacy.rawRecipientFieldsIncluded).toBe(false);
  });

  it("keeps result metrics unavailable until shop-scoped mined outcomes exist", () => {
    const out = summarizeDirectMailMetrics({
      shopIds: ["shop_1"],
      from: "2026-06-14",
      sendHistoryRows: [],
      priorRows: [],
    });

    expect(out.results.status).toBe("unavailable");
    expect(out.results.responsesOrOutcomes).toBe(0);
    expect(out.results.responseRate).toBeNull();
    expect(out.results.bestPerformingPiece).toBeNull();
    expect(out.totalOutcomes).toBe(0);
    expect(out.outcomeRate).toBeNull();
  });

  it("suppresses small-sample result rates instead of showing misleading percentages", () => {
    const out = summarizeDirectMailMetrics({
      shopIds: ["shop_1"],
      from: "2026-06-14",
      sendHistoryRows: [],
      priorRows: [
        {
          piece_code: "07",
          ab_variant: "A",
          n_sent: 10,
          n_outcome: 2,
          outcome_rate: "0.2",
          computed_at: "2026-07-10T00:00:00Z",
        },
      ],
    });

    expect(out.results.status).toBe("insufficient_data");
    expect(out.results.responseRate).toBeNull();
    expect(out.results.bestPerformingPiece).toBeNull();
    expect(out.results.message).toContain("Not enough mailed pieces yet");
  });

  it("returns result count, rate, and best piece when mined outcomes are sufficient", () => {
    const out = summarizeDirectMailMetrics({
      shopIds: ["shop_1"],
      from: "2026-06-14",
      sendHistoryRows: [],
      priorRows: [
        {
          piece_code: "07",
          ab_variant: "A",
          n_sent: 30,
          n_outcome: 9,
          outcome_rate: "0.3",
          computed_at: "2026-07-10T00:00:00Z",
        },
        {
          piece_code: "10",
          ab_variant: "B",
          n_sent: 40,
          n_outcome: 4,
          outcome_rate: "0.1",
          computed_at: "2026-07-10T00:00:00Z",
        },
      ],
    });

    expect(out.results.status).toBe("ready");
    expect(out.results.responsesOrOutcomes).toBe(13);
    expect(out.results.responseRate).toBeCloseTo(13 / 70);
    expect(out.results.bestPerformingPiece).toMatchObject({
      pieceCode: "07",
      variant: "A",
      sent: 30,
      outcomes: 9,
    });
    expect(out.results.bestPerformingPiece?.outcomeRate).toBeCloseTo(9 / 30);
  });
});
