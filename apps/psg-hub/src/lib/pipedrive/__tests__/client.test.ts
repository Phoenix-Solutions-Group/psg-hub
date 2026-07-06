import { describe, it, expect, vi } from "vitest";
import {
  createPipedriveClient,
  deriveMonthlyValue,
  deriveRevenueType,
  mapRawDeal,
  pipedriveBaseUrl,
  PipedriveError,
} from "../client";

describe("deriveRevenueType (honest-null — never silently bucket)", () => {
  it("classifies native recurring signals as recurring", () => {
    expect(deriveRevenueType({ recurring: true })).toBe("recurring");
    expect(deriveRevenueType({ subscription_id: 88 })).toBe("recurring");
    expect(deriveRevenueType({ mrr: 1500 })).toBe("recurring");
    expect(deriveRevenueType({ recurring_revenue: 900 })).toBe("recurring");
  });
  it("maps documented deal-type/category markers", () => {
    expect(deriveRevenueType({ revenue_type: "Subscription" })).toBe("recurring");
    expect(deriveRevenueType({ revenue_type: "one-time" })).toBe("one_time");
    expect(deriveRevenueType({ revenue_type: "project" })).toBe("one_time");
  });
  it("returns null when there is no signal (→ surfaced as unknown, never netted)", () => {
    expect(deriveRevenueType({ value: 5000, status: "won" })).toBeNull();
    expect(deriveRevenueType({ revenue_type: "??" })).toBeNull();
    expect(deriveRevenueType({ mrr: 0 })).toBeNull();
  });
});

describe("deriveMonthlyValue (PSG-468 — normalized monthly MRR basis, honest-null)", () => {
  it("uses a native monthly figure directly (mrr / recurring_revenue)", () => {
    expect(deriveMonthlyValue({ mrr: 1500 })).toBe(1500);
    expect(deriveMonthlyValue({ recurring_revenue: 900 })).toBe(900);
  });
  it("normalizes a recurring amount by its interval to a monthly basis", () => {
    // annual contract of $12,000 → $1,000/mo
    expect(deriveMonthlyValue({ recurring: true, recurring_amount: 12000, cadence_type: "yearly" })).toBe(1000);
    // quarterly $3,000 → $1,000/mo
    expect(deriveMonthlyValue({ recurring: true, cycle_amount: 3000, cadence_type: "quarterly" })).toBe(1000);
    // monthly amount passes through
    expect(deriveMonthlyValue({ recurring: true, recurring_amount: 2000, cadence_type: "monthly" })).toBe(2000);
    // weekly $100 → 100 * 52/12 ≈ 433.33
    expect(deriveMonthlyValue({ recurring: true, recurring_amount: 100, cadence_type: "weekly" })).toBe(433.33);
    // Stripe-style bare unit + count: every 3 months, $3,000 → $1,000/mo
    expect(deriveMonthlyValue({ recurring: true, recurring_amount: 3000, interval: "month", interval_count: 3 })).toBe(1000);
  });
  it("is honest-null when the deal is recurring but the basis can't be derived", () => {
    // recurring flag, but no amount and no interval
    expect(deriveMonthlyValue({ recurring: true })).toBeNull();
    // amount present but interval missing → can't normalize
    expect(deriveMonthlyValue({ recurring: true, recurring_amount: 12000 })).toBeNull();
    // interval present but no amount and no native mrr
    expect(deriveMonthlyValue({ recurring: true, cadence_type: "yearly" })).toBeNull();
    // unrecognized interval keyword
    expect(deriveMonthlyValue({ recurring: true, recurring_amount: 1200, cadence_type: "whenever" })).toBeNull();
  });
  it("is null for non-recurring deals (one_time / unknown)", () => {
    expect(deriveMonthlyValue({ revenue_type: "one_time", value: 5000 })).toBeNull();
    expect(deriveMonthlyValue({ value: 5000 })).toBeNull(); // unknown
    // an amount/interval on a NON-recurring deal must not be netted as MRR
    expect(deriveMonthlyValue({ revenue_type: "project", recurring_amount: 12000, cadence_type: "yearly" })).toBeNull();
  });
  it("is carried onto PipedriveDeal by mapRawDeal", () => {
    const d = mapRawDeal({ id: 7, status: "won", recurring: true, recurring_amount: 12000, cadence_type: "yearly" });
    expect(d.revenueType).toBe("recurring");
    expect(d.monthlyValue).toBe(1000);
    const oneTime = mapRawDeal({ id: 8, status: "won", revenue_type: "project", value: 9000 });
    expect(oneTime.monthlyValue).toBeNull();
  });
});

describe("pipedriveBaseUrl", () => {
  it("uses the company subdomain when provided", () => {
    expect(pipedriveBaseUrl("acme")).toBe("https://acme.pipedrive.com");
  });
  it("normalises a full host down to the subdomain", () => {
    expect(pipedriveBaseUrl("https://acme.pipedrive.com")).toBe(
      "https://acme.pipedrive.com",
    );
  });
  it("falls back to the shared API host when domain is blank/null", () => {
    expect(pipedriveBaseUrl(null)).toBe("https://api.pipedrive.com");
    expect(pipedriveBaseUrl("  ")).toBe("https://api.pipedrive.com");
  });
});

describe("mapRawDeal", () => {
  it("maps a v2-style flat payload", () => {
    const d = mapRawDeal({
      id: 42,
      title: "Bodyshop A retainer",
      value: 12000,
      currency: "USD",
      status: "open",
      pipeline_id: 1,
      stage_id: 6,
      stage_name: "Contract",
      probability: 95,
      org_id: 7,
      org_name: "Bodyshop A",
      person_id: 9,
      owner_id: 3,
      owner_name: "Rep One",
      expected_close_date: "2026-08-01",
      last_activity_date: "2026-06-20",
    });
    expect(d).toMatchObject({
      dealId: 42,
      value: 12000,
      status: "open",
      stageId: 6,
      winProbability: 95,
      ownerId: 3,
      ownerName: "Rep One",
      lastActivityDate: "2026-06-20",
    });
  });

  it("maps v1-style nested relation objects (org/owner as {value,name})", () => {
    const d = mapRawDeal({
      id: 1,
      org_id: { value: 7, name: "Bodyshop A" },
      user_id: { id: 3, name: "Rep One" },
      close_time: "2026-06-15 10:30:00",
    });
    expect(d.orgId).toBe(7);
    expect(d.orgName).toBe("Bodyshop A");
    expect(d.ownerId).toBe(3);
    expect(d.ownerName).toBe("Rep One");
    expect(d.closeDate).toBe("2026-06-15"); // timestamp trimmed to date
  });

  it("defaults missing/invalid fields safely (no NaN, status coerced)", () => {
    const d = mapRawDeal({ id: 5, value: "not-a-number", status: "weird" });
    expect(d.value).toBe(0);
    expect(d.status).toBe("open");
    expect(d.lastActivityDate).toBeNull();
  });
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("createPipedriveClient", () => {
  it("throws when no token is available", () => {
    expect(() => createPipedriveClient({ apiToken: "" })).toThrow(PipedriveError);
  });

  it("follows cursor pagination until next_cursor is null", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [{ id: 1, value: 100, status: "open" }],
          additional_data: { next_cursor: "CUR2" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [{ id: 2, value: 200, status: "open" }],
          additional_data: { next_cursor: null },
        }),
      );

    const client = createPipedriveClient({
      apiToken: "tok_secret",
      companyDomain: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const deals = await client.fetchOpenDeals();

    expect(deals.map((d) => d.dealId)).toEqual([1, 2]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const firstUrl = String(fetchImpl.mock.calls[0][0]);
    expect(firstUrl).toContain("https://acme.pipedrive.com/api/v2/deals");
    expect(firstUrl).toContain("status=open");
    expect(firstUrl).toContain("api_token=tok_secret");
    const secondUrl = String(fetchImpl.mock.calls[1][0]);
    expect(secondUrl).toContain("cursor=CUR2");
  });

  it("never leaks the token in a thrown error on non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 403));
    const client = createPipedriveClient({
      apiToken: "tok_secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.fetchOpenDeals()).rejects.toMatchObject({
      name: "PipedriveError",
      status: 403,
    });
    await expect(client.fetchOpenDeals()).rejects.not.toThrow(/tok_secret/);
  });

  it("passes updated_since for status-scoped (won/lost) pulls", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: [], additional_data: { next_cursor: null } }),
    );
    const client = createPipedriveClient({
      apiToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.fetchDealsByStatus("won", "2025-07-01");
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("status=won");
    expect(url).toContain("updated_since=2025-07-01");
  });
});
