import { describe, expect, it } from "vitest";
import { parseLocalFalconCsv } from "../csv";

describe("parseLocalFalconCsv", () => {
  it("turns a first-batch Local Falcon CSV export into one shop-scoped snapshot", () => {
    const csv = [
      "Keyword,Grid Point,Rank,Share of Local Voice,Priority Notes,Campaign,Grid Size",
      "collision repair,North,2,68%,Defend north grid,Wallace July,7x7",
      "collision repair,South,5,68%,Improve south photos,Wallace July,7x7",
      "auto body shop,North,1,74%,,Wallace July,7x7",
    ].join("\n");

    const snapshot = parseLocalFalconCsv({
      shopId: "00000000-0000-0000-0000-000000000001",
      capturedAt: "2026-07-10T00:00:00Z",
      sourceFileName: "wallace-local-falcon-july.csv",
      csv,
      importedByProfileId: "00000000-0000-0000-0000-000000000099",
    });

    expect(snapshot.shop_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(snapshot.share_of_local_voice).toBe(70);
    expect(snapshot.average_rank).toBeCloseTo(8 / 3);
    expect(snapshot.campaign_name).toBe("Wallace July");
    expect(snapshot.grid_size).toBe("7x7");
    expect(snapshot.priority_notes).toEqual([
      "Defend north grid",
      "Improve south photos",
    ]);
    expect(snapshot.keyword_summaries).toEqual([
      {
        keyword: "collision repair",
        locations: 2,
        averageRank: 3.5,
        topThreeLocations: 1,
        priorityNotes: ["Defend north grid", "Improve south photos"],
      },
      {
        keyword: "auto body shop",
        locations: 1,
        averageRank: 1,
        topThreeLocations: 1,
        priorityNotes: [],
      },
    ]);
  });
});
