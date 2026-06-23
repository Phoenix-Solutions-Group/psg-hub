import { describe, it, expect } from "vitest";
import { fetchAllRows, POSTGREST_PAGE_SIZE } from "../live/paginate";

/**
 * A PostgREST-like server stub: holds `total` rows and, per `.range(from, to)`,
 * returns the inclusive slice — but never more than `serverCap` rows, modelling
 * the project `max-rows` ceiling that is the entire reason this helper exists.
 * Records every (from, to) so we can assert the exact paging sequence and that a
 * FRESH builder is requested per page.
 */
function rangeDb(opts: {
  total: number;
  serverCap?: number;
  error?: { message: string };
}) {
  const { total, serverCap = POSTGREST_PAGE_SIZE, error } = opts;
  const ranges: Array<[number, number]> = [];
  let builds = 0;

  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));

  const buildQuery = () => {
    builds += 1;
    return {
      range(from: number, to: number) {
        ranges.push([from, to]);
        if (error) return Promise.resolve({ data: null, error });
        const want = to - from + 1;
        const slice = rows.slice(from, from + Math.min(want, serverCap));
        return Promise.resolve({ data: slice, error: null });
      },
    };
  };

  return { buildQuery, ranges, builds: () => builds };
}

describe("fetchAllRows", () => {
  it("returns every row when the dataset is shorter than one page", async () => {
    const db = rangeDb({ total: 3 });
    const out = await fetchAllRows<{ id: number }>(db.buildQuery);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.id)).toEqual([0, 1, 2]);
    // One short page → exactly one fetch, ranged from 0.
    expect(db.builds()).toBe(1);
    expect(db.ranges).toEqual([[0, 999]]);
  });

  it("returns [] for an empty dataset (single short page)", async () => {
    const db = rangeDb({ total: 0 });
    const out = await fetchAllRows<{ id: number }>(db.buildQuery);
    expect(out).toEqual([]);
    expect(db.builds()).toBe(1);
  });

  it("ACCUMULATES PAST THE 1000-ROW CAP — 2500 rows across three pages", async () => {
    // The core correctness guarantee: a 1000-row server cap must not truncate.
    const db = rangeDb({ total: 2500, serverCap: 1000 });
    const out = await fetchAllRows<{ id: number }>(db.buildQuery);

    expect(out).toHaveLength(2500); // NOT 1000
    expect(out[0].id).toBe(0);
    expect(out[2499].id).toBe(2499);
    // No duplicates / no gaps: ids are 0..2499 in order.
    expect(out.map((r) => r.id)).toEqual(
      Array.from({ length: 2500 }, (_, i) => i),
    );
    // Pages: 1000, 1000, 500(short→stop). Fresh builder per page.
    expect(db.builds()).toBe(3);
    expect(db.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("does one extra (empty) fetch when total is an exact multiple of pageSize", async () => {
    // 2000 rows: page1=1000(full), page2=1000(full) → can't tell we're done, so
    // page3 must run and come back empty to terminate. Still returns 2000.
    const db = rangeDb({ total: 2000, serverCap: 1000 });
    const out = await fetchAllRows<{ id: number }>(db.buildQuery);
    expect(out).toHaveLength(2000);
    expect(db.builds()).toBe(3);
    expect(db.ranges[2]).toEqual([2000, 2999]);
  });

  it("respects a custom pageSize", async () => {
    const db = rangeDb({ total: 250, serverCap: 100 });
    const out = await fetchAllRows<{ id: number }>(db.buildQuery, 100);
    expect(out).toHaveLength(250);
    expect(db.ranges).toEqual([
      [0, 99],
      [100, 199],
      [200, 299],
    ]);
  });

  it("propagates a PostgREST error from the first page", async () => {
    const db = rangeDb({ total: 5000, error: { message: "boom" } });
    await expect(fetchAllRows<{ id: number }>(db.buildQuery)).rejects.toThrow(
      "boom",
    );
    expect(db.builds()).toBe(1); // stops immediately, no further pages
  });

  it("rejects a non-positive or non-integer pageSize", async () => {
    const db = rangeDb({ total: 1 });
    await expect(fetchAllRows(db.buildQuery, 0)).rejects.toThrow(/positive integer/);
    await expect(fetchAllRows(db.buildQuery, -10)).rejects.toThrow(/positive integer/);
    await expect(fetchAllRows(db.buildQuery, 1.5)).rejects.toThrow(/positive integer/);
    expect(db.builds()).toBe(0); // guard fires before any fetch
  });
});
