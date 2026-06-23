import { describe, it, expect } from "vitest";
import {
  auditRun,
  invoicingRecapRun,
  processingRecapRun,
  recapTrailingRun,
  reprintRecapRun,
} from "../live/volume";
import type { ReportContext, ReportParams } from "../types";

/**
 * Minimal thenable stub of the Supabase query-builder surface the volume reports
 * use: .from().select().gte().lte().ilike().in().range() then await -> { data,
 * error }. Records the filters applied so the query shape can be asserted.
 * Mirrors the stub in live-survey.test.ts (extended with `.in` + `.range`).
 *
 * PSG-360/PSG-354: the run()s paginate via fetchAllRows, which calls .range();
 * the builder is thenable and returns its (sub-1000-row) data on the first page,
 * so the loop short-circuits after one page.
 */
function stubDb(rows: unknown[], error: { message: string } | null = null) {
  const calls = {
    table: "",
    select: "",
    gte: undefined as string | undefined,
    lte: undefined as string | undefined,
    ilike: undefined as string | undefined,
    in: undefined as { col: string; vals: string[] } | undefined,
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
    in(col: string, vals: string[]) {
      calls.in = { col, vals };
      return builder;
    },
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
): ReportContext => ({ db, shopIds, generatedAt: "2026-06-18T00:00:00.000Z" });

const params = (
  over: Partial<{
    start: string;
    end: string;
    shopId: string;
    payType: string;
  }> = {},
): ReportParams => ({
  start: over.start ?? null,
  end: over.end ?? null,
  filters: {
    ...(over.shopId ? { shopId: over.shopId } : {}),
    ...(over.payType ? { payType: over.payType } : {}),
  },
});

// A production_reprint_log row with its document → batch / company embedded
// (PostgREST embedded-select shape: production_documents is the to-one parent).
const reprint = (
  shop: string | null,
  batch: string | null,
  reason: string | null,
  reprintedAt: string | null,
  companyId: string | null = "co-1",
) => ({
  reason,
  reprinted_at: reprintedAt,
  production_documents: {
    company_id: companyId,
    companies: shop === null ? null : { name: shop },
    production_batches: batch === null ? null : { name: batch },
  },
});

describe("reprintRecapRun", () => {
  it("groups by shop × batch × reason, counts, keeps the most-recent date", async () => {
    const { db } = stubDb([
      reprint("Anaheim Collision", "BATCH-2200", "Address change", "2026-05-04T10:00:00Z"),
      reprint("Anaheim Collision", "BATCH-2200", "Address change", "2026-05-09T12:00:00Z"),
      reprint("Anaheim Collision", "BATCH-2200", "Damaged", "2026-05-06T08:00:00Z"),
      reprint("Riverside Auto Body", "BATCH-2201", "Mail returned", "2026-05-02T08:00:00Z"),
    ]);
    const rows = await reprintRecapRun(params(), ctx(db));
    expect(rows).toEqual([
      // sorted by shop, then batch, then reason
      { shop: "Anaheim Collision", batch: "BATCH-2200", reason: "Address change", count: 2, date: "2026-05-09" },
      { shop: "Anaheim Collision", batch: "BATCH-2200", reason: "Damaged", count: 1, date: "2026-05-06" },
      { shop: "Riverside Auto Body", batch: "BATCH-2201", reason: "Mail returned", count: 1, date: "2026-05-02" },
    ]);
  });

  it("falls back to '—' for missing shop / batch / reason", async () => {
    const { db } = stubDb([reprint(null, null, null, "2026-05-01T00:00:00Z")]);
    const rows = await reprintRecapRun(params(), ctx(db));
    expect(rows).toEqual([
      { shop: "—", batch: "—", reason: "—", count: 1, date: "2026-05-01" },
    ]);
  });

  it("applies the date range to reprinted_at", async () => {
    const { db, calls } = stubDb([]);
    await reprintRecapRun(params({ start: "2026-05-01", end: "2026-05-31" }), ctx(db));
    expect(calls.table).toBe("production_reprint_log");
    expect(calls.gte).toBe("2026-05-01");
    expect(calls.lte).toBe("2026-05-31T23:59:59.999Z");
  });

  it("filters by shop in JS (case-insensitive substring)", async () => {
    const { db } = stubDb([
      reprint("Anaheim Collision", "B-1", "Reissue", "2026-05-01T00:00:00Z"),
      reprint("Riverside Auto", "B-2", "Reissue", "2026-05-01T00:00:00Z"),
    ]);
    const rows = await reprintRecapRun(params({ shopId: "anaheim" }), ctx(db));
    expect(rows.map((r) => r.shop)).toEqual(["Anaheim Collision"]);
  });

  it("honors ctx.shopIds (company_id allow-list) in JS", async () => {
    const { db } = stubDb([
      reprint("Shop A", "B-1", "Damaged", "2026-05-01T00:00:00Z", "co-1"),
      reprint("Shop B", "B-2", "Damaged", "2026-05-01T00:00:00Z", "co-2"),
    ]);
    const rows = await reprintRecapRun(params(), ctx(db, ["co-1"]));
    expect(rows.map((r) => r.shop)).toEqual(["Shop A"]);
  });

  it("throws on a db error (runner degrades to sample)", async () => {
    const { db } = stubDb([], { message: "boom" });
    await expect(reprintRecapRun(params(), ctx(db))).rejects.toThrow("boom");
  });

  it("throws without a db context", async () => {
    await expect(reprintRecapRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

// A repair_orders row with the canonical PSG-352 columns + embedded company.
const ro = (
  over: Partial<{
    ro_number: string | null;
    status: string | null;
    dates_json: Record<string, unknown> | null;
    repair_amount_cents: number | null;
    pay_type: string | null;
    created_at: string | null;
    shop: string | null;
  }> = {},
) => ({
  ro_number: over.ro_number ?? "RO-1",
  status: over.status ?? "closed",
  dates_json: over.dates_json ?? {},
  repair_amount_cents:
    over.repair_amount_cents === undefined ? null : over.repair_amount_cents,
  pay_type: over.pay_type === undefined ? null : over.pay_type,
  created_at: over.created_at ?? "2026-05-10T00:00:00Z",
  companies:
    over.shop === undefined
      ? { name: "Anaheim Collision" }
      : over.shop === null
        ? null
        : { name: over.shop },
});

describe("auditRun", () => {
  it("lists RO rows from canonical columns: amount = cents/100, payType bucket or '—'", async () => {
    const { db } = stubDb([
      ro({
        ro_number: "RO-100",
        status: "closed",
        dates_json: { date_out: "2026-05-12" },
        repair_amount_cents: 421050,
        pay_type: null,
        shop: "Anaheim Collision",
      }),
      ro({
        ro_number: "RO-101",
        status: "open",
        dates_json: {},
        created_at: "2026-05-08T00:00:00Z",
        repair_amount_cents: null,
        pay_type: "insurance",
        shop: "Riverside Auto Body",
      }),
    ]);
    const rows = await auditRun(params(), ctx(db));
    expect(rows).toEqual([
      // newest date first: RO-100 closed 05-12, then RO-101 created 05-08
      { ro: "RO-100", shop: "Anaheim Collision", payType: "—", amount: 4210.5, status: "Closed", date: "2026-05-12" },
      { ro: "RO-101", shop: "Riverside Auto Body", payType: "insurance", amount: null, status: "Open", date: "2026-05-08" },
    ]);
  });

  it("uses date_out when present, else the created_at day", async () => {
    const { db } = stubDb([
      ro({ ro_number: "A", dates_json: { date_out: "2026-05-20" }, created_at: "2026-05-01T00:00:00Z" }),
      ro({ ro_number: "B", dates_json: {}, created_at: "2026-05-02T09:30:00Z" }),
    ]);
    const rows = await auditRun(params(), ctx(db));
    expect(rows.map((r) => [r.ro, r.date])).toEqual([
      ["A", "2026-05-20"],
      ["B", "2026-05-02"],
    ]);
  });

  it("blanks amount/payType when the canonical columns are null", async () => {
    const { db } = stubDb([ro({ repair_amount_cents: null, pay_type: null })]);
    const rows = await auditRun(params(), ctx(db));
    expect(rows[0]).toMatchObject({ payType: "—", amount: null });
  });

  it("applies the shop and pay-type (canonical bucket) filters", async () => {
    const { db } = stubDb([
      ro({ ro_number: "X", shop: "Anaheim", pay_type: "insurance" }),
      ro({ ro_number: "Y", shop: "Anaheim", pay_type: "customer" }),
      ro({ ro_number: "Z", shop: "Riverside", pay_type: "insurance" }),
    ]);
    const rows = await auditRun(params({ shopId: "anaheim", payType: "insurance" }), ctx(db));
    expect(rows.map((r) => r.ro)).toEqual(["X"]);
  });

  it("drops rows with no recorded pay type when the pay-type filter is set", async () => {
    const { db } = stubDb([
      ro({ ro_number: "X", pay_type: null }),
      ro({ ro_number: "Y", pay_type: "warranty" }),
    ]);
    const rows = await auditRun(params({ payType: "warranty" }), ctx(db));
    expect(rows.map((r) => r.ro)).toEqual(["Y"]);
  });

  it("scopes by created_at and honors ctx.shopIds via .in(company_id)", async () => {
    const { db, calls } = stubDb([]);
    await auditRun(
      params({ start: "2026-05-01", end: "2026-05-31" }),
      ctx(db, ["co-1", "co-2"]),
    );
    expect(calls.table).toBe("repair_orders");
    expect(calls.gte).toBe("2026-05-01");
    expect(calls.lte).toBe("2026-05-31T23:59:59.999Z");
    expect(calls.in).toEqual({ col: "company_id", vals: ["co-1", "co-2"] });
  });

  it("does not constrain company_id when ctx.shopIds is null", async () => {
    const { db, calls } = stubDb([]);
    await auditRun(params(), ctx(db, null));
    expect(calls.in).toBeUndefined();
  });

  it("falls back to '—' for a missing shop name", async () => {
    const { db } = stubDb([ro({ shop: null })]);
    const rows = await auditRun(params(), ctx(db));
    expect(rows[0].shop).toBe("—");
  });

  it("throws on a db error (runner degrades to sample)", async () => {
    const { db } = stubDb([], { message: "boom" });
    await expect(auditRun(params(), ctx(db))).rejects.toThrow("boom");
  });

  it("throws without a db context", async () => {
    await expect(auditRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("processingRecapRun", () => {
  it("per shop: opened (all), closed (status=closed), processed (sum of cents/100)", async () => {
    const { db } = stubDb([
      ro({ status: "closed", repair_amount_cents: 100000, shop: "Anaheim" }),
      ro({ status: "open", repair_amount_cents: 50000, shop: "Anaheim" }),
      ro({ status: "closed", repair_amount_cents: 250000, shop: "Brea" }),
    ]);
    const rows = await processingRecapRun(params(), ctx(db));
    expect(rows).toEqual([
      { shop: "Anaheim", opened: 2, closed: 1, processed: 1500 },
      { shop: "Brea", opened: 1, closed: 1, processed: 2500 },
    ]);
  });

  it("reports processed=null (not $0) when a shop has ROs but no recorded amounts", async () => {
    const { db } = stubDb([
      ro({ status: "open", repair_amount_cents: null, shop: "Solo" }),
      ro({ status: "closed", repair_amount_cents: null, shop: "Solo" }),
    ]);
    const rows = await processingRecapRun(params(), ctx(db));
    expect(rows).toEqual([{ shop: "Solo", opened: 2, closed: 1, processed: null }]);
  });

  it("filters by shop and honors ctx.shopIds + date range", async () => {
    const { db, calls } = stubDb([
      ro({ shop: "Anaheim", repair_amount_cents: 100000 }),
      ro({ shop: "Riverside", repair_amount_cents: 100000 }),
    ]);
    const rows = await processingRecapRun(
      params({ start: "2026-05-01", end: "2026-05-31", shopId: "anaheim" }),
      ctx(db, ["co-1"]),
    );
    expect(calls.table).toBe("repair_orders");
    expect(calls.gte).toBe("2026-05-01");
    expect(calls.lte).toBe("2026-05-31T23:59:59.999Z");
    expect(calls.in).toEqual({ col: "company_id", vals: ["co-1"] });
    expect(rows.map((r) => r.shop)).toEqual(["Anaheim"]);
  });

  it("throws on a db error / without a db context", async () => {
    const e = stubDb([], { message: "boom" });
    await expect(processingRecapRun(params(), ctx(e.db))).rejects.toThrow("boom");
    await expect(processingRecapRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("invoicingRecapRun", () => {
  it("groups by shop × pay_type: invoices, summed amount, avg ticket", async () => {
    const { db } = stubDb([
      ro({ shop: "Anaheim", pay_type: "insurance", repair_amount_cents: 100000 }),
      ro({ shop: "Anaheim", pay_type: "insurance", repair_amount_cents: 200000 }),
      ro({ shop: "Anaheim", pay_type: "customer", repair_amount_cents: 50000 }),
    ]);
    const rows = await invoicingRecapRun(params(), ctx(db));
    expect(rows).toEqual([
      // sorted by shop, then pay type
      { shop: "Anaheim", payType: "customer", invoices: 1, amount: 500, avgTicket: 500 },
      { shop: "Anaheim", payType: "insurance", invoices: 2, amount: 3000, avgTicket: 1500 },
    ]);
  });

  it("buckets unrecorded pay type under '—'; amount/avg null when no known amounts; avg over amount-bearing invoices only", async () => {
    const { db } = stubDb([
      ro({ shop: "Solo", pay_type: null, repair_amount_cents: null }),
      ro({ shop: "Solo", pay_type: null, repair_amount_cents: null }),
      ro({ shop: "Brea", pay_type: "warranty", repair_amount_cents: 80000 }),
      ro({ shop: "Brea", pay_type: "warranty", repair_amount_cents: null }),
    ]);
    const rows = await invoicingRecapRun(params(), ctx(db));
    expect(rows).toEqual([
      // Brea/warranty: 2 invoices but only 1 has an amount → avg over the 1 = 800
      { shop: "Brea", payType: "warranty", invoices: 2, amount: 800, avgTicket: 800 },
      { shop: "Solo", payType: "—", invoices: 2, amount: null, avgTicket: null },
    ]);
  });

  it("honors the pay-type filter (exact bucket)", async () => {
    const { db } = stubDb([
      ro({ shop: "A", pay_type: "insurance", repair_amount_cents: 100000 }),
      ro({ shop: "A", pay_type: "customer", repair_amount_cents: 100000 }),
    ]);
    const rows = await invoicingRecapRun(params({ payType: "insurance" }), ctx(db));
    expect(rows.map((r) => r.payType)).toEqual(["insurance"]);
  });

  it("throws on a db error / without a db context", async () => {
    const e = stubDb([], { message: "boom" });
    await expect(invoicingRecapRun(params(), ctx(e.db))).rejects.toThrow("boom");
    await expect(invoicingRecapRun(params(), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});

describe("recapTrailingRun", () => {
  it("3-month trailing sums per shop anchored on the period end, with MoM %", async () => {
    const { db, calls } = stubDb([
      // anchor end 2026-05 → m2=2026-03, m1=2026-04, current=2026-05
      ro({ shop: "Anaheim", repair_amount_cents: 100000, created_at: "2026-03-10T00:00:00Z" }),
      ro({ shop: "Anaheim", repair_amount_cents: 200000, created_at: "2026-04-15T00:00:00Z" }),
      ro({ shop: "Anaheim", repair_amount_cents: 300000, created_at: "2026-05-20T00:00:00Z" }),
    ]);
    const rows = await recapTrailingRun(params({ start: "2026-01-01", end: "2026-05-31" }), ctx(db));
    // query window is the report's own 3-month span, not params.start
    expect(calls.gte).toBe("2026-03-01");
    expect(calls.lte).toBe("2026-05-31T23:59:59.999Z");
    expect(rows).toEqual([
      // m2=1000, m1=2000, current=3000 → trend (3000-2000)/2000=50%
      { shop: "Anaheim", m2: 1000, m1: 2000, current: 3000, trend: 50 },
    ]);
  });

  it("null cell for an empty shop-month; null trend when last month is null", async () => {
    const { db } = stubDb([
      // only current month has data
      ro({ shop: "Solo", repair_amount_cents: 300000, created_at: "2026-05-05T00:00:00Z" }),
    ]);
    const rows = await recapTrailingRun(params({ end: "2026-05-31" }), ctx(db));
    expect(rows).toEqual([
      { shop: "Solo", m2: null, m1: null, current: 3000, trend: null },
    ]);
  });

  it("anchors on start when end is absent, and crosses a year boundary", async () => {
    const { db, calls } = stubDb([]);
    await recapTrailingRun(params({ start: "2026-01-31" }), ctx(db));
    // current=2026-01 → m2=2025-11
    expect(calls.gte).toBe("2025-11-01");
    expect(calls.lte).toBe("2026-01-31T23:59:59.999Z");
  });

  it("returns no rows when neither end nor start is a usable date", async () => {
    const { db } = stubDb([ro({ shop: "X", repair_amount_cents: 100000 })]);
    const rows = await recapTrailingRun(params(), ctx(db));
    expect(rows).toEqual([]);
  });

  it("honors ctx.shopIds via .in(company_id)", async () => {
    const { db, calls } = stubDb([]);
    await recapTrailingRun(params({ end: "2026-05-31" }), ctx(db, ["co-9"]));
    expect(calls.in).toEqual({ col: "company_id", vals: ["co-9"] });
  });

  it("throws on a db error / without a db context", async () => {
    const e = stubDb([], { message: "boom" });
    await expect(recapTrailingRun(params({ end: "2026-05-31" }), ctx(e.db))).rejects.toThrow("boom");
    await expect(recapTrailingRun(params({ end: "2026-05-31" }), ctx(null))).rejects.toThrow(
      /requires a db context/,
    );
  });
});
