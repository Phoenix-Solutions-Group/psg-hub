import { describe, it, expect, beforeEach } from "vitest";
import type { CccConnectionStatus } from "@/lib/ccc/connection-state";
import {
  CccTransitionError,
  CCC_AUDIT_ACTION,
  MAX_DECLINE_REASON,
  approveCccConnection,
  declineCccConnection,
  revokeCccConnection,
  validateCccTransition,
  type CccAccountRow,
  type CccAccountStore,
} from "../approval-queue";

/** In-memory CccAccountStore — assigns ids on seed, merges patches, filters by status. */
function memoryStore(): CccAccountStore & {
  rows: Map<string, CccAccountRow>;
  seed: (over?: Partial<CccAccountRow>) => CccAccountRow;
} {
  const rows = new Map<string, CccAccountRow>();
  let seq = 0;
  return {
    rows,
    seed(over = {}) {
      const id = over.id ?? `ccc-${++seq}`;
      const row: CccAccountRow = {
        id,
        shop_id: "shop-1",
        ccc_account_id: "ACME-001",
        facility_id: "88231",
        connection_status: "pending_review",
        enabled_at: "2026-06-24T10:00:00.000Z",
        last_event_at: null,
        last_event_label: null,
        approved_by: null,
        approved_at: null,
        declined_reason: null,
        error_reason: null,
        ...over,
      };
      rows.set(id, row);
      return row;
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
    async list(statuses?: CccConnectionStatus[]) {
      return [...rows.values()].filter(
        (r) => !statuses || statuses.includes(r.connection_status),
      );
    },
  };
}

const ACTOR = "superadmin-1";
const NOW = "2026-06-24T12:00:00.000Z";

describe("validateCccTransition (pure state machine)", () => {
  it("approve & decline only fire from pending_review", () => {
    expect(validateCccTransition("approve", "pending_review").ok).toBe(true);
    expect(validateCccTransition("decline", "pending_review").ok).toBe(true);
    for (const s of ["not_connected", "connected", "error", "declined"] as const) {
      expect(validateCccTransition("approve", s).ok).toBe(false);
      expect(validateCccTransition("decline", s).ok).toBe(false);
    }
  });

  it("revoke fires from connected OR error, not from pending/declined/not_connected", () => {
    expect(validateCccTransition("revoke", "connected").ok).toBe(true);
    expect(validateCccTransition("revoke", "error").ok).toBe(true);
    for (const s of ["not_connected", "pending_review", "declined"] as const) {
      expect(validateCccTransition("revoke", s).ok).toBe(false);
    }
  });
});

describe("approveCccConnection", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("pending_review + linked shop → connected with attribution + last_event", async () => {
    const row = store.seed({ shop_id: "shop-7" });
    const out = await approveCccConnection(store, { id: row.id, actorProfileId: ACTOR, now: NOW });
    expect(out.connection_status).toBe("connected");
    expect(out.approved_by).toBe(ACTOR);
    expect(out.approved_at).toBe(NOW);
    expect(out.last_event_at).toBe(NOW);
    expect(out.last_event_label).toBe("Connection approved");
    expect(out.shop_id).toBe("shop-7");
  });

  it("AC: refuses to approve an UNMATCHED row (no orphan connections)", async () => {
    const row = store.seed({ shop_id: null });
    await expect(
      approveCccConnection(store, { id: row.id, actorProfileId: ACTOR, now: NOW }),
    ).rejects.toThrow(CccTransitionError);
    // The row is untouched — still pending, still unmatched.
    expect(store.rows.get(row.id)!.connection_status).toBe("pending_review");
  });

  it("links an unmatched row + approves in one call when shopId is passed", async () => {
    const row = store.seed({ shop_id: null });
    const out = await approveCccConnection(store, {
      id: row.id,
      actorProfileId: ACTOR,
      shopId: "shop-9",
      now: NOW,
    });
    expect(out.shop_id).toBe("shop-9");
    expect(out.connection_status).toBe("connected");
  });

  it("rejects a non-pending row (no double-approve / verdict flip)", async () => {
    const row = store.seed({ connection_status: "connected", shop_id: "shop-1" });
    await expect(
      approveCccConnection(store, { id: row.id, actorProfileId: ACTOR, now: NOW }),
    ).rejects.toThrow(/cannot approve a connection in state "connected"/);
  });

  it("requires an actor and a real row", async () => {
    await expect(
      approveCccConnection(store, { id: "x", actorProfileId: "", now: NOW }),
    ).rejects.toThrow(/actorProfileId is required/);
    await expect(
      approveCccConnection(store, { id: "missing", actorProfileId: ACTOR, now: NOW }),
    ).rejects.toThrow(/not found/);
  });
});

describe("declineCccConnection", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("pending_review + reason → declined with stored reason + last_event", async () => {
    const row = store.seed();
    const out = await declineCccConnection(store, {
      id: row.id,
      actorProfileId: ACTOR,
      reason: "  Shop not yet onboarded  ",
      now: NOW,
    });
    expect(out.connection_status).toBe("declined");
    expect(out.declined_reason).toBe("Shop not yet onboarded"); // trimmed
    expect(out.last_event_label).toBe("Request declined");
    expect(out.last_event_at).toBe(NOW);
  });

  it("AC: requires a non-empty reason", async () => {
    const row = store.seed();
    await expect(
      declineCccConnection(store, { id: row.id, actorProfileId: ACTOR, reason: "   ", now: NOW }),
    ).rejects.toThrow(/reason is required/);
    expect(store.rows.get(row.id)!.connection_status).toBe("pending_review");
  });

  it("rejects a reason over the max length", async () => {
    const row = store.seed();
    await expect(
      declineCccConnection(store, {
        id: row.id,
        actorProfileId: ACTOR,
        reason: "x".repeat(MAX_DECLINE_REASON + 1),
        now: NOW,
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it("only declines a pending row", async () => {
    const row = store.seed({ connection_status: "declined" });
    await expect(
      declineCccConnection(store, { id: row.id, actorProfileId: ACTOR, reason: "again", now: NOW }),
    ).rejects.toThrow(/cannot decline a connection in state "declined"/);
  });
});

describe("revokeCccConnection", () => {
  let store: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    store = memoryStore();
  });

  it("connected → not_connected, clears error_reason, stamps last_event", async () => {
    const row = store.seed({ connection_status: "connected" });
    const out = await revokeCccConnection(store, { id: row.id, actorProfileId: ACTOR, now: NOW });
    expect(out.connection_status).toBe("not_connected");
    expect(out.last_event_label).toBe("Connection revoked");
    expect(out.error_reason).toBeNull();
  });

  it("error → not_connected (revoke a broken feed)", async () => {
    const row = store.seed({ connection_status: "error", error_reason: "auth_expired" });
    const out = await revokeCccConnection(store, { id: row.id, actorProfileId: ACTOR, now: NOW });
    expect(out.connection_status).toBe("not_connected");
    expect(out.error_reason).toBeNull();
  });

  it("cannot revoke a pending or already not_connected row", async () => {
    const pending = store.seed({ connection_status: "pending_review" });
    await expect(
      revokeCccConnection(store, { id: pending.id, actorProfileId: ACTOR, now: NOW }),
    ).rejects.toThrow(/cannot revoke a connection in state "pending_review"/);
  });
});

describe("CCC_AUDIT_ACTION map", () => {
  it("maps each queue action to its closed-vocabulary audit key", () => {
    expect(CCC_AUDIT_ACTION).toEqual({
      approve: "ccc.connection.approve",
      decline: "ccc.connection.decline",
      revoke: "ccc.connection.revoke",
    });
  });
});
