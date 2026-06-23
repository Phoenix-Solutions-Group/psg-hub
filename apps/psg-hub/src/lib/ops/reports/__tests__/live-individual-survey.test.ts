import { describe, it, expect } from "vitest";
import {
  hotSpotRun,
  misFireRun,
  perfectScoreRun,
  referralComparisonRun,
  referralNotedRun,
} from "../live/individual-survey";
import type { ReportContext, ReportParams } from "../types";

/**
 * Single-table stub of the Supabase query-builder surface these reports use:
 * .from().select().gte().lte().ilike() then await -> { data, error }. The builder
 * is thenable and `.range()` returns itself (so fetchAllRows' first page returns
 * the full (sub-1000-row) stub set and the pagination loop short-circuits).
 * Records the cols selected + filters so query shape can be asserted.
 */
function stubDb(rows: unknown[], error: { message: string } | null = null) {
  const calls = {
    table: "",
    select: "",
    gte: [] as string[],
    lte: [] as string[],
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
    gte(_c: string, v: string) {
      calls.gte.push(v);
      return builder;
    },
    lte(_c: string, v: string) {
      calls.lte.push(v);
      return builder;
    },
    ilike(_c: string, v: string) {
      calls.ilike = v;
      return builder;
    },
    range() {
      return builder;
    },
    then(resolve: (r: { data: unknown[] | null; error: unknown }) => unknown) {
      return Promise.resolve(resolve({ data: error ? null : rows, error }));
    },
  };
  return { db: builder as unknown as ReportContext["db"], calls };
}

const ctx = (db: ReportContext["db"]): ReportContext => ({
  db,
  shopIds: null,
  generatedAt: "2026-06-23T00:00:00.000Z",
});
const params = (over: Partial<ReportParams> = {}): ReportParams => ({
  start: "2026-05-01",
  end: "2026-05-31",
  filters: {},
  ...over,
});

/** Build an embedded RO with optional agent / insurer / customer / estimator. */
function ro(opts: {
  agent?: string;
  insurer?: string;
  customer?: [string, string];
  estimator?: string;
}) {
  return {
    insurance_agents: opts.agent ? { name: opts.agent } : null,
    insurance_companies: opts.insurer ? { name: opts.insurer } : null,
    repair_customers: opts.customer
      ? { first_name: opts.customer[0], last_name: opts.customer[1] }
      : null,
    repair_order_employees: opts.estimator
      ? [{ role: "estimator", employees: { name: opts.estimator } }]
      : [],
  };
}

describe("perfectScoreRun", () => {
  it("keeps only 100%-EMI surveys, resolves customer + estimator, newest first", async () => {
    const { db } = stubDb([
      {
        shop_name: "Acme",
        survey_date: "2026-05-04",
        scale_emi_pct: 1.0,
        ro_number: "RO-1",
        repair_orders: ro({ customer: ["Ada", "Lovelace"], estimator: "Pat" }),
      },
      // 99% — not perfect, excluded
      {
        shop_name: "Acme",
        survey_date: "2026-05-10",
        scale_emi_pct: 0.99,
        ro_number: "RO-2",
        repair_orders: ro({ customer: ["Bo", "Diddley"] }),
      },
      // perfect but later date → sorts first
      {
        shop_name: "Beta",
        survey_date: "2026-05-20",
        scale_emi_pct: 1.0,
        ro_number: "RO-3",
        repair_orders: null,
      },
      // null score → excluded
      {
        shop_name: "Acme",
        survey_date: "2026-05-22",
        scale_emi_pct: null,
        ro_number: "RO-4",
        repair_orders: null,
      },
    ]);

    const rows = await perfectScoreRun(params(), ctx(db));
    expect(rows.map((r) => r.ro)).toEqual(["RO-3", "RO-1"]);
    expect(rows[1]).toEqual({
      ro: "RO-1",
      shop: "Acme",
      customer: "Ada Lovelace",
      estimator: "Pat",
      date: "2026-05-04",
    });
    // No RO link → name + estimator gracefully degrade to "—" (never invented).
    expect(rows[0].customer).toBe("—");
    expect(rows[0].estimator).toBe("—");
  });

  it("throws without a db context", async () => {
    await expect(perfectScoreRun(params(), ctx(null))).rejects.toThrow();
  });
});

describe("misFireRun", () => {
  it("flags high overall (≥88%) masking a sub-score below 8.8, severest first", async () => {
    const { db } = stubDb([
      // high overall, courtesy low → mis-fire
      {
        shop_name: "Acme",
        survey_date: "2026-05-04",
        scale_emi_pct: 0.95,
        q05_01: 9.5,
        q05_02: 9.4,
        q05_03: 9.6,
        q05_04: 6.2,
        ro_number: "RO-1",
        repair_orders: null,
      },
      // high overall, communication lower → mis-fire, sorts first (more severe)
      {
        shop_name: "Beta",
        survey_date: "2026-05-05",
        scale_emi_pct: 0.9,
        q05_01: 9.0,
        q05_02: 9.1,
        q05_03: 4.0,
        q05_04: 9.0,
        ro_number: "RO-2",
        repair_orders: null,
      },
      // high overall but all subs ≥ 8.8 → not a mis-fire
      {
        shop_name: "Acme",
        survey_date: "2026-05-06",
        scale_emi_pct: 0.97,
        q05_01: 9.7,
        q05_02: 9.6,
        q05_03: 9.8,
        q05_04: 9.9,
        ro_number: "RO-3",
        repair_orders: null,
      },
      // low overall (<88%) → excluded even though a sub is low
      {
        shop_name: "Acme",
        survey_date: "2026-05-07",
        scale_emi_pct: 0.7,
        q05_01: 3.0,
        q05_02: 9.0,
        q05_03: 9.0,
        q05_04: 9.0,
        ro_number: "RO-4",
        repair_orders: null,
      },
    ]);

    const rows = await misFireRun(params(), ctx(db));
    expect(rows.map((r) => r.ro)).toEqual(["RO-2", "RO-1"]);
    expect(rows[0]).toEqual({
      ro: "RO-2",
      shop: "Beta",
      overall: 90,
      lowSub: "Communication",
      subScore: 4,
    });
    expect(rows[1].lowSub).toBe("Courtesy");
    expect(rows[1].subScore).toBe(6.2);
  });
});

describe("hotSpotRun", () => {
  it("clusters below-8.8 sub-scores into shop × theme, hottest first", async () => {
    const { db } = stubDb([
      {
        shop_name: "Acme",
        survey_date: "2026-05-04",
        q05_01: 5.0,
        q05_02: 9.0,
        q05_03: 9.0,
        q05_04: 9.0,
      },
      {
        shop_name: "Acme",
        survey_date: "2026-05-05",
        q05_01: 6.0,
        q05_02: 9.0,
        q05_03: 9.0,
        q05_04: 9.0,
      },
      // single Cleanliness hit at Acme
      {
        shop_name: "Acme",
        survey_date: "2026-05-06",
        q05_01: 9.0,
        q05_02: 4.0,
        q05_03: 9.0,
        q05_04: 9.0,
      },
      // all clean → contributes nothing
      {
        shop_name: "Beta",
        survey_date: "2026-05-07",
        q05_01: 9.9,
        q05_02: 9.9,
        q05_03: 9.9,
        q05_04: 9.9,
      },
    ]);

    const rows = await hotSpotRun(params(), ctx(db));
    expect(rows[0]).toEqual({
      shop: "Acme",
      theme: "Quality",
      count: 2,
      avgScore: 5.5,
    });
    expect(rows).toContainEqual({
      shop: "Acme",
      theme: "Cleanliness",
      count: 1,
      avgScore: 4,
    });
    // Beta had no negative mentions → no row.
    expect(rows.some((r) => r.shop === "Beta")).toBe(false);
  });
});

describe("referralNotedRun", () => {
  it("notes agent/insurer-edged surveys, excludes Direct, sorted by category then customer", async () => {
    const { db } = stubDb([
      {
        shop_name: "Acme",
        survey_date: "2026-05-04",
        ro_number: "RO-1",
        repair_orders: ro({ insurer: "Statewide", customer: ["Zoe", "Z"] }),
      },
      {
        shop_name: "Acme",
        survey_date: "2026-05-05",
        ro_number: "RO-2",
        repair_orders: ro({ agent: "Jane Agent", customer: ["Al", "A"] }),
      },
      // no edge → Direct → excluded
      {
        shop_name: "Acme",
        survey_date: "2026-05-06",
        ro_number: "RO-3",
        repair_orders: ro({ customer: ["No", "Edge"] }),
      },
    ]);

    const rows = await referralNotedRun(params(), ctx(db));
    expect(rows).toEqual([
      { ro: "RO-2", customer: "Al A", category: "Insurance Agent", source: "Jane Agent" },
      { ro: "RO-1", customer: "Zoe Z", category: "Insurance Company", source: "Statewide" },
    ]);
  });
});

describe("referralComparisonRun", () => {
  it("compares current vs. the prior equal-length window by derived category", async () => {
    // Current window 2026-05-01..05-31 (31d) → prior window 2026-03-31..04-30.
    const { db, calls } = stubDb([
      // current: 2 Insurance Company
      { shop_name: "A", survey_date: "2026-05-04", ro_number: "C1", repair_orders: ro({ insurer: "S" }) },
      { shop_name: "A", survey_date: "2026-05-10", ro_number: "C2", repair_orders: ro({ insurer: "S" }) },
      // current: 1 Direct
      { shop_name: "A", survey_date: "2026-05-12", ro_number: "C3", repair_orders: null },
      // prior: 1 Insurance Company
      { shop_name: "A", survey_date: "2026-04-15", ro_number: "P1", repair_orders: ro({ insurer: "S" }) },
    ]);

    const rows = await referralComparisonRun(params(), ctx(db));
    // The fetch reaches back to the prior window start, not just current start.
    expect(calls.gte[0]).toBe("2026-03-31");
    expect(calls.lte[0]).toBe("2026-05-31");

    const insco = rows.find((r) => r.category === "Insurance Company");
    expect(insco).toEqual({
      category: "Insurance Company",
      prior: 1,
      current: 2,
      delta: 100, // (2-1)/1 ×100
    });
    const direct = rows.find((r) => r.category === "Direct");
    expect(direct).toEqual({
      category: "Direct",
      prior: 0,
      current: 1,
      delta: null, // prior 0 → no % change
    });
  });

  it("counts everything as current when no date range is given", async () => {
    const { db } = stubDb([
      { shop_name: "A", survey_date: "2026-05-04", ro_number: "C1", repair_orders: ro({ agent: "J" }) },
      { shop_name: "A", survey_date: "2026-05-10", ro_number: "C2", repair_orders: null },
    ]);
    const rows = await referralComparisonRun(
      params({ start: null, end: null }),
      ctx(db),
    );
    expect(rows.find((r) => r.category === "Insurance Agent")).toEqual({
      category: "Insurance Agent",
      prior: 0,
      current: 1,
      delta: null,
    });
  });
});
