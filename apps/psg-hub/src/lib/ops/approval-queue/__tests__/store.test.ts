import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseApprovalQueueStore } from "../store";
import type { ApprovalQueueRow } from "../gate";

// Exercises the supabase-backed ApprovalQueueStore wiring (table + column
// selection + filter chains) against a chainable fake client, so the I/O layer
// is covered without a live DB. The orchestration logic is tested in gate.test.ts.

const SAMPLE: ApprovalQueueRow = {
  id: "apr-1",
  shop_id: "shop-1",
  action_type: "content",
  title: "Blog draft",
  summary: null,
  payload_jsonb: {},
  status: "pending",
  proposed_by: null,
  decided_by_profile_id: null,
  decided_by_name: null,
  decided_at: null,
  decision_notes: null,
  published_at: null,
  publish_error: null,
};

/** A chainable query builder whose terminal methods resolve to `result`. */
function builder(result: { data: unknown; error: { message: string } | null }) {
  const calls: Record<string, unknown[]> = {};
  const chain: Record<string, unknown> = {};
  for (const m of ["insert", "select", "update", "eq", "in", "order"]) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls[m] = args;
      return chain;
    });
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  // order() is terminal for listByShop — make it awaitable too.
  chain.order = vi.fn((...args: unknown[]) => {
    calls.order = args;
    return Promise.resolve(result);
  });
  return { chain, calls };
}

function clientFor(result: { data: unknown; error: { message: string } | null }) {
  const { chain, calls } = builder(result);
  const from = vi.fn(() => chain);
  return { service: { from } as unknown as SupabaseClient, from, calls };
}

describe("supabaseApprovalQueueStore", () => {
  it("insert → returns the stored row", async () => {
    const { service, from } = clientFor({ data: SAMPLE, error: null });
    const row = await supabaseApprovalQueueStore(service).insert(SAMPLE);
    expect(from).toHaveBeenCalledWith("approval_queue");
    expect(row.id).toBe("apr-1");
  });

  it("get → returns the row or null", async () => {
    const { service } = clientFor({ data: SAMPLE, error: null });
    expect(await supabaseApprovalQueueStore(service).get("apr-1")).toEqual(SAMPLE);
    const { service: empty } = clientFor({ data: null, error: null });
    expect(await supabaseApprovalQueueStore(empty).get("missing")).toBeNull();
  });

  it("update → applies the patch and returns the row", async () => {
    const patched = { ...SAMPLE, status: "approved" as const };
    const { service, calls } = clientFor({ data: patched, error: null });
    const row = await supabaseApprovalQueueStore(service).update("apr-1", { status: "approved" });
    expect(calls.update?.[0]).toEqual({ status: "approved" });
    expect(row.status).toBe("approved");
  });

  it("listByShop → filters by shop, optionally by status, newest first", async () => {
    const { service, calls } = clientFor({ data: [SAMPLE], error: null });
    const rows = await supabaseApprovalQueueStore(service).listByShop("shop-1", ["pending"]);
    expect(calls.eq).toEqual(["shop_id", "shop-1"]);
    expect(calls.in).toEqual(["status", ["pending"]]);
    expect(calls.order).toEqual(["created_at", { ascending: false }]);
    expect(rows).toHaveLength(1);
  });

  it("listByShop → omits the status filter when none given", async () => {
    const { service, calls } = clientFor({ data: [], error: null });
    await supabaseApprovalQueueStore(service).listByShop("shop-1");
    expect(calls.in).toBeUndefined();
  });

  it("surfaces DB errors as thrown Errors", async () => {
    const { service } = clientFor({ data: null, error: { message: "boom" } });
    await expect(supabaseApprovalQueueStore(service).get("apr-1")).rejects.toThrow(/boom/);
  });
});
