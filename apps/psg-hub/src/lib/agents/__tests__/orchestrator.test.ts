import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ApprovalQueueRow,
  ApprovalQueueStore,
  ApprovalStatus,
  PublisherRegistry,
} from "@/lib/ops/approval-queue";
import {
  DEFAULT_ORCHESTRATOR_SPEND_CAP_USD,
  ORCHESTRATOR_PROPOSED_BY,
  defaultDraftGenerator,
  defaultOrchestratorPublishers,
  isoWeekStamp,
  publishApprovedRow,
  recordingPublisher,
  runDraftGeneration,
  runPublishApproved,
  type DraftGenerator,
} from "../orchestrator";

/* ------------------------------- test doubles ----------------------------- */

/** In-memory ApprovalQueueStore — the same surface the supabase store implements. */
function makeFakeStore(seed: ApprovalQueueRow[] = []): ApprovalQueueStore & { rows: ApprovalQueueRow[] } {
  let n = 0;
  const rows: ApprovalQueueRow[] = seed.map((r) => ({ ...r }));
  return {
    rows,
    async insert(row) {
      const stored = { ...row, id: row.id ?? `id-${++n}` };
      rows.push(stored);
      return { ...stored };
    },
    async get(id) {
      const found = rows.find((r) => r.id === id);
      return found ? { ...found } : null;
    },
    async update(id, patch) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) throw new Error(`no row ${id}`);
      rows[idx] = { ...rows[idx], ...patch };
      return { ...rows[idx] };
    },
    async listByShop(shopId, statuses?: ApprovalStatus[]) {
      return rows
        .filter((r) => r.shop_id === shopId)
        .filter((r) => !statuses || statuses.includes(r.status))
        .map((r) => ({ ...r }));
    },
  };
}

/** A fake service whose only used surface is `.from("shops").select(...)`. */
function fakeService(shops: { id: string; url: string | null }[]): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "shops") throw new Error(`unexpected table ${table}`);
      return { select: async () => ({ data: shops, error: null }) };
    },
  } as unknown as SupabaseClient;
}

const NOW = "2026-06-23T12:00:00.000Z";
const UNDER = async () => 1; // $1 spent — well under any cap
const OVER = async () => 9_999; // way over any cap

function pendingRow(over: Partial<ApprovalQueueRow> = {}): ApprovalQueueRow {
  return {
    id: over.id ?? "p1",
    shop_id: over.shop_id ?? "shop-a",
    action_type: over.action_type ?? "gbp_post",
    title: over.title ?? "T",
    summary: null,
    payload_jsonb: {},
    status: over.status ?? "pending",
    proposed_by: ORCHESTRATOR_PROPOSED_BY,
    decided_by_profile_id: null,
    decided_by_name: null,
    decided_at: null,
    decision_notes: null,
    published_at: null,
    publish_error: null,
    ...over,
  };
}

/* --------------------------------- specs ---------------------------------- */

describe("isoWeekStamp", () => {
  it("is deterministic and ISO-week shaped", () => {
    expect(isoWeekStamp("2026-06-23T12:00:00.000Z")).toMatch(/^2026-W\d{2}$/);
    // Same week → same stamp regardless of time of day.
    expect(isoWeekStamp("2026-06-23T01:00:00.000Z")).toBe(isoWeekStamp("2026-06-23T23:00:00.000Z"));
  });
});

describe("defaultDraftGenerator", () => {
  it("produces one weekly gbp_post proposal carrying the week + shop url", () => {
    const out = defaultDraftGenerator({ id: "s", url: "https://x.test" }, { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].actionType).toBe("gbp_post");
    expect(out[0].title).toContain(isoWeekStamp(NOW));
    expect(out[0].payload).toMatchObject({ cadence: "weekly", shopUrl: "https://x.test" });
  });
});

describe("runDraftGeneration", () => {
  it("AUTO-PAUSES at/over the budget cap — no shop touched, nothing queued", async () => {
    const store = makeFakeStore();
    const res = await runDraftGeneration(
      fakeService([{ id: "shop-a", url: null }]),
      { now: NOW, spendCapUsd: 50 },
      { store, readSpendUsd: OVER },
    );
    expect(res.paused).toBe(true);
    expect(res.shopsProcessed).toBe(0);
    expect(res.queued).toBe(0);
    expect(store.rows).toHaveLength(0);
  });

  it("queues one pending proposal per shop (proposed_by=orchestrator), never publishes", async () => {
    const store = makeFakeStore();
    const res = await runDraftGeneration(
      fakeService([{ id: "shop-a", url: null }, { id: "shop-b", url: null }]),
      { now: NOW, spendCapUsd: 50 },
      { store, readSpendUsd: UNDER },
    );
    expect(res.paused).toBe(false);
    expect(res.shopsProcessed).toBe(2);
    expect(res.queued).toBe(2);
    expect(store.rows).toHaveLength(2);
    for (const r of store.rows) {
      expect(r.status).toBe("pending"); // <- generation NEVER publishes
      expect(r.proposed_by).toBe(ORCHESTRATOR_PROPOSED_BY);
      expect(r.published_at).toBeNull();
    }
  });

  it("is idempotent — a re-run skips the slot already queued", async () => {
    const svc = fakeService([{ id: "shop-a", url: null }]);
    const store = makeFakeStore();
    const first = await runDraftGeneration(svc, { now: NOW, spendCapUsd: 50 }, { store, readSpendUsd: UNDER });
    expect(first.queued).toBe(1);
    const second = await runDraftGeneration(svc, { now: NOW, spendCapUsd: 50 }, { store, readSpendUsd: UNDER });
    expect(second.queued).toBe(0);
    expect(second.skipped).toBe(1);
    expect(store.rows).toHaveLength(1); // no duplicate
  });

  it("does not re-queue against an already-approved/published slot (open statuses)", async () => {
    const week = isoWeekStamp(NOW);
    const title = `Weekly Google Business Profile update — ${week}`;
    const store = makeFakeStore([pendingRow({ id: "x", shop_id: "shop-a", title, status: "approved" })]);
    const res = await runDraftGeneration(
      fakeService([{ id: "shop-a", url: null }]),
      { now: NOW, spendCapUsd: 50 },
      { store, readSpendUsd: UNDER },
    );
    expect(res.queued).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("contains a single shop's generator failure without aborting the pass", async () => {
    const store = makeFakeStore();
    const boom: DraftGenerator = (shop) => {
      if (shop.id === "shop-a") throw new Error("gen boom");
      return defaultDraftGenerator(shop, { now: NOW });
    };
    const res = await runDraftGeneration(
      fakeService([{ id: "shop-a", url: null }, { id: "shop-b", url: null }]),
      { now: NOW, spendCapUsd: 50 },
      { store, readSpendUsd: UNDER, generate: boom },
    );
    expect(res.failed).toBe(1);
    expect(res.queued).toBe(1); // shop-b still queued
    expect(res.outcomes.find((o) => o.shopId === "shop-a")?.status).toBe("failed");
  });
});

describe("publishApprovedRow", () => {
  it("publishes via the registered publisher → status published + ref", async () => {
    const store = makeFakeStore([pendingRow({ id: "a1", status: "approved" })]);
    const out = await publishApprovedRow(store, store.rows[0], { gbp_post: recordingPublisher }, NOW);
    expect(out.status).toBe("published");
    const row = await store.get("a1");
    expect(row?.status).toBe("published");
    expect(row?.published_at).toBe(NOW);
    expect(row?.publish_error).toContain("ref:orchestrator:internal:a1");
  });

  it("captures a publisher throw as publish_failed, preserving the decision", async () => {
    const store = makeFakeStore([pendingRow({ id: "a1", status: "approved", decided_by_name: "Owner" })]);
    const throwing: PublisherRegistry = {
      gbp_post: async () => {
        throw new Error("downstream 500");
      },
    };
    const out = await publishApprovedRow(store, store.rows[0], throwing, NOW);
    expect(out.status).toBe("publish_failed");
    const row = await store.get("a1");
    expect(row?.status).toBe("publish_failed");
    expect(row?.publish_error).toBe("downstream 500");
    expect(row?.decided_by_name).toBe("Owner"); // decision preserved
  });

  it("leaves the row approved when no publisher is registered (awaiting_publisher)", async () => {
    const store = makeFakeStore([pendingRow({ id: "a1", action_type: "review_reply", status: "approved" })]);
    const out = await publishApprovedRow(store, store.rows[0], {}, NOW);
    expect(out.status).toBe("awaiting_publisher");
    const row = await store.get("a1");
    expect(row?.status).toBe("approved"); // untouched — never fabricates a publish
  });
});

describe("runPublishApproved", () => {
  it("AUTO-PAUSES at/over the budget cap — nothing published", async () => {
    const store = makeFakeStore([pendingRow({ id: "a1", status: "approved" })]);
    const res = await runPublishApproved(
      fakeService([{ id: "shop-a", url: null }]),
      { now: NOW, spendCapUsd: 50 },
      { store, readSpendUsd: OVER },
    );
    expect(res.paused).toBe(true);
    expect(res.published).toBe(0);
    expect((await store.get("a1"))?.status).toBe("approved");
  });

  it("publishes ONLY approved rows — a pending row is never published", async () => {
    const store = makeFakeStore([
      pendingRow({ id: "pend", shop_id: "shop-a", status: "pending" }),
      pendingRow({ id: "appr", shop_id: "shop-a", status: "approved" }),
    ]);
    const res = await runPublishApproved(
      fakeService([{ id: "shop-a", url: null }]),
      { now: NOW, spendCapUsd: 50 },
      { store, readSpendUsd: UNDER },
    );
    expect(res.approvedFound).toBe(1);
    expect(res.published).toBe(1);
    expect((await store.get("appr"))?.status).toBe("published");
    expect((await store.get("pend"))?.status).toBe("pending"); // <- INVARIANT: untouched
  });

  it("reports awaiting_publisher (and leaves approved) when no publisher is registered", async () => {
    const store = makeFakeStore([pendingRow({ id: "a1", shop_id: "shop-a", action_type: "review_reply", status: "approved" })]);
    const res = await runPublishApproved(
      fakeService([{ id: "shop-a", url: null }]),
      { now: NOW, spendCapUsd: 50 },
      { store, readSpendUsd: UNDER, publishers: {} },
    );
    expect(res.awaitingPublisher).toBe(1);
    expect(res.published).toBe(0);
    expect((await store.get("a1"))?.status).toBe("approved");
  });

  it("contains a per-shop list failure without aborting the whole pass", async () => {
    const good = makeFakeStore([pendingRow({ id: "a1", shop_id: "shop-b", status: "approved" })]);
    // Wrap listByShop so shop-a throws but shop-b still works.
    const store: typeof good = {
      ...good,
      async listByShop(shopId, statuses) {
        if (shopId === "shop-a") throw new Error("rls boom");
        return good.listByShop(shopId, statuses);
      },
    };
    const res = await runPublishApproved(
      fakeService([{ id: "shop-a", url: null }, { id: "shop-b", url: null }]),
      { now: NOW, spendCapUsd: 50 },
      { store, readSpendUsd: UNDER },
    );
    expect(res.failed).toBe(1); // shop-a list failure recorded
    expect(res.published).toBe(1); // shop-b still published
    expect(res.outcomes.some((o) => o.error?.includes("list approved failed"))).toBe(true);
  });

  it("counts publish_failed without losing the approval", async () => {
    const store = makeFakeStore([pendingRow({ id: "a1", shop_id: "shop-a", status: "approved" })]);
    const res = await runPublishApproved(
      fakeService([{ id: "shop-a", url: null }]),
      { now: NOW, spendCapUsd: 50 },
      {
        store,
        readSpendUsd: UNDER,
        publishers: { gbp_post: async () => { throw new Error("nope"); } },
      },
    );
    expect(res.failed).toBe(1);
    expect((await store.get("a1"))?.status).toBe("publish_failed");
  });
});

describe("governance loop end-to-end (generate → approve → publish)", () => {
  it("only the human-approved item publishes; a still-pending item does not", async () => {
    const svc = fakeService([{ id: "shop-a", url: "https://a.test" }, { id: "shop-b", url: null }]);
    const store = makeFakeStore();

    // 1. Generation queues a pending proposal per shop.
    const gen = await runDraftGeneration(svc, { now: NOW, spendCapUsd: 50 }, { store, readSpendUsd: UNDER });
    expect(gen.queued).toBe(2);

    // 2. A human approves ONLY shop-a's proposal (simulating the PSG-245 approve route).
    const shopARow = store.rows.find((r) => r.shop_id === "shop-a")!;
    await store.update(shopARow.id!, {
      status: "approved",
      decided_by_profile_id: "owner-uid",
      decided_at: NOW,
    });

    // 3. Publish pass: only the approved (shop-a) item is published; shop-b stays pending.
    const pub = await runPublishApproved(svc, { now: NOW, spendCapUsd: 50 }, { store, readSpendUsd: UNDER });
    expect(pub.approvedFound).toBe(1);
    expect(pub.published).toBe(1);
    expect((await store.get(shopARow.id!))?.status).toBe("published");
    const shopBRow = store.rows.find((r) => r.shop_id === "shop-b")!;
    expect(shopBRow.status).toBe("pending"); // never auto-published
  });
});

describe("defaults", () => {
  it("ships a small default cap and a recording publisher for its own action types", () => {
    expect(DEFAULT_ORCHESTRATOR_SPEND_CAP_USD).toBe(25);
    expect(defaultOrchestratorPublishers.gbp_post).toBe(recordingPublisher);
    expect(defaultOrchestratorPublishers.content).toBe(recordingPublisher);
  });
});
