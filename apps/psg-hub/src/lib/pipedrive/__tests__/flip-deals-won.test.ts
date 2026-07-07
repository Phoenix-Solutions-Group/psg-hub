import { describe, it, expect, vi } from "vitest";
import {
  FLIP_DEALS_WON_TARGETS,
  createDealsWriteClient,
  runFlipDealsWon,
  type DealsWriteClient,
} from "../flip-deals-won";

// A stub client that answers GET from an org+status map and records setStatusWon calls.
function stubClient(
  live: Record<number, { status: string; orgId: number | null }>,
  setCalls: number[],
): DealsWriteClient {
  return {
    async get(dealId) {
      const d = live[dealId];
      if (!d) throw new Error(`no such deal ${dealId}`);
      return { id: dealId, status: d.status, orgId: d.orgId, value: 100, currency: "USD" };
    },
    async setStatusWon(dealId) {
      setCalls.push(dealId);
      const d = live[dealId];
      return { id: dealId, status: "won", orgId: d.orgId, value: 100, currency: "USD" };
    },
  };
}

// All five targets currently lost/open and owned by the expected org.
function allMismarkedLive(): Record<number, { status: string; orgId: number | null }> {
  const live: Record<number, { status: string; orgId: number | null }> = {};
  for (const t of FLIP_DEALS_WON_TARGETS) {
    live[t.dealId] = { status: t.dealId === 3898 ? "open" : "lost", orgId: t.orgId };
  }
  return live;
}

describe("FLIP_DEALS_WON_TARGETS", () => {
  it("pins exactly the five PSG-824 orgs, one deal each, with unique ids", () => {
    expect(FLIP_DEALS_WON_TARGETS).toHaveLength(5);
    const orgs = FLIP_DEALS_WON_TARGETS.map((t) => t.orgId).sort((a, b) => a - b);
    expect(orgs).toEqual([1028, 1106, 1328, 5945, 8500]);
    const dealIds = new Set(FLIP_DEALS_WON_TARGETS.map((t) => t.dealId));
    expect(dealIds.size).toBe(5);
  });
});

describe("runFlipDealsWon", () => {
  it("flips all five mis-marked deals to won", async () => {
    const setCalls: number[] = [];
    const res = await runFlipDealsWon({ client: stubClient(allMismarkedLive(), setCalls) });
    expect(res.total).toBe(5);
    expect(res.flipped).toBe(5);
    expect(res.skippedAlreadyWon).toBe(0);
    expect(res.errored).toBe(0);
    expect(setCalls.sort((a, b) => a - b)).toEqual([3558, 3573, 3600, 3844, 3898]);
    for (const r of res.results) {
      expect(r.action).toBe("flipped");
      expect(r.statusAfter).toBe("won");
    }
  });

  it("is idempotent: a deal already won is skipped with no write", async () => {
    const live = allMismarkedLive();
    live[3573] = { status: "won", orgId: 8500 }; // already correct
    const setCalls: number[] = [];
    const res = await runFlipDealsWon({ client: stubClient(live, setCalls) });
    expect(res.flipped).toBe(4);
    expect(res.skippedAlreadyWon).toBe(1);
    expect(res.errored).toBe(0);
    expect(setCalls).not.toContain(3573); // never written
    const skipped = res.results.find((r) => r.dealId === 3573);
    expect(skipped?.action).toBe("skipped_already_won");
    expect(skipped?.statusAfter).toBe("won");
  });

  it("re-running after a full flip writes nothing (converges)", async () => {
    const live: Record<number, { status: string; orgId: number | null }> = {};
    for (const t of FLIP_DEALS_WON_TARGETS) live[t.dealId] = { status: "won", orgId: t.orgId };
    const setCalls: number[] = [];
    const res = await runFlipDealsWon({ client: stubClient(live, setCalls) });
    expect(res.skippedAlreadyWon).toBe(5);
    expect(res.flipped).toBe(0);
    expect(setCalls).toEqual([]);
  });

  it("guards the org: never writes when the deal belongs to a different org", async () => {
    const live = allMismarkedLive();
    live[3600] = { status: "lost", orgId: 9999 }; // re-pointed to the wrong org
    const setCalls: number[] = [];
    const res = await runFlipDealsWon({ client: stubClient(live, setCalls) });
    expect(setCalls).not.toContain(3600);
    expect(res.errored).toBe(1);
    const guarded = res.results.find((r) => r.dealId === 3600);
    expect(guarded?.action).toBe("error");
    expect(guarded?.reason).toMatch(/org_mismatch/);
    // the other four still flip
    expect(res.flipped).toBe(4);
  });

  it("captures a per-deal failure without aborting the batch", async () => {
    const live = allMismarkedLive();
    const setCalls: number[] = [];
    const base = stubClient(live, setCalls);
    const client: DealsWriteClient = {
      get: (id) => (id === 3844 ? Promise.reject(new Error("HTTP 500")) : base.get(id)),
      setStatusWon: base.setStatusWon,
    };
    const res = await runFlipDealsWon({ client });
    expect(res.errored).toBe(1);
    expect(res.flipped).toBe(4);
    const failed = res.results.find((r) => r.dealId === 3844);
    expect(failed?.action).toBe("error");
    expect(failed?.reason).toBe("HTTP 500");
  });

  it("records an error when the write does not land on won", async () => {
    const live = allMismarkedLive();
    const setCalls: number[] = [];
    const client: DealsWriteClient = {
      async get(id) {
        return { id, status: live[id].status, orgId: live[id].orgId, value: 1, currency: "USD" };
      },
      async setStatusWon(id) {
        setCalls.push(id);
        return { id, status: "lost", orgId: live[id].orgId, value: 1, currency: "USD" };
      },
    };
    const res = await runFlipDealsWon({ client });
    expect(res.flipped).toBe(0);
    expect(res.errored).toBe(5);
    expect(res.results.every((r) => r.reason?.includes("write_did_not_win"))).toBe(true);
  });
});

describe("createDealsWriteClient", () => {
  it("throws when no token is configured", () => {
    expect(() => createDealsWriteClient({ apiKey: "" })).toThrow(/Missing Pipedrive token/);
  });

  it("carries the token ONLY in the query string and PUTs only status:won", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const data = { id: 3573, status: "won", org_id: 8500, value: 14250, currency: "USD" };
      return new Response(JSON.stringify({ success: true, data }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createDealsWriteClient({
      apiKey: "secret-token",
      companyDomain: "psg",
      fetchImpl,
    });
    await client.setStatusWon(3573);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toContain("https://psg.pipedrive.com/api/v1/deals/3573");
    expect(calls[0].url).toContain("api_token=secret-token");
    // Body mutates ONLY status — value/currency are never sent (no inflation).
    expect(JSON.parse(calls[0].body!)).toEqual({ status: "won" });
  });

  it("never leaks the token/URL in an HTTP error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ success: false }), { status: 403 }),
    ) as unknown as typeof fetch;
    const client = createDealsWriteClient({ apiKey: "secret-token", companyDomain: "psg", fetchImpl });
    await expect(client.get(3573)).rejects.toThrow(/HTTP 403/);
    await expect(client.get(3573)).rejects.not.toThrow(/secret-token/);
  });

  it("reads org_id whether Pipedrive returns a number or an object", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, data: { id: 3600, status: "lost", org_id: { value: 1106 } } }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const client = createDealsWriteClient({ apiKey: "t", companyDomain: "psg", fetchImpl });
    const deal = await client.get(3600);
    expect(deal.orgId).toBe(1106);
    expect(deal.status).toBe("lost");
  });
});
