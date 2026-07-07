import { describe, it, expect, vi } from "vitest";
import { syncPipedriveDeals, toDealRow, type SyncSupabase } from "../sync";
import type { PipedriveClient } from "../client";
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
  };
}

interface UpsertCall {
  table: string;
  rows: Record<string, unknown>[];
  opts?: { onConflict?: string };
}
interface InsertCall {
  table: string;
  rows: Record<string, unknown>[];
}

/** A fake service-role client that records upsert/insert calls; optional forced error. */
function fakeService(upsertError?: { message: string }) {
  const upserts: UpsertCall[] = [];
  const inserts: InsertCall[] = [];
  const service: SyncSupabase = {
    from: (table: string) => ({
      async upsert(rows: Record<string, unknown>[], opts?: { onConflict?: string }) {
        upserts.push({ table, rows, opts });
        return { error: upsertError ?? null };
      },
      async insert(rows: Record<string, unknown>[]) {
        inserts.push({ table, rows });
        return { error: null };
      },
    }),
  };
  return { service, upserts, inserts };
}

function fakeClient(open: PipedriveDeal[], closed: PipedriveDeal[] = []): PipedriveClient {
  return {
    fetchOpenDeals: vi.fn(async () => open),
    fetchDealsByStatus: vi.fn(async () => closed),
    fetchStages: vi.fn(async () => []),
  };
}

const NOW = () => new Date("2026-06-30T12:00:00.000Z");

describe("toDealRow", () => {
  it("maps to the snake_case mirror columns incl. owner + activity + raw", () => {
    const r = toDealRow(
      deal({ dealId: 9, value: 5000, ownerId: 3, ownerName: "Rep", lastActivityDate: "2026-06-20" }),
      "2026-06-30T12:00:00.000Z",
    );
    expect(r).toMatchObject({
      deal_id: 9,
      value: 5000,
      owner_id: 3,
      owner_name: "Rep",
      last_activity_date: "2026-06-20",
      synced_at: "2026-06-30T12:00:00.000Z",
    });
    expect(r.raw).toBeTruthy();
  });
});

describe("syncPipedriveDeals", () => {
  it("upserts open deals on the deal_id conflict key and logs ok=true with counts", async () => {
    const { service, upserts, inserts } = fakeService();
    const client = fakeClient([deal({ dealId: 1 }), deal({ dealId: 2 })]);

    const result = await syncPipedriveDeals({ client, service, now: NOW });

    expect(result).toEqual({ ok: true, openDeals: 2, totalDeals: 2, error: undefined });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.table).toBe("pipedrive_deals");
    expect(upserts[0]!.rows).toHaveLength(2);
    expect(upserts[0]!.opts).toEqual({ onConflict: "deal_id" });
    expect(inserts[0]!.table).toBe("pipedrive_sync_runs");
    expect(inserts[0]!.rows[0]).toMatchObject({ ok: true, open_deals: 2, total_deals: 2, error: null });
  });

  it("de-dupes a deal that appears in both open and closed pulls (last wins)", async () => {
    const { service, upserts } = fakeService();
    const client = fakeClient([deal({ dealId: 1, status: "open" })], [deal({ dealId: 1, status: "won" })]);

    const result = await syncPipedriveDeals({
      client,
      service,
      now: NOW,
      closedUpdatedSince: "2025-07-01",
    });

    expect(result.openDeals).toBe(1);
    expect(result.totalDeals).toBe(1); // de-duped
    expect(upserts[0]!.rows).toHaveLength(1);
    expect(upserts[0]!.rows[0]!.status).toBe("won"); // last (closed) wins
  });

  it("logs ok=true,0 and skips the upsert when there are no deals (idempotent no-op)", async () => {
    const { service, upserts, inserts } = fakeService();
    const client = fakeClient([]);
    const result = await syncPipedriveDeals({ client, service, now: NOW });
    expect(result).toEqual({ ok: true, openDeals: 0, totalDeals: 0, error: undefined });
    expect(upserts).toHaveLength(0);
    expect(inserts[0]!.rows[0]).toMatchObject({ ok: true, open_deals: 0 });
  });

  it("captures a fetch failure as ok=false and still writes a run-log row", async () => {
    const { service, inserts } = fakeService();
    const client: PipedriveClient = {
      fetchOpenDeals: vi.fn(async () => {
        throw new Error("Pipedrive /deals returned HTTP 500");
      }),
      fetchDealsByStatus: vi.fn(async () => []),
      fetchStages: vi.fn(async () => []),
    };
    const result = await syncPipedriveDeals({ client, service, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("HTTP 500");
    expect(inserts[0]!.rows[0]).toMatchObject({ ok: false });
  });

  it("captures an upsert DB error as ok=false", async () => {
    const { service } = fakeService({ message: "RLS denied" });
    const client = fakeClient([deal({ dealId: 1 })]);
    const result = await syncPipedriveDeals({ client, service, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("RLS denied");
  });
});
