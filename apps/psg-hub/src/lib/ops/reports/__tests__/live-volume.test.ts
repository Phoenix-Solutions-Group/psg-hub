import { describe, it, expect } from "vitest";
import { auditRun, reprintRecapRun } from "../live/volume";
import type { ReportContext, ReportParams } from "../types";

/**
 * Minimal thenable stub of the Supabase query-builder surface the volume reports
 * use: .from().select().gte().lte().ilike().in() then await -> { data, error }.
 * Records the filters applied so the query shape can be asserted. Mirrors the
 * stub in live-survey.test.ts (extended with `.in`).
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
    // PSG-360: reprintRecapRun/auditRun now paginate via fetchAllRows, which
    // calls .range(); the builder is thenable and returns its (sub-1000-row)
    // data on the first page, so the loop short-circuits after one page.
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

// A repair_orders row with its company embedded (PostgREST to-one shape).
const ro = (
  over: Partial<{
    ro_number: string | null;
    status: string | null;
    dates_json: Record<string, unknown> | null;
    payload_jsonb: Record<string, unknown> | null;
    created_at: string | null;
    shop: string | null;
  }> = {},
) => ({
  ro_number: over.ro_number ?? "RO-1",
  status: over.status ?? "closed",
  dates_json: over.dates_json ?? {},
  payload_jsonb: over.payload_jsonb ?? {},
  created_at: over.created_at ?? "2026-05-10T00:00:00Z",
  companies: over.shop === undefined ? { name: "Anaheim Collision" } : over.shop === null ? null : { name: over.shop },
});

describe("auditRun", () => {
  it("lists real RO rows: ro/shop/status/date, amount + payType where recorded", async () => {
    const { db } = stubDb([
      ro({
        ro_number: "RO-100",
        status: "closed",
        dates_json: { date_out: "2026-05-12" },
        payload_jsonb: { "bms.totals.grandTotal": 4210.5 },
        shop: "Anaheim Collision",
      }),
      ro({
        ro_number: "RO-101",
        status: "open",
        dates_json: {},
        created_at: "2026-05-08T00:00:00Z",
        payload_jsonb: { advantage2: { payType: "Insurance" } },
        shop: "Riverside Auto Body",
      }),
    ]);
    const rows = await auditRun(params(), ctx(db));
    expect(rows).toEqual([
      // newest date first: RO-100 closed 05-12, then RO-101 created 05-08
      { ro: "RO-100", shop: "Anaheim Collision", payType: "—", amount: 4210.5, status: "Closed", date: "2026-05-12" },
      { ro: "RO-101", shop: "Riverside Auto Body", payType: "Insurance", amount: null, status: "Open", date: "2026-05-08" },
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

  it("blanks amount/payType when the source recorded neither", async () => {
    const { db } = stubDb([ro({ payload_jsonb: { source: "import" } })]);
    const rows = await auditRun(params(), ctx(db));
    expect(rows[0]).toMatchObject({ payType: "—", amount: null });
  });

  it("applies the shop and pay-type filters", async () => {
    const { db } = stubDb([
      ro({ ro_number: "X", shop: "Anaheim", payload_jsonb: { advantage2: { payType: "Insurance" } } }),
      ro({ ro_number: "Y", shop: "Anaheim", payload_jsonb: { advantage2: { payType: "Customer" } } }),
      ro({ ro_number: "Z", shop: "Riverside", payload_jsonb: { advantage2: { payType: "Insurance" } } }),
    ]);
    const rows = await auditRun(params({ shopId: "anaheim", payType: "insurance" }), ctx(db));
    expect(rows.map((r) => r.ro)).toEqual(["X"]);
  });

  it("drops rows with no recorded pay type when the pay-type filter is set", async () => {
    const { db } = stubDb([
      ro({ ro_number: "X", payload_jsonb: {} }),
      ro({ ro_number: "Y", payload_jsonb: { advantage2: { payType: "Warranty" } } }),
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

  it("coerces a numeric-string grand total and rounds to 2dp", async () => {
    const { db } = stubDb([ro({ payload_jsonb: { "bms.totals.grandTotal": "1234.567" } })]);
    const rows = await auditRun(params(), ctx(db));
    expect(rows[0].amount).toBe(1234.57);
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

// ───────────────── PSG-360: pagination past the 1000-row cap ─────────────────
//
// Proves the live run() wiring (not just the helper) paginates: a PostgREST stub
// that caps each .range() at 1000 rows must NOT truncate a >1000-row period.
// auditRun (one output line per RO) stands in for both volume run()s — they both
// fetch through the same fetchAllRows path now.

/** Single-table stub honouring .range(from,to) against `total` rows, capped at
 *  the PostgREST default of 1000 per page — exactly what the server does. */
function pagingDb(total: number) {
  let pages = 0;
  const rows = Array.from({ length: total }, (_, i) => ({
    ro_number: `RO-${i}`,
    status: "closed",
    dates_json: {},
    payload_jsonb: {},
    created_at: "2026-05-10T00:00:00Z",
    companies: { name: "Mega Collision" },
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
  it("auditRun accumulates >1000 repair_orders instead of truncating at 1000", async () => {
    const db = pagingDb(2300);
    const rows = await auditRun(params(), ctx(db.db));
    // One audit line per RO; the count proves nothing was lost at the 1000 cap.
    expect(rows).toHaveLength(2300);
    expect(db.pages()).toBe(3); // 1000 + 1000 + 300 (short → stop)
  });
});
