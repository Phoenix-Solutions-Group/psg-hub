import { describe, it, expect, vi, beforeEach } from "vitest";

// The router is mocked to throw (no enabled provider) so the metered content-gap / cluster
// seams degrade to null and the whole run is deterministic — exactly the pre-G5 posture. The
// audit writer is mocked so the suite asserts the audit CALL without a DB.
vi.mock("@/lib/intel/router", () => ({
  route: vi.fn(async () => {
    throw new Error("NoEnabledProvider (test)");
  }),
}));
const auditMock = vi.fn(async (e: unknown) => {
  void e;
  return "audit-1";
});
vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: (e: unknown) => auditMock(e),
}));

import { runSitemap } from "../run";
import type { CheckpointStore, CheckpointRecord } from "../checkpoint";

const SHOP = "11111111-2222-4333-8444-555555555555";

/* ----------------------- service-client mock --------------------------- */
// Minimal chainable supabase stub covering exactly the reads/writes runSitemap makes:
// shops.select.eq.maybeSingle, competitors.select.eq, research_artifacts.insert.select.single.
function makeService(opts: { shop: Record<string, unknown> | null; competitors: { name: string | null }[] }) {
  const inserted: Record<string, unknown>[] = [];
  const service = {
    inserted,
    from(table: string) {
      if (table === "shops") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.shop, error: null }) }) }),
        };
      }
      if (table === "competitors") {
        return { select: () => ({ eq: async () => ({ data: opts.competitors, error: null }) }) };
      }
      if (table === "research_artifacts") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return {
              select: () => ({
                single: async () => ({ data: { id: "art-1", created_at: "2026-06-23T12:00:00Z" }, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return service as unknown as Parameters<typeof runSitemap>[0]["service"] & { inserted: Record<string, unknown>[] };
}

/* ----------------------- in-memory checkpoint store -------------------- */
function memStore(): CheckpointStore & { records: CheckpointRecord[] } {
  const records: CheckpointRecord[] = [];
  const k = (s: string, p: string, h: string) => `${s}|${p}|${h}`;
  return {
    records,
    async get(shopId, phase, contentHash) {
      return records.find((r) => k(r.shop_id, r.phase, r.content_hash) === k(shopId, phase, contentHash)) ?? null;
    },
    async upsertPending(rec) {
      const existing = await this.get(rec.shop_id, rec.phase, rec.content_hash);
      if (existing) return existing;
      const stored = { ...rec, id: `cp-${records.length + 1}` };
      records.push(stored);
      return stored;
    },
  };
}

const SHOP_ROW = {
  id: SHOP,
  name: "Demo Body Shop",
  url: null,
  address_locality: "Omaha",
  address_region: "NE",
};

beforeEach(() => auditMock.mockClear());

describe("runSitemap — gated end-to-end", () => {
  it("returns no_shop when the shop is absent (no audit, no spend)", async () => {
    const service = makeService({ shop: null, competitors: [] });
    const out = await runSitemap({ service, shopId: SHOP, userId: "super-1", checkpointStore: memStore() });
    expect(out.status).toBe("no_shop");
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("queues checkpoint 1 on the first run, then advances through both gates to complete", async () => {
    const service = makeService({ shop: SHOP_ROW, competitors: [{ name: "Rival Auto Body" }] });
    const store = memStore();
    const base = { service, shopId: SHOP, userId: "super-1", now: "2026-06-23T12:00:00.000Z", checkpointStore: store } as const;

    // Run 1 — stops at clusters gate, queued for sign-off.
    const r1 = await runSitemap({ ...base });
    expect(r1.status).toBe("awaiting_approval");
    if (r1.status !== "awaiting_approval") throw new Error("unreachable");
    expect(r1.stop.phase).toBe("clusters_page_types");
    expect(store.records).toHaveLength(1);
    expect(auditMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "sitemap.run", targetShopId: SHOP, payload: expect.objectContaining({ outcome: "awaiting_approval" }) }),
    );

    // Superadmin approves clusters gate.
    store.records[0].status = "approved";
    store.records[0].decided_by_name = "Boss";
    store.records[0].decided_at = "2026-06-23T12:30:00.000Z";

    // Run 2 — clusters approved → advances, stops at package gate.
    const r2 = await runSitemap({ ...base });
    expect(r2.status).toBe("awaiting_approval");
    if (r2.status !== "awaiting_approval") throw new Error("unreachable");
    expect(r2.stop.phase).toBe("package_handoff");
    expect(store.records).toHaveLength(2);

    // Approve the package gate.
    const pkgRow = store.records.find((r) => r.phase === "package_handoff")!;
    pkgRow.status = "approved";
    pkgRow.decided_by_name = "Boss";
    pkgRow.decided_at = "2026-06-23T12:45:00.000Z";

    // Run 3 — both approved → completes, persists, audits.
    const r3 = await runSitemap({ ...base });
    expect(r3.status).toBe("complete");
    if (r3.status !== "complete") throw new Error("unreachable");
    expect(r3.persisted.id).toBe("art-1");
    expect(service.inserted).toHaveLength(1);
    expect(service.inserted[0].artifact_type).toBe("sitemap_package");
    expect(auditMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ outcome: "complete", artifactId: "art-1" }) }),
    );
  });

  it("reports changes_requested when a human rejected the clusters gate", async () => {
    const service = makeService({ shop: SHOP_ROW, competitors: [] });
    const store = memStore();
    const base = { service, shopId: SHOP, userId: "super-1", now: "2026-06-23T12:00:00.000Z", checkpointStore: store } as const;

    // Run once to populate the pending row, then flip it to changes_requested.
    await runSitemap({ ...base });
    store.records[0].status = "changes_requested";
    store.records[0].notes = "split the service cluster";

    const out = await runSitemap({ ...base });
    expect(out.status).toBe("changes_requested");
    if (out.status !== "changes_requested") throw new Error("unreachable");
    expect(out.stop.approval.notes).toBe("split the service cluster");
    expect(service.inserted).toHaveLength(0); // nothing persisted on a rejected run
  });
});
