import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  persistBsmDrafts,
  toContentItemRow,
  type PersistableDraft,
  type ShopResolver,
} from "../content-drafts";
import { gateAllBsmDrafts } from "@/lib/agent-engine/__fixtures__/bsm-drafts";
import { toContentItemDraft } from "@/lib/agent-engine";

// ── In-memory content_items fake (records inserts; supports the idempotency
//    slot lookup with eq/is filters) ────────────────────────────────────────
type Row = Record<string, unknown>;

function makeClient(seed: Row[] = []) {
  const store: Row[] = [...seed];
  let nextId = 1;
  const inserted: Row[] = [];

  function queryBuilder() {
    const filters: Array<{ col: string; val: unknown; op: "eq" | "is" }> = [];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push({ col, val, op: "eq" });
        return builder;
      },
      is: (col: string, val: unknown) => {
        filters.push({ col, val, op: "is" });
        return builder;
      },
      limit: () => builder,
      maybeSingle: async () => {
        const match = store.find((r) =>
          filters.every((f) => (f.op === "is" ? r[f.col] == null && f.val == null : r[f.col] === f.val)),
        );
        return { data: match ? { id: match.id } : null, error: null };
      },
    };
    return builder;
  }

  const realClient = {
    from: (table: string) => {
      if (table !== "content_items") throw new Error(`unexpected table ${table}`);
      const qb = queryBuilder();
      return {
        select: qb.select,
        eq: qb.eq,
        is: qb.is,
        limit: qb.limit,
        maybeSingle: qb.maybeSingle,
        insert: (row: Row) => ({
          select: () => ({
            single: async () => {
              const id = `ci-${nextId++}`;
              const stored = { ...row, id };
              store.push(stored);
              inserted.push(stored);
              return { data: { id }, error: null };
            },
          }),
        }),
      };
    },
  };
  return { client: realClient as unknown as SupabaseClient, store, inserted };
}

const resolver: ShopResolver = (sym) => {
  const map: Record<string, { shopId: string; locationId: string }> = {
    "shop-tracys": { shopId: "00000000-0000-0000-0000-0000000000a1", locationId: "00000000-0000-0000-0000-0000000000b1" },
    "shop-tedesco": { shopId: "00000000-0000-0000-0000-0000000000a2", locationId: "00000000-0000-0000-0000-0000000000b2" },
    "shop-wallace": { shopId: "00000000-0000-0000-0000-0000000000a3", locationId: "00000000-0000-0000-0000-0000000000b3" },
  };
  return map[sym] ?? null;
};

let drafts: PersistableDraft[];
beforeEach(() => {
  drafts = gateAllBsmDrafts().map((d) => ({
    key: d.key,
    shopId: d.shopId,
    gated: d.gated,
    shipped: d.shipped,
  }));
});

describe("toContentItemRow", () => {
  it("maps a ContentItemDraft into the snake_case content_items row", () => {
    const draft = toContentItemDraft(drafts[0].gated, "loc-1");
    const row = toContentItemRow({ ...draft, shopId: "shop-real" }, "2026-06-22T00:00:00.000Z");
    expect(row).toMatchObject({
      shop_id: "shop-real",
      location_id: "loc-1",
      status: "draft",
      claim_integrity_checked_at: "2026-06-22T00:00:00.000Z",
    });
    expect(row.claims_manifest).toBeDefined();
    expect((row.claim_integrity_verdict as { verdict: string }).verdict).toBe("ship");
  });
});

describe("persistBsmDrafts", () => {
  it("persists all 9 shipped drafts as status='draft' with manifest + verdict", async () => {
    expect(drafts).toHaveLength(9);
    expect(drafts.every((d) => d.shipped)).toBe(true);

    const { client, inserted } = makeClient();
    const summary = await persistBsmDrafts(client, drafts, resolver, {
      checkedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(summary.inserted).toBe(9);
    expect(summary.failed).toBe(0);
    expect(inserted).toHaveLength(9);
    // every persisted row is a draft carrying its trust metadata + real ids
    for (const row of inserted) {
      expect(row.status).toBe("draft");
      expect(row.claims_manifest).toBeDefined();
      expect((row.claim_integrity_verdict as { verdict: string }).verdict).toBe("ship");
      expect(String(row.shop_id)).toMatch(/^0{8}-/); // resolved real id, not "shop-*"
    }
  });

  it("is idempotent — a second run inserts nothing", async () => {
    const { client, inserted } = makeClient();
    await persistBsmDrafts(client, drafts, resolver, { checkedAt: "t" });
    expect(inserted).toHaveLength(9);

    const second = await persistBsmDrafts(client, drafts, resolver, { checkedAt: "t" });
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(9);
    expect(inserted).toHaveLength(9); // no new rows
  });

  it("reports a draft whose shop cannot be resolved as failed (never dropped)", async () => {
    const { client } = makeClient();
    const onlyTracys: ShopResolver = (sym) =>
      sym === "shop-tracys" ? { shopId: "real-a", locationId: "real-b" } : null;
    const summary = await persistBsmDrafts(client, drafts, onlyTracys, { checkedAt: "t" });
    expect(summary.inserted).toBe(3); // tracys has 3 assets
    expect(summary.failed).toBe(6);
    expect(summary.outcomes.filter((o) => o.status === "failed").every((o) => /no shop mapping/.test((o as { reason: string }).reason))).toBe(true);
  });

  it("never persists a non-ship asset", async () => {
    const { client, inserted } = makeClient();
    const tampered = drafts.map((d, i) =>
      i === 0 ? { ...d, shipped: false } : d,
    );
    const summary = await persistBsmDrafts(client, tampered, resolver, { checkedAt: "t" });
    expect(summary.inserted).toBe(8);
    expect(summary.failed).toBe(1);
    expect(inserted).toHaveLength(8);
  });
});
