import { describe, it, expect } from "vitest";
import { runReport } from "../runner";
import type { ReportContext, ReportDefinition, ReportRow } from "../types";

const sampleRow: ReportRow = { a: 1 };
const liveRow: ReportRow = { a: 2 };

const def = (over: Partial<ReportDefinition> = {}): ReportDefinition => ({
  slug: "t",
  title: "T",
  batch: "volume-invoicing",
  description: "",
  params: { dateRange: true, filters: [] },
  columns: [{ key: "a", label: "A", type: "number" }],
  dataStatus: "pending-data",
  sampleRows: () => [sampleRow],
  ...over,
});

const ctx = (db: ReportContext["db"]): ReportContext => ({
  db,
  shopIds: null,
  generatedAt: "2026-06-18T00:00:00.000Z",
});

const params = { start: null, end: null, filters: {} };

describe("runReport", () => {
  it("serves sample data when dataStatus is pending-data", async () => {
    const r = await runReport(def(), params, ctx(null));
    expect(r.sample).toBe(true);
    expect(r.rows).toEqual([sampleRow]);
    expect(r.generatedAt).toBe("2026-06-18T00:00:00.000Z");
  });

  it("serves sample data when available but no db in context", async () => {
    const r = await runReport(
      def({ dataStatus: "available", run: async () => [liveRow] }),
      params,
      ctx(null),
    );
    expect(r.sample).toBe(true);
    expect(r.rows).toEqual([sampleRow]);
  });

  it("runs live when available + db present", async () => {
    const r = await runReport(
      def({ dataStatus: "available", run: async () => [liveRow] }),
      params,
      ctx({ from: () => ({}) }),
    );
    expect(r.sample).toBe(false);
    expect(r.rows).toEqual([liveRow]);
  });

  it("degrades to sample when a live run throws", async () => {
    const r = await runReport(
      def({
        dataStatus: "available",
        run: async () => {
          throw new Error("boom");
        },
      }),
      params,
      ctx({ from: () => ({}) }),
    );
    expect(r.sample).toBe(true);
    expect(r.rows).toEqual([sampleRow]);
  });
});
