import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ApprovalDecisionError,
  approveApproval,
  enqueueApproval,
  rejectApproval,
  validateApprovalDecision,
  type ApprovalQueueRow,
  type ApprovalQueueStore,
  type ApprovalStatus,
  type PublisherRegistry,
} from "../gate";

/** In-memory ApprovalQueueStore — assigns ids, merges patches, filters by shop. */
function memoryStore(): ApprovalQueueStore & { rows: Map<string, ApprovalQueueRow> } {
  const rows = new Map<string, ApprovalQueueRow>();
  let seq = 0;
  return {
    rows,
    async insert(row) {
      const id = row.id ?? `apr-${++seq}`;
      const stored = { ...row, id };
      rows.set(id, stored);
      return stored;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async update(id, patch) {
      const cur = rows.get(id);
      if (!cur) throw new Error(`no row ${id}`);
      const next = { ...cur, ...patch };
      rows.set(id, next);
      return next;
    },
    async listByShop(shopId, statuses?: ApprovalStatus[]) {
      return [...rows.values()].filter(
        (r) => r.shop_id === shopId && (!statuses || statuses.includes(r.status))
      );
    },
  };
}

const NOW = "2026-06-24T12:00:00.000Z";

async function seedPending(
  store: ApprovalQueueStore,
  over: Partial<Parameters<typeof enqueueApproval>[1]> = {}
) {
  return enqueueApproval(store, {
    shopId: "shop-1",
    actionType: "gbp_post",
    title: "Draft GBP post: spring brake special",
    summary: "Proposed Google Business post copy.",
    payload: { body: "Spring brake special — book now." },
    proposedBy: "agent:autopilot",
    ...over,
  });
}

describe("validateApprovalDecision", () => {
  it("allows a decision only on a pending row", () => {
    expect(validateApprovalDecision("pending").ok).toBe(true);
  });

  it("rejects deciding an already-resolved row", () => {
    for (const s of ["approved", "rejected", "published", "publish_failed"] as const) {
      const v = validateApprovalDecision(s);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toContain(s);
    }
  });
});

describe("enqueueApproval", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("creates a pending row carrying the proposed action", async () => {
    const row = await seedPending(store);
    expect(row.id).toBeTruthy();
    expect(row.status).toBe("pending");
    expect(row.shop_id).toBe("shop-1");
    expect(row.action_type).toBe("gbp_post");
    expect(row.payload_jsonb).toEqual({ body: "Spring brake special — book now." });
    expect(row.proposed_by).toBe("agent:autopilot");
    expect(row.decided_at).toBeNull();
    expect(row.published_at).toBeNull();
  });

  it("trims the title and defaults optional fields", async () => {
    const row = await enqueueApproval(store, {
      shopId: "shop-1",
      actionType: "content",
      title: "  Blog draft  ",
    });
    expect(row.title).toBe("Blog draft");
    expect(row.summary).toBeNull();
    expect(row.payload_jsonb).toEqual({});
    expect(row.proposed_by).toBeNull();
  });

  it("requires shopId, actionType and a title", async () => {
    await expect(
      enqueueApproval(store, { shopId: "", actionType: "content", title: "x" })
    ).rejects.toBeInstanceOf(ApprovalDecisionError);
    await expect(
      enqueueApproval(store, { shopId: "s", actionType: "", title: "x" })
    ).rejects.toBeInstanceOf(ApprovalDecisionError);
    await expect(
      enqueueApproval(store, { shopId: "s", actionType: "content", title: "   " })
    ).rejects.toBeInstanceOf(ApprovalDecisionError);
  });
});

describe("approveApproval — publish only on approve", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("with a registered publisher: approves then publishes (status published)", async () => {
    const { id } = await seedPending(store);
    const publish = vi.fn().mockResolvedValue({ ref: "gbp-123" });
    const publishers: PublisherRegistry = { gbp_post: publish };

    const row = await approveApproval(
      store,
      { id: id!, actorProfileId: "p1", actorName: "Owner Olivia", notes: "looks good", now: NOW },
      { publishers }
    );

    expect(publish).toHaveBeenCalledTimes(1);
    // The publisher sees the APPROVED row (decision already recorded).
    expect(publish.mock.calls[0][0].status).toBe("approved");
    expect(row.status).toBe("published");
    expect(row.published_at).toBe(NOW);
    expect(row.decided_by_profile_id).toBe("p1");
    expect(row.decided_by_name).toBe("Owner Olivia");
    expect(row.decided_at).toBe(NOW);
    expect(row.decision_notes).toBe("looks good");
  });

  it("with NO registered publisher: approves and stays approved (no fabricated publish)", async () => {
    const { id } = await seedPending(store);
    const row = await approveApproval(store, { id: id!, actorProfileId: "p1", now: NOW }, {});
    expect(row.status).toBe("approved");
    expect(row.published_at).toBeNull();
  });

  it("publisher failure → publish_failed, but the approval decision is preserved", async () => {
    const { id } = await seedPending(store);
    const publish = vi.fn().mockRejectedValue(new Error("GBP API 503"));
    const row = await approveApproval(
      store,
      { id: id!, actorProfileId: "p1", now: NOW },
      { publishers: { gbp_post: publish } }
    );
    expect(row.status).toBe("publish_failed");
    expect(row.publish_error).toBe("GBP API 503");
    expect(row.decided_by_profile_id).toBe("p1");
    expect(row.published_at).toBeNull();
  });

  it("cannot approve a non-pending row (no double publish)", async () => {
    const { id } = await seedPending(store);
    const publish = vi.fn().mockResolvedValue(undefined);
    await approveApproval(store, { id: id!, actorProfileId: "p1", now: NOW }, { publishers: { gbp_post: publish } });
    await expect(
      approveApproval(store, { id: id!, actorProfileId: "p2", now: NOW }, { publishers: { gbp_post: publish } })
    ).rejects.toBeInstanceOf(ApprovalDecisionError);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("throws on a missing row and on a missing actor", async () => {
    await expect(
      approveApproval(store, { id: "nope", actorProfileId: "p1", now: NOW })
    ).rejects.toBeInstanceOf(ApprovalDecisionError);
    const { id } = await seedPending(store);
    await expect(
      approveApproval(store, { id: id!, actorProfileId: "", now: NOW })
    ).rejects.toBeInstanceOf(ApprovalDecisionError);
  });
});

describe("rejectApproval — never publishes", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("rejects a pending row and records who/when (no publish path)", async () => {
    const { id } = await seedPending(store);
    const row = await rejectApproval(store, {
      id: id!,
      actorProfileId: "p1",
      actorName: "Manager Mia",
      notes: "off-brand",
      now: NOW,
    });
    expect(row.status).toBe("rejected");
    expect(row.decided_by_name).toBe("Manager Mia");
    expect(row.decision_notes).toBe("off-brand");
    expect(row.published_at).toBeNull();
  });

  it("cannot reject an already-decided row", async () => {
    const { id } = await seedPending(store);
    await rejectApproval(store, { id: id!, actorProfileId: "p1", now: NOW });
    await expect(
      rejectApproval(store, { id: id!, actorProfileId: "p1", now: NOW })
    ).rejects.toBeInstanceOf(ApprovalDecisionError);
  });
});

describe("per-shop isolation via listByShop", () => {
  it("only returns rows for the requested shop, status-filterable", async () => {
    const store = memoryStore();
    await seedPending(store, { shopId: "shop-1", title: "A" });
    await seedPending(store, { shopId: "shop-2", title: "B" });
    const b = await seedPending(store, { shopId: "shop-1", title: "C" });
    await rejectApproval(store, { id: b.id!, actorProfileId: "p1", now: NOW });

    const shop1Pending = await store.listByShop("shop-1", ["pending"]);
    expect(shop1Pending.map((r) => r.title).sort()).toEqual(["A"]);
    expect((await store.listByShop("shop-2")).map((r) => r.title)).toEqual(["B"]);
    expect((await store.listByShop("shop-1")).length).toBe(2);
  });
});
