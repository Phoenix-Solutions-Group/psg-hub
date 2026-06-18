import { describe, it, expect } from "vitest";
import {
  marketDashboardRun,
  monthlyCsiDisplayRun,
  surveyAlertRecapRun,
} from "../live/survey";
import type { ReportContext, ReportParams } from "../types";

type StubRow = {
  shop_name: string | null;
  survey_date: string | null;
  scale_emi_pct: number | string | null;
  q05_01?: number | string | null;
  q05_02?: number | string | null;
  q05_03?: number | string | null;
  q05_04?: number | string | null;
  response_id?: string | null;
};

/**
 * Minimal stub of the Supabase query-builder surface monthlyCsiDisplayRun uses:
 * .from().select().gte().lte().ilike() then await -> { data, error }. The
 * builder is thenable so `await query` resolves to the recorded result, and it
 * records the filters applied so we can assert the query was shaped correctly.
 */
function stubDb(rows: StubRow[], error: { message: string } | null = null) {
  const calls = {
    table: "",
    select: "",
    gte: undefined as string | undefined,
    lte: undefined as string | undefined,
    ilike: undefined as string | undefined,
  };
  const builder: Record<string, unknown> = {
    from(table: string) {
      calls.table = table;
      return builder;
    },
    select(cols: string) {
      calls.select = cols;
      return builder;
    },
    gte(_col: string, v: string) {
      calls.gte = v;
      return builder;
    },
    lte(_col: string, v: string) {
      calls.lte = v;
      return builder;
    },
    ilike(_col: string, v: string) {
      calls.ilike = v;
      return builder;
    },
    then(resolve: (r: { data: StubRow[] | null; error: unknown }) => unknown) {
      return Promise.resolve(resolve({ data: error ? null : rows, error }));
    },
  };
  return { db: builder as unknown as ReportContext["db"], calls };
}

const ctx = (db: ReportContext["db"]): ReportContext => ({
  db,
  shopIds: null,
  generatedAt: "2026-06-18T00:00:00.000Z",
});

const params = (
  over: Partial<{ start: string; end: string; shopId: string }> = {},
): ReportParams => ({
  start: over.start ?? null,
  end: over.end ?? null,
  filters: over.shopId ? { shopId: over.shopId } : {},
});

describe("monthlyCsiDisplayRun", () => {
  it("groups by (month, shop), counts surveys and computes CSI = avg(emi)×100", async () => {
    const { db } = stubDb([
      { shop_name: "Anaheim Collision", survey_date: "2026-01-04", scale_emi_pct: 0.9 },
      { shop_name: "Anaheim Collision", survey_date: "2026-01-20", scale_emi_pct: 0.96 },
      { shop_name: "Anaheim Collision", survey_date: "2026-02-02", scale_emi_pct: 0.88 },
      { shop_name: "Riverside Auto Body", survey_date: "2026-01-15", scale_emi_pct: 0.8 },
    ]);

    const rows = await monthlyCsiDisplayRun(params(), ctx(db));

    expect(rows).toEqual([
      { month: "2026-01", shop: "Anaheim Collision", csi: 93, surveys: 2 },
      { month: "2026-01", shop: "Riverside Auto Body", csi: 80, surveys: 1 },
      { month: "2026-02", shop: "Anaheim Collision", csi: 88, surveys: 1 },
    ]);
  });

  it("rounds CSI to one decimal place", async () => {
    const { db } = stubDb([
      { shop_name: "A", survey_date: "2026-03-01", scale_emi_pct: 0.911 },
      { shop_name: "A", survey_date: "2026-03-02", scale_emi_pct: 0.914 },
    ]);
    const rows = await monthlyCsiDisplayRun(params(), ctx(db));
    // mean = 0.9125 -> ×100 = 91.25 -> round1 = 91.3
    expect(rows[0].csi).toBe(91.3);
  });

  it("counts surveys even when emi is null, and yields null CSI when no emi", async () => {
    const { db } = stubDb([
      { shop_name: "A", survey_date: "2026-04-01", scale_emi_pct: null },
      { shop_name: "A", survey_date: "2026-04-09", scale_emi_pct: null },
    ]);
    const rows = await monthlyCsiDisplayRun(params(), ctx(db));
    expect(rows).toEqual([{ month: "2026-04", shop: "A", csi: null, surveys: 2 }]);
  });

  it("coerces numeric-string emi and bucket-skips unparseable dates", async () => {
    const { db } = stubDb([
      { shop_name: "A", survey_date: "2026-05-01", scale_emi_pct: "0.92" },
      { shop_name: "A", survey_date: "not-a-date", scale_emi_pct: "0.10" },
      { shop_name: "A", survey_date: null, scale_emi_pct: "0.10" },
    ]);
    const rows = await monthlyCsiDisplayRun(params(), ctx(db));
    expect(rows).toEqual([{ month: "2026-05", shop: "A", csi: 92, surveys: 1 }]);
  });

  it("applies date-range and shop filters to the query", async () => {
    const { db, calls } = stubDb([]);
    await monthlyCsiDisplayRun(
      params({ start: "2026-01-01", end: "2026-03-31", shopId: "Anaheim" }),
      ctx(db),
    );
    expect(calls.table).toBe("survey_responses");
    expect(calls.gte).toBe("2026-01-01");
    expect(calls.lte).toBe("2026-03-31");
    expect(calls.ilike).toBe("%Anaheim%");
  });

  it("throws on a db error (runner degrades to sample)", async () => {
    const { db } = stubDb([], { message: "boom" });
    await expect(monthlyCsiDisplayRun(params(), ctx(db))).rejects.toThrow("boom");
  });

  it("throws when no db context is present", async () => {
    await expect(monthlyCsiDisplayRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });

  it("falls back to a placeholder shop label when shop_name is missing", async () => {
    const { db } = stubDb([
      { shop_name: null, survey_date: "2026-06-01", scale_emi_pct: 0.9 },
    ]);
    const rows = await monthlyCsiDisplayRun(params(), ctx(db));
    expect(rows[0].shop).toBe("—");
  });
});

describe("marketDashboardRun", () => {
  const rows: StubRow[] = [
    // Selected shop (Anaheim): emi 0.90 & 0.96 -> CSI 93; quality 8/9 -> 8.5
    { shop_name: "Anaheim Collision", survey_date: "2026-01-04", scale_emi_pct: 0.9, q05_01: 8, q05_02: 9, q05_03: 7, q05_04: 9 },
    { shop_name: "Anaheim Collision", survey_date: "2026-01-20", scale_emi_pct: 0.96, q05_01: 9, q05_02: 9, q05_03: 9, q05_04: 9 },
    // Rest of network (Riverside): emi 0.80 -> CSI 80; quality 6
    { shop_name: "Riverside Auto Body", survey_date: "2026-01-15", scale_emi_pct: 0.8, q05_01: 6, q05_02: 6, q05_03: 6, q05_04: 6 },
  ];

  it("computes shop avg vs network (market) avg per metric, with delta", async () => {
    const { db } = stubDb(rows);
    const out = await marketDashboardRun(params({ shopId: "Anaheim" }), ctx(db));
    // network emi = avg(0.90,0.96,0.80)=0.8867 ->88.7 ; shop emi=93 ; delta 4.3
    expect(out[0]).toEqual({ metric: "Overall CSI", shop: 93, market: 88.7, delta: 4.3 });
    // Quality (q05_01, native scale, no ×100): shop avg(8,9)=8.5 ; network avg(8,9,6)=7.7 ; delta 0.8
    expect(out[1]).toEqual({ metric: "Quality", shop: 8.5, market: 7.7, delta: 0.8 });
    expect(out.map((r) => r.metric)).toEqual([
      "Overall CSI",
      "Quality",
      "Cleanliness",
      "Communication",
      "Courtesy",
    ]);
  });

  it("with no shop filter, shop subset == network so deltas are 0", async () => {
    const { db, calls } = stubDb(rows);
    const out = await marketDashboardRun(params(), ctx(db));
    expect(calls.ilike).toBeUndefined(); // network fetched unfiltered; sliced in JS
    for (const r of out) expect(r.delta).toBe(0);
  });

  it("applies only the date range to the query (shop sliced in JS)", async () => {
    const { db, calls } = stubDb([]);
    await marketDashboardRun(
      params({ start: "2026-01-01", end: "2026-03-31", shopId: "Anaheim" }),
      ctx(db),
    );
    expect(calls.gte).toBe("2026-01-01");
    expect(calls.lte).toBe("2026-03-31");
    expect(calls.ilike).toBeUndefined();
  });

  it("yields null metric/delta when a metric has no data", async () => {
    const { db } = stubDb([
      { shop_name: "A", survey_date: "2026-02-01", scale_emi_pct: null, q05_01: null, q05_02: null, q05_03: null, q05_04: null },
    ]);
    const out = await marketDashboardRun(params(), ctx(db));
    expect(out[0]).toEqual({ metric: "Overall CSI", shop: null, market: null, delta: null });
  });

  it("throws without a db context", async () => {
    await expect(marketDashboardRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("surveyAlertRecapRun", () => {
  it("returns only sub-88 surveys, newest first, with derived alert label", async () => {
    const { db } = stubDb([
      // 92% -> above threshold, excluded
      { shop_name: "Anaheim", survey_date: "2026-03-10", scale_emi_pct: 0.92, q05_01: 9, q05_02: 9, q05_03: 9, q05_04: 9, response_id: "R-1" },
      // 80% -> alert; weakest sub-score is communication (q05_03=4)
      { shop_name: "Anaheim", survey_date: "2026-03-12", scale_emi_pct: 0.8, q05_01: 8, q05_02: 7, q05_03: 4, q05_04: 8, response_id: "R-2" },
      // 70% -> alert; weakest is quality (q05_01=3)
      { shop_name: "Riverside", survey_date: "2026-03-05", scale_emi_pct: 0.7, q05_01: 3, q05_02: 8, q05_03: 8, q05_04: 8, response_id: "R-3" },
    ]);
    const out = await surveyAlertRecapRun(params(), ctx(db));
    expect(out).toEqual([
      { ro: "R-2", shop: "Anaheim", score: 80, alert: "Low Communication", date: "2026-03-12" },
      { ro: "R-3", shop: "Riverside", score: 70, alert: "Low Quality", date: "2026-03-05" },
    ]);
  });

  it("falls back to overall-CSI alert when sub-scores are absent, and '—' identifier", async () => {
    const { db } = stubDb([
      { shop_name: "A", survey_date: "2026-04-01", scale_emi_pct: 0.5, q05_01: null, q05_02: null, q05_03: null, q05_04: null, response_id: null },
    ]);
    const out = await surveyAlertRecapRun(params(), ctx(db));
    expect(out).toEqual([
      { ro: "—", shop: "A", score: 50, alert: "Low overall CSI", date: "2026-04-01" },
    ]);
  });

  it("skips rows with no EMI score (nothing to alert on)", async () => {
    const { db } = stubDb([
      { shop_name: "A", survey_date: "2026-04-01", scale_emi_pct: null, response_id: "R-9" },
    ]);
    const out = await surveyAlertRecapRun(params(), ctx(db));
    expect(out).toEqual([]);
  });

  it("applies date-range and shop filters to the query", async () => {
    const { db, calls } = stubDb([]);
    await surveyAlertRecapRun(
      params({ start: "2026-01-01", end: "2026-03-31", shopId: "Anaheim" }),
      ctx(db),
    );
    expect(calls.table).toBe("survey_responses");
    expect(calls.gte).toBe("2026-01-01");
    expect(calls.lte).toBe("2026-03-31");
    expect(calls.ilike).toBe("%Anaheim%");
  });

  it("throws without a db context", async () => {
    await expect(surveyAlertRecapRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});
