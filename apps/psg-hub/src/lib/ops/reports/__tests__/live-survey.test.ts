import { describe, it, expect } from "vitest";
import { monthlyCsiDisplayRun } from "../live/survey";
import type { ReportContext, ReportParams } from "../types";

type StubRow = {
  shop_name: string | null;
  survey_date: string | null;
  scale_emi_pct: number | string | null;
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
