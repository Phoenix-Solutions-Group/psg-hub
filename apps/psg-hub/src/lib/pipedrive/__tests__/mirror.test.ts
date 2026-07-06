import { describe, it, expect } from "vitest";
import {
  readMirrorDeals,
  buildDealsExportFromMirror,
  type MirrorDealRow,
  type MirrorSupabase,
} from "../mirror";
import type { PipedriveDeal } from "../types";

function deal(p: Partial<PipedriveDeal>): PipedriveDeal {
  return {
    dealId: p.dealId ?? 1,
    title: p.title ?? "deal",
    value: p.value ?? 0,
    currency: p.currency ?? "USD",
    status: p.status ?? "open",
    pipelineId: p.pipelineId ?? 1,
    stageId: p.stageId ?? 1,
    stageName: p.stageName ?? "S1",
    winProbability: p.winProbability ?? null,
    orgId: p.orgId ?? null,
    orgName: p.orgName ?? null,
    personId: p.personId ?? null,
    ownerId: p.ownerId ?? null,
    ownerName: p.ownerName ?? null,
    expectedCloseDate: p.expectedCloseDate ?? null,
    closeDate: p.closeDate ?? null,
    lastActivityDate: p.lastActivityDate ?? null,
    revenueType: p.revenueType,
    monthlyValue: p.monthlyValue,
    customFields: p.customFields,
  };
}

/** A fake mirror DB whose `.from(table).select(cols)` returns the seeded rows (or error). */
function fakeMirror(
  rows: MirrorDealRow[],
  error?: { message: string },
): { db: MirrorSupabase; calls: { table: string; columns: string }[] } {
  const calls: { table: string; columns: string }[] = [];
  const db: MirrorSupabase = {
    from: (table: string) => ({
      async select(columns: string) {
        calls.push({ table, columns });
        return { data: error ? null : rows, error: error ?? null };
      },
    }),
  };
  return { db, calls };
}

/** A mirror row as the sync writes it: `raw` is the full deal payload (jsonb). */
function mirrorRow(d: PipedriveDeal): MirrorDealRow {
  return { deal_id: d.dealId, raw: d };
}

const ASOF = new Date("2026-06-30T12:00:00.000Z");

describe("readMirrorDeals", () => {
  it("reads the mirror table for `raw` and reconstructs deals from row.raw", async () => {
    const d = deal({ dealId: 7, title: "Acme" });
    const { db, calls } = fakeMirror([mirrorRow(d)]);

    const deals = await readMirrorDeals(db);

    expect(calls).toEqual([{ table: "pipedrive_deals", columns: "deal_id, raw" }]);
    expect(deals).toHaveLength(1);
    // Identity, not a rebuild: we hand back the jsonb payload verbatim.
    expect(deals[0]).toBe(d);
  });

  it("skips rows whose `raw` is null (can't reconstruct without lossy guesswork)", async () => {
    const good = deal({ dealId: 1 });
    const { db } = fakeMirror([
      mirrorRow(good),
      { deal_id: 2, raw: null },
    ]);
    const deals = await readMirrorDeals(db);
    expect(deals.map((x) => x.dealId)).toEqual([1]);
  });

  it("throws with a clear message on a DB/RLS error", async () => {
    const { db } = fakeMirror([], { message: "permission denied for table pipedrive_deals" });
    await expect(readMirrorDeals(db)).rejects.toThrow(/mirror read failed: permission denied/);
  });

  it("returns [] when the mirror is empty", async () => {
    const { db } = fakeMirror([]);
    await expect(readMirrorDeals(db)).resolves.toEqual([]);
  });
});

describe("buildDealsExportFromMirror — Tess's round-trip assert (PSG-447)", () => {
  it("a recurring won deal's monthlyValue AND revenue_type survive the mirror read intact (not null)", async () => {
    // Fixture mirror row for a RECURRING won deal closed inside the default 90d window.
    // monthlyValue is a NON-promoted field — it lives only inside `raw`, so a column
    // rebuild would null it. revenue_type is promoted but must also round-trip.
    const recurring = deal({
      dealId: 42,
      title: "Subscription — Body Shop SaaS",
      value: 12000, // face $ (annual contract)
      status: "won",
      closeDate: "2026-06-15",
      revenueType: "recurring",
      monthlyValue: 1000, // 12000/12 — the normalized monthly MRR basis John nets
    });
    const { db } = fakeMirror([mirrorRow(recurring)]);

    const exp = await buildDealsExportFromMirror(db, { asOf: ASOF });

    expect(exp.wonBooked).toHaveLength(1);
    const row = exp.wonBooked[0]!;
    // Both fields survived the read path — the core guard against the column-rebuild trap.
    expect(row.revenueType).toBe("recurring");
    expect(row.monthlyValue).toBe(1000);
    expect(row.monthlyValue).not.toBeNull();
    // …and it actually feeds John's §2.1 netting total, not just the row.
    expect(exp.wonBookedRecurringMonthlyTotal).toBe(1000);
    expect(exp.wonBookedRecurringMonthlyNullCount).toBe(0);
    expect(exp.wonBookedByType.recurring).toBe(12000);
  });

  it("passes export options through (e.g. open deals build the forecast)", async () => {
    const open = deal({ dealId: 1, status: "open", value: 5000, stageId: 6, winProbability: 80 });
    const { db } = fakeMirror([mirrorRow(open)]);

    const exp = await buildDealsExportFromMirror(db, { asOf: ASOF });

    expect(exp.forecast.openDealCount).toBe(1);
    expect(exp.forecast.bestCaseValue).toBe(5000);
    expect(exp.openDeals).toHaveLength(1);
  });
});
