import { describe, it, expect } from "vitest";
import {
  agentCaptureRun,
  agentSalesRun,
  claimsReviewRun,
  nameRecapByShopRun,
  payTypeAnalysisRun,
  referralDirectoryRun,
  vehicleAnalysisMakeRun,
  vehicleAnalysisModelRun,
} from "../live/customer-insurance";
import type { ReportContext, ReportParams } from "../types";

/**
 * Stub of the Supabase query-builder surface the Customer & Insurance reports
 * use: .from("repair_orders").select().gte().lte().in() then await -> { data,
 * error }. Thenable so `await query` resolves the recorded result; records the
 * filters applied so we can assert the query was shaped correctly.
 */
function stubDb(rows: unknown[], error: { message: string } | null = null) {
  const calls = {
    table: "",
    select: "",
    gte: undefined as string | undefined,
    lte: undefined as string | undefined,
    in: undefined as { col: string; vals: unknown[] } | undefined,
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
    in(col: string, vals: unknown[]) {
      calls.in = { col, vals };
      return builder;
    },
    // PSG-360: fetchRepairOrders now paginates via fetchAllRows, which calls
    // .range(); the builder is thenable and returns its (sub-1000-row) data on
    // the first page, so the loop short-circuits after one page.
    range: () => builder,
    then(resolve: (r: { data: unknown[] | null; error: unknown }) => unknown) {
      return Promise.resolve(resolve({ data: error ? null : rows, error }));
    },
  };
  return { db: builder as unknown as ReportContext["db"], calls };
}

const ctx = (
  db: ReportContext["db"],
  shopIds: string[] | null = null,
): ReportContext => ({ db, shopIds, generatedAt: "2026-06-23T00:00:00.000Z" });

const params = (
  over: Partial<{ start: string; end: string; shopId: string }> = {},
): ReportParams => ({
  start: over.start ?? null,
  end: over.end ?? null,
  filters: over.shopId ? { shopId: over.shopId } : {},
});

/** Build a repair_orders row in the PostgREST embedded-select shape. */
function ro(o: {
  created_at?: string | null;
  totalLoss?: boolean;
  insurer?: string | null;
  agent?: string | null;
  make?: string | null;
  model?: string | null;
  shop?: string | null;
  first?: string | null;
  last?: string | null;
  grandTotal?: number | string | null;
  claim?: string | null;
}) {
  const payload: Record<string, unknown> = {};
  if (o.grandTotal !== undefined) payload["bms.totals.grandTotal"] = o.grandTotal;
  if (o.claim !== undefined) payload["bms.claim.number"] = o.claim;
  return {
    created_at: o.created_at ?? "2026-03-15T12:00:00.000Z",
    total_loss_flag: o.totalLoss ?? false,
    insurance_company_id: o.insurer != null ? "ic-id" : null,
    insurance_agent_id: o.agent != null ? "ia-id" : null,
    payload_jsonb: payload,
    companies: o.shop === undefined ? { name: "Anaheim Collision" } : o.shop === null ? null : { name: o.shop },
    vehicles:
      o.make === undefined && o.model === undefined
        ? null
        : { make: o.make ?? null, model: o.model ?? null },
    insurance_companies: o.insurer != null ? { name: o.insurer } : null,
    insurance_agents: o.agent != null ? { name: o.agent } : null,
    repair_customers:
      o.first === undefined && o.last === undefined
        ? null
        : { first_name: o.first ?? null, last_name: o.last ?? null },
  };
}

describe("payTypeAnalysisRun", () => {
  it("splits Insurance vs Customer Pay, counts ROs, sums $ and computes share", async () => {
    const { db } = stubDb([
      ro({ insurer: "Statewide", grandTotal: 3000 }),
      ro({ insurer: "Statewide", grandTotal: 1000 }),
      ro({ insurer: null, grandTotal: 2000 }),
    ]);
    const out = await payTypeAnalysisRun(params(), ctx(db));
    // Insurance: 2 ROs, $4000 (66.7%); Customer Pay: 1 RO, $2000 (33.3%)
    expect(out).toEqual([
      { payType: "Customer Pay", ros: 1, amount: 2000, share: 33.3 },
      { payType: "Insurance", ros: 2, amount: 4000, share: 66.7 },
    ]);
  });

  it("yields null amount/share when a bucket has no grandTotal", async () => {
    const { db } = stubDb([ro({ insurer: "X" }), ro({ insurer: null })]);
    const out = await payTypeAnalysisRun(params(), ctx(db));
    expect(out).toEqual([
      { payType: "Customer Pay", ros: 1, amount: null, share: null },
      { payType: "Insurance", ros: 1, amount: null, share: null },
    ]);
  });

  it("applies date range and company (shopIds) scope to the query", async () => {
    const { db, calls } = stubDb([]);
    await payTypeAnalysisRun(
      params({ start: "2026-01-01", end: "2026-03-31" }),
      ctx(db, ["c1", "c2"]),
    );
    expect(calls.table).toBe("repair_orders");
    expect(calls.gte).toBe("2026-01-01");
    expect(calls.lte).toBe("2026-03-31T23:59:59.999Z");
    expect(calls.in).toEqual({ col: "company_id", vals: ["c1", "c2"] });
  });

  it("throws without a db context", async () => {
    await expect(payTypeAnalysisRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("vehicleAnalysisMakeRun / vehicleAnalysisModelRun", () => {
  it("groups by make: ROs + avg severity (avg grandTotal), sorted by make", async () => {
    const { db } = stubDb([
      ro({ make: "Toyota", grandTotal: 2000 }),
      ro({ make: "Toyota", grandTotal: 4000 }),
      ro({ make: "Honda", grandTotal: 1500 }),
    ]);
    const out = await vehicleAnalysisMakeRun(params(), ctx(db));
    expect(out).toEqual([
      { make: "Honda", ros: 1, avgSeverity: 1500 },
      { make: "Toyota", ros: 2, avgSeverity: 3000 },
    ]);
  });

  it("groups ROs without a decoded vehicle under '—'", async () => {
    const { db } = stubDb([ro({ grandTotal: 1000 })]);
    const out = await vehicleAnalysisMakeRun(params(), ctx(db));
    expect(out).toEqual([{ make: "—", ros: 1, avgSeverity: 1000 }]);
  });

  it("groups by make+model, sorted by make then model", async () => {
    const { db } = stubDb([
      ro({ make: "Toyota", model: "Camry", grandTotal: 2000 }),
      ro({ make: "Toyota", model: "Corolla", grandTotal: 1000 }),
      ro({ make: "Toyota", model: "Camry", grandTotal: 4000 }),
    ]);
    const out = await vehicleAnalysisModelRun(params(), ctx(db));
    expect(out).toEqual([
      { make: "Toyota", model: "Camry", ros: 2, avgSeverity: 3000 },
      { make: "Toyota", model: "Corolla", ros: 1, avgSeverity: 1000 },
    ]);
  });

  it("avgSeverity null when no grandTotal present for the group", async () => {
    const { db } = stubDb([ro({ make: "Kia" })]);
    const out = await vehicleAnalysisMakeRun(params(), ctx(db));
    expect(out[0]).toEqual({ make: "Kia", ros: 1, avgSeverity: null });
  });

  it("throws without a db context", async () => {
    await expect(vehicleAnalysisModelRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("referralDirectoryRun", () => {
  it("derives category/source from agent/insurer/direct edges", async () => {
    const { db } = stubDb([
      ro({ agent: "Pat Agent", insurer: "Statewide", grandTotal: 5000 }),
      ro({ agent: "Pat Agent", insurer: "Statewide", grandTotal: 1000 }),
      ro({ insurer: "Gecko", grandTotal: 2000 }), // insurer, no agent
      ro({ grandTotal: 800 }), // direct
    ]);
    const out = await referralDirectoryRun(params(), ctx(db));
    expect(out).toEqual([
      { category: "Direct", source: "Direct", ros: 1, amount: 800 },
      { category: "Insurance Agent", source: "Pat Agent", ros: 2, amount: 6000 },
      { category: "Insurance Company", source: "Gecko", ros: 1, amount: 2000 },
    ]);
  });

  it("throws without a db context", async () => {
    await expect(referralDirectoryRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("agentCaptureRun / agentSalesRun", () => {
  it("agent-capture: only agent-referred ROs, count + earliest firstSeen", async () => {
    const { db } = stubDb([
      ro({ agent: "Sam X", insurer: "Statewide", created_at: "2026-02-10T00:00:00Z" }),
      ro({ agent: "Sam X", insurer: "Statewide", created_at: "2026-01-05T00:00:00Z" }),
      ro({ insurer: "Gecko" }), // no agent → excluded
    ]);
    const out = await agentCaptureRun(params(), ctx(db));
    expect(out).toEqual([
      { agent: "Sam X", insurer: "Statewide", ros: 2, firstSeen: "2026-01-05" },
    ]);
  });

  it("agent-sales: Σ grandTotal per agent, ranked by sales desc", async () => {
    const { db } = stubDb([
      ro({ agent: "Low Earner", insurer: "A", grandTotal: 1000 }),
      ro({ agent: "Top Earner", insurer: "B", grandTotal: 9000 }),
      ro({ agent: "Top Earner", insurer: "B", grandTotal: 1000 }),
    ]);
    const out = await agentSalesRun(params(), ctx(db));
    expect(out).toEqual([
      { agent: "Top Earner", insurer: "B", ros: 2, sales: 10000 },
      { agent: "Low Earner", insurer: "A", ros: 1, sales: 1000 },
    ]);
  });

  it("throws without a db context", async () => {
    await expect(agentCaptureRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("claimsReviewRun", () => {
  it("groups by insurer: claims, total-loss count, claim $; supplements null", async () => {
    const { db } = stubDb([
      ro({ insurer: "Statewide", grandTotal: 4000 }),
      ro({ insurer: "Statewide", grandTotal: 2000, totalLoss: true }),
      ro({ insurer: "Gecko", grandTotal: 1000 }),
      ro({ insurer: null, grandTotal: 9000 }), // no insurer → not a claim
    ]);
    const out = await claimsReviewRun(params(), ctx(db));
    expect(out).toEqual([
      { insurer: "Gecko", claims: 1, totalLoss: 0, supplements: null, amount: 1000 },
      { insurer: "Statewide", claims: 2, totalLoss: 1, supplements: null, amount: 6000 },
    ]);
  });

  it("throws without a db context", async () => {
    await expect(claimsReviewRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("nameRecapByShopRun", () => {
  it("groups by shop+customer, counts ROs, sums $, sorted by shop then customer", async () => {
    const { db } = stubDb([
      ro({ shop: "Anaheim", first: "Jane", last: "Doe", grandTotal: 1200 }),
      ro({ shop: "Anaheim", first: "Jane", last: "Doe", grandTotal: 800 }),
      ro({ shop: "Anaheim", first: "Al", last: "Brown", grandTotal: 500 }),
    ]);
    const out = await nameRecapByShopRun(params(), ctx(db));
    expect(out).toEqual([
      { shop: "Anaheim", customer: "Al Brown", ros: 1, amount: 500 },
      { shop: "Anaheim", customer: "Jane Doe", ros: 2, amount: 2000 },
    ]);
  });

  it("only the customer name is output (no address/phone/email PII leak)", async () => {
    const { db } = stubDb([ro({ shop: "S", first: "Jane", last: "Doe", grandTotal: 100 })]);
    const out = await nameRecapByShopRun(params(), ctx(db));
    expect(Object.keys(out[0]).sort()).toEqual(["amount", "customer", "ros", "shop"]);
  });

  it("falls back to '—' for a missing customer name", async () => {
    const { db } = stubDb([ro({ shop: "S", grandTotal: 100 })]);
    const out = await nameRecapByShopRun(params(), ctx(db));
    expect(out[0].customer).toBe("—");
  });

  it("throws without a db context", async () => {
    await expect(nameRecapByShopRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("shared scoping", () => {
  it("applies the shop-name filter case-insensitively in JS (no ilike on query)", async () => {
    const { db } = stubDb([
      ro({ shop: "Anaheim Collision", make: "Toyota", grandTotal: 1000 }),
      ro({ shop: "Riverside Auto", make: "Honda", grandTotal: 2000 }),
    ]);
    const out = await vehicleAnalysisMakeRun(params({ shopId: "anaheim" }), ctx(db));
    expect(out).toEqual([{ make: "Toyota", ros: 1, avgSeverity: 1000 }]);
  });

  it("coerces numeric-string grandTotal", async () => {
    const { db } = stubDb([ro({ make: "T", grandTotal: "1500.5" })]);
    const out = await vehicleAnalysisMakeRun(params(), ctx(db));
    expect(out[0].avgSeverity).toBe(1501); // rounded to whole dollars
  });

  it("propagates a db error so the runner degrades to sample", async () => {
    const { db } = stubDb([], { message: "boom" });
    await expect(payTypeAnalysisRun(params(), ctx(db))).rejects.toThrow("boom");
  });
});

// ───────────────── PSG-360: pagination past the 1000-row cap ─────────────────
//
// Proves fetchRepairOrders (shared by all 8 reports) actually paginates: a
// PostgREST stub that caps each .range() at 1000 rows must NOT truncate a
// >1000-row period. payTypeAnalysisRun stands in for every Customer & Insurance
// run() (they all fetch through the same fetchAllRows path now).

/** Single-table stub honouring .range(from,to) against `total` rows, capped at
 *  the PostgREST default of 1000 per page — exactly what the server does. */
function pagingDb(total: number) {
  let pages = 0;
  // All Customer Pay (no insurer) so the report collapses to a single group
  // whose `ros` count == the number of rows actually fetched.
  const rows = Array.from({ length: total }, () => ({
    created_at: "2026-03-15T12:00:00.000Z",
    total_loss_flag: false,
    insurance_company_id: null,
    insurance_agent_id: null,
    payload_jsonb: null,
    companies: { name: "Mega Collision" },
    vehicles: null,
    insurance_companies: null,
    insurance_agents: null,
    repair_customers: null,
  }));
  const builder: Record<string, unknown> = {
    from: () => builder,
    select: () => builder,
    gte: () => builder,
    lte: () => builder,
    in: () => builder,
    range(from: number, to: number) {
      pages += 1;
      const want = to - from + 1;
      const slice = rows.slice(from, from + Math.min(want, 1000));
      return Promise.resolve({ data: slice, error: null });
    },
  };
  return { db: builder as unknown as ReportContext["db"], pages: () => pages };
}

describe("live run() pagination (PSG-360)", () => {
  it("accumulates >1000 repair_orders instead of truncating at 1000", async () => {
    const db = pagingDb(2300);
    const out = await payTypeAnalysisRun(params(), ctx(db.db));
    // One pay-type group; its RO count proves nothing was lost at the 1000 cap.
    expect(out).toHaveLength(1);
    expect(out[0].ros).toBe(2300);
    expect(db.pages()).toBe(3); // 1000 + 1000 + 300 (short → stop)
  });
});
