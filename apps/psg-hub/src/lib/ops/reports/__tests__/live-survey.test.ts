import { describe, it, expect } from "vitest";
import {
  bodyTechPerformanceRun,
  estimatorCsiRun,
  marketDashboardRun,
  monthlyCsiDisplayRun,
  painterPerformanceRun,
  performanceDashboardRun,
  rentalCarAnalysisRun,
  surveyAlertRecapRun,
} from "../live/survey";
import type { ReportContext, ReportParams } from "../types";

/**
 * Per-table stub for the attribution reports, which query >1 table (and run two
 * in parallel). `.from(table)` returns a fresh thenable builder bound to that
 * table's rows; chained filters are no-ops except `.eq`, which is recorded.
 */
function multiDb(
  tables: Record<string, unknown[]>,
  errors: Record<string, { message: string }> = {},
) {
  const calls = { tables: [] as string[], eq: {} as Record<string, string> };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      gte: () => b,
      lte: () => b,
      ilike: () => b,
      eq: (col: string, v: string) => {
        calls.eq[col] = v;
        return b;
      },
      then: (
        resolve: (r: { data: unknown[] | null; error: unknown }) => unknown,
      ) => {
        const error = errors[table] ?? null;
        return Promise.resolve(
          resolve({ data: error ? null : (tables[table] ?? []), error }),
        );
      },
    };
    return b;
  };
  const db = {
    from(table: string) {
      calls.tables.push(table);
      return builder(table);
    },
  };
  return { db: db as unknown as ReportContext["db"], calls };
}

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

// Nested survey→RO→employee row, matching PostgREST embedded-select shape.
const attrSurvey = (
  emi: number | null,
  q05_01: number | null,
  recommend: boolean | null,
  role: string | null,
  name: string | null,
) => ({
  scale_emi_pct: emi,
  q05_01,
  would_recommend: recommend,
  survey_date: "2026-03-01",
  shop_name: "Anaheim",
  repair_orders:
    role === null
      ? null
      : { repair_order_employees: [{ role, employees: { name } }] },
});

describe("estimatorCsiRun", () => {
  it("groups surveys by estimator: count, CSI (avg EMI×100), recommend rate", async () => {
    const { db } = multiDb({
      survey_responses: [
        attrSurvey(0.9, 8, true, "estimator", "Pat E"),
        attrSurvey(0.8, 7, false, "estimator", "Pat E"),
        attrSurvey(0.95, 9, true, "estimator", "Sam X"),
        attrSurvey(0.5, 5, null, null, null), // unattributed → dropped
      ],
    });
    const out = await estimatorCsiRun(params(), ctx(db));
    expect(out).toEqual([
      { estimator: "Pat E", surveys: 2, csi: 85, recommend: 50 },
      { estimator: "Sam X", surveys: 1, csi: 95, recommend: 100 },
    ]);
  });

  it("throws without a db context", async () => {
    await expect(estimatorCsiRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("bodyTechPerformanceRun / painterPerformanceRun", () => {
  it("jobs+comeback from the bridge, Quality CSI (native q05_01) from surveys", async () => {
    const { db, calls } = multiDb({
      repair_order_employees: [
        { rework: false, employees: { name: "Tech A" } },
        { rework: true, employees: { name: "Tech A" } },
        { rework: false, employees: { name: "Tech B" } },
      ],
      survey_responses: [attrSurvey(0.9, 8, null, "body_tech", "Tech A")],
    });
    const out = await bodyTechPerformanceRun(params(), ctx(db));
    expect(calls.eq.role).toBe("body_tech"); // role filtered at the query
    expect(out).toEqual([
      // Tech A: 2 jobs, 1 rework → 50% comeback, quality avg(8)=8 (native, no ×100)
      { tech: "Tech A", jobs: 2, comebackRate: 50, quality: 8 },
      // Tech B: 1 job, no rework, no survey → quality null
      { tech: "Tech B", jobs: 1, comebackRate: 0, quality: null },
    ]);
  });

  it("painter view maps the same shape to redoRate / finish", async () => {
    const { db, calls } = multiDb({
      repair_order_employees: [{ rework: true, employees: { name: "Paint P" } }],
      survey_responses: [attrSurvey(0.9, 9, null, "painter", "Paint P")],
    });
    const out = await painterPerformanceRun(params(), ctx(db));
    expect(calls.eq.role).toBe("painter");
    expect(out).toEqual([
      { painter: "Paint P", jobs: 1, redoRate: 100, finish: 9 },
    ]);
  });

  it("throws without a db context", async () => {
    await expect(painterPerformanceRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("performanceDashboardRun", () => {
  it("per-shop returned/CSI/response-rate/recommend, union of surveyed + sent shops", async () => {
    const { db } = multiDb({
      survey_responses: [
        { shop_name: "Anaheim", survey_date: "2026-03-01", scale_emi_pct: 0.9, would_recommend: true },
        { shop_name: "Anaheim", survey_date: "2026-03-02", scale_emi_pct: 0.8, would_recommend: false },
        { shop_name: "Riverside", survey_date: "2026-03-03", scale_emi_pct: 0.7, would_recommend: null },
      ],
      survey_dispatches: [
        { shop_name: "Anaheim" }, { shop_name: "Anaheim" },
        { shop_name: "Anaheim" }, { shop_name: "Anaheim" }, // 4 sent
        { shop_name: "Riverside" }, { shop_name: "Riverside" }, // 2 sent
        { shop_name: "Brea" }, { shop_name: "Brea" }, // sent, zero returned
      ],
    });
    const out = await performanceDashboardRun(params(), ctx(db));
    expect(out).toEqual([
      { shop: "Anaheim", returned: 2, csi: 85, responseRate: 50, recommend: 50 },
      { shop: "Brea", returned: 0, csi: null, responseRate: 0, recommend: null },
      { shop: "Riverside", returned: 1, csi: 70, responseRate: 50, recommend: null },
    ]);
  });

  it("response rate is null when a shop has returns but no dispatch denominator", async () => {
    const { db } = multiDb({
      survey_responses: [
        { shop_name: "Solo", survey_date: "2026-03-01", scale_emi_pct: 0.9, would_recommend: true },
      ],
      survey_dispatches: [],
    });
    const out = await performanceDashboardRun(params(), ctx(db));
    expect(out[0]).toEqual({
      shop: "Solo", returned: 1, csi: 90, responseRate: null, recommend: 100,
    });
  });

  it("throws on a db error (runner degrades to sample)", async () => {
    const { db } = multiDb({}, { survey_responses: { message: "boom" } });
    await expect(performanceDashboardRun(params(), ctx(db))).rejects.toThrow("boom");
  });

  it("throws without a db context", async () => {
    await expect(performanceDashboardRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

// A rental_assignments row with its RO + shop + insurer embedded (PostgREST
// embedded-select shape: repair_orders is the to-one parent of the assignment).
const rental = (
  shop: string | null,
  insurer: string | null,
  rentalDays: number | string | null,
  rentalCost: number | string | null,
  dateIn: string | null,
  dateOut: string | null,
) => ({
  rental_days: rentalDays,
  rental_cost: rentalCost,
  start_date: dateIn,
  repair_orders: {
    dates_json:
      dateIn === null && dateOut === null
        ? {}
        : { date_in: dateIn ?? undefined, date_out: dateOut ?? undefined },
    companies: shop === null ? null : { name: shop },
    insurance_companies: insurer === null ? null : { name: insurer },
  },
});

/** Single-table stub recording start_date gte/lte filters for rental queries. */
function rentalDb(rows: unknown[], error: { message: string } | null = null) {
  const calls = {
    table: "",
    gte: undefined as string | undefined,
    lte: undefined as string | undefined,
  };
  const builder: Record<string, unknown> = {
    from(table: string) {
      calls.table = table;
      return builder;
    },
    select: () => builder,
    gte(_col: string, v: string) {
      calls.gte = v;
      return builder;
    },
    lte(_col: string, v: string) {
      calls.lte = v;
      return builder;
    },
    then(resolve: (r: { data: unknown[] | null; error: unknown }) => unknown) {
      return Promise.resolve(resolve({ data: error ? null : rows, error }));
    },
  };
  return { db: builder as unknown as ReportContext["db"], calls };
}

describe("rentalCarAnalysisRun", () => {
  it("aggregates per shop×insurer as per-RO averages (days/cycle/cost)", async () => {
    const { db } = rentalDb([
      // PSG Pilot / Gecko: 3 ROs — days avg(10,14,6)=10.0; cost avg=426.67;
      // cycle avg(8,12,5)=8.333->8.3
      rental("PSG Pilot Body Shop", "Gecko Mutual", 10, 420, "2026-04-20", "2026-04-28"),
      rental("PSG Pilot Body Shop", "Gecko Mutual", 14, 602, "2026-04-22", "2026-05-04"),
      rental("PSG Pilot Body Shop", "Gecko Mutual", 6, 258, "2026-05-01", "2026-05-06"),
    ]);
    const out = await rentalCarAnalysisRun(params(), ctx(db));
    expect(out).toEqual([
      {
        shop: "PSG Pilot Body Shop",
        insurer: "Gecko Mutual",
        rentalDays: 10,
        cycleTime: 8.3,
        cost: 426.67,
      },
    ]);
  });

  it("splits rows by insurer within a shop, sorted by shop then insurer", async () => {
    const { db } = rentalDb([
      rental("Anaheim", "Statewide", 12, 500, "2026-03-01", "2026-03-09"),
      rental("Anaheim", "Gecko", 8, 300, "2026-03-02", "2026-03-08"),
    ]);
    const out = await rentalCarAnalysisRun(params(), ctx(db));
    expect(out.map((r) => [r.shop, r.insurer])).toEqual([
      ["Anaheim", "Gecko"],
      ["Anaheim", "Statewide"],
    ]);
  });

  it("keeps rental days/cost when cycle time is missing/partial (cycle null)", async () => {
    const { db } = rentalDb([
      // no dates → cycle null; one-sided date → cycle null; both still count days/cost
      rental("Solo", "Gecko", 5, 200, null, null),
      rental("Solo", "Gecko", 7, 280, "2026-03-01", null),
    ]);
    const out = await rentalCarAnalysisRun(params(), ctx(db));
    expect(out).toEqual([
      { shop: "Solo", insurer: "Gecko", rentalDays: 6, cycleTime: null, cost: 240 },
    ]);
  });

  it("drops a row whose date_out precedes date_in from the cycle sample", async () => {
    const { db } = rentalDb([
      rental("Solo", "Gecko", 4, 100, "2026-03-10", "2026-03-02"), // negative → skipped
      rental("Solo", "Gecko", 4, 100, "2026-03-01", "2026-03-06"), // cycle 5
    ]);
    const out = await rentalCarAnalysisRun(params(), ctx(db));
    expect(out[0].cycleTime).toBe(5);
  });

  it("falls back to '—' for missing shop/insurer names", async () => {
    const { db } = rentalDb([rental(null, null, 9, 360, "2026-03-01", "2026-03-05")]);
    const out = await rentalCarAnalysisRun(params(), ctx(db));
    expect(out[0]).toEqual({
      shop: "—",
      insurer: "—",
      rentalDays: 9,
      cycleTime: 4,
      cost: 360,
    });
  });

  it("filters by shop in JS (case-insensitive) without an ilike on the query", async () => {
    const { db, calls } = rentalDb([
      rental("Anaheim Collision", "Gecko", 10, 400, "2026-03-01", "2026-03-09"),
      rental("Riverside Auto", "Gecko", 20, 900, "2026-03-01", "2026-03-09"),
    ]);
    const out = await rentalCarAnalysisRun(params({ shopId: "anaheim" }), ctx(db));
    expect(calls.table).toBe("rental_assignments");
    expect(out.map((r) => r.shop)).toEqual(["Anaheim Collision"]);
  });

  it("applies the date range to start_date", async () => {
    const { db, calls } = rentalDb([]);
    await rentalCarAnalysisRun(
      params({ start: "2026-03-01", end: "2026-03-31" }),
      ctx(db),
    );
    expect(calls.gte).toBe("2026-03-01");
    expect(calls.lte).toBe("2026-03-31");
  });

  it("coerces numeric-string days/cost", async () => {
    const { db } = rentalDb([
      rental("S", "I", "10", "420.50", "2026-03-01", "2026-03-05"),
    ]);
    const out = await rentalCarAnalysisRun(params(), ctx(db));
    expect(out[0]).toMatchObject({ rentalDays: 10, cost: 420.5 });
  });

  it("throws on a db error (runner degrades to sample)", async () => {
    const { db } = rentalDb([], { message: "boom" });
    await expect(rentalCarAnalysisRun(params(), ctx(db))).rejects.toThrow("boom");
  });

  it("throws without a db context", async () => {
    await expect(rentalCarAnalysisRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});
