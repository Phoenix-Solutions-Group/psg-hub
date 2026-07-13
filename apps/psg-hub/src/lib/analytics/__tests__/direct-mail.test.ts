import { describe, expect, it } from "vitest";
import { summarizeDirectMailMetrics } from "../direct-mail";

describe("summarizeDirectMailMetrics", () => {
  it("summarizes shop-scoped send volume and historical outcome priors", () => {
    const out = summarizeDirectMailMetrics({
      totalSent: 120,
      recentSent: 3,
      latestSentDate: "2026-07-10",
      recentRows: [
        {
          piece_code: "07",
          piece_variant: "letter",
          sent_date: "2026-07-10",
          batch_ref: "batch-1",
        },
        {
          piece_code: "07",
          piece_variant: "letter",
          sent_date: "2026-07-09",
          batch_ref: "batch-1",
        },
        {
          piece_code: "10",
          piece_variant: "letter",
          sent_date: "2026-07-08",
          batch_ref: "batch-1",
        },
      ],
      priorRows: [
        {
          piece_code: "07",
          ab_variant: "A",
          n_sent: 10,
          n_outcome: 2,
          outcome_rate: "0.2",
        },
        {
          piece_code: "07",
          ab_variant: "A",
          n_sent: 5,
          n_outcome: 2,
          outcome_rate: "0.4",
        },
        {
          piece_code: "10",
          ab_variant: "B",
          n_sent: 20,
          n_outcome: 1,
          outcome_rate: "0.05",
        },
      ],
    });

    expect(out.totalSent).toBe(120);
    expect(out.recentSent).toBe(3);
    expect(out.latestSentDate).toBe("2026-07-10");
    expect(out.recentTopPiece).toMatchObject({
      pieceCode: "07",
      variant: "letter",
      sent: 2,
    });
    expect(out.totalOutcomes).toBe(5);
    expect(out.outcomeRate).toBeCloseTo(5 / 35);
    expect(out.bestPiece).toMatchObject({
      pieceCode: "07",
      variant: "A",
      sent: 15,
      outcomes: 4,
    });
    expect(out.bestPiece?.outcomeRate).toBeCloseTo(4 / 15);
  });

  it("keeps empty and incomplete data honest", () => {
    const out = summarizeDirectMailMetrics({
      totalSent: 0,
      recentSent: 0,
      latestSentDate: null,
      recentRows: [
        {
          piece_code: "",
          piece_variant: null,
          sent_date: null,
          batch_ref: null,
        },
      ],
      priorRows: [],
    });

    expect(out.recentTopPiece).toBeNull();
    expect(out.outcomeRate).toBeNull();
    expect(out.bestPiece).toBeNull();
    expect(out.totalOutcomes).toBe(0);
  });
});
