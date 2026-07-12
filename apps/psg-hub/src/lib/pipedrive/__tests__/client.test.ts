import { describe, it, expect, vi } from "vitest";
import {
  createPipedriveClient,
  deriveMonthlyValue,
  deriveRevenueType,
  mapRawDeal,
  mapRawPersonContact,
  mapRawStage,
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
    // Routed by URL: fetchOpenDeals first fetches /stages (the name join), then the two
    // /deals pages. Route so the extra stages call can't consume a deal-page response.
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/v2/stages")) {
        return jsonResponse({ success: true, data: [], additional_data: { next_cursor: null } });
      }
      if (u.includes("cursor=CUR2")) {
        return jsonResponse({
          success: true,
          data: [{ id: 2, value: 200, status: "open" }],
          additional_data: { next_cursor: null },
        });
      }
      return jsonResponse({
        success: true,
        data: [{ id: 1, value: 100, status: "open" }],
        additional_data: { next_cursor: "CUR2" },
      });
    });

    const client = createPipedriveClient({
      apiToken: "tok_secret",
      companyDomain: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const deals = await client.fetchOpenDeals();

    expect(deals.map((d) => d.dealId)).toEqual([1, 2]);

    const dealUrls = fetchImpl.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/api/v2/deals"));
    expect(dealUrls).toHaveLength(2);
    expect(dealUrls[0]).toContain("https://acme.pipedrive.com/api/v2/deals");
    expect(dealUrls[0]).toContain("status=open");
    expect(dealUrls[0]).toContain("api_token=tok_secret");
    expect(dealUrls[1]).toContain("cursor=CUR2");
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
    // The stages join fetches /api/v2/stages first; find the /deals call to assert on it.
    const dealsUrl = fetchImpl.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v2/deals"))!;
    expect(dealsUrl).toContain("status=won");
    expect(dealsUrl).toContain("updated_since=2025-07-01");
  });
});

// ── PSG-622: stage names (fetch /api/v2/stages + join onto deals) ────────────────────
/** Route a mocked fetch by URL so a deal pull and its stage-name join can be served together. */
function routeFetch(routes: {
  stages?: unknown;
  stagesOk?: boolean;
  stagesStatus?: number;
  orgs?: unknown;
  orgsOk?: boolean;
  orgsStatus?: number;
  deals?: unknown;
}): ReturnType<typeof vi.fn> {
  const emptyPage = { success: true, data: [], additional_data: { next_cursor: null } };
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/v2/stages")) {
      return jsonResponse(routes.stages ?? {}, routes.stagesOk ?? true, routes.stagesStatus ?? 200);
    }
    if (u.includes("/api/v2/organizations")) {
      return jsonResponse(routes.orgs ?? emptyPage, routes.orgsOk ?? true, routes.orgsStatus ?? 200);
    }
    return jsonResponse(routes.deals ?? emptyPage);
  });
}

describe("mapRawStage", () => {
  it("maps a v2 stage payload (id/name/pipeline_id/order_nr)", () => {
    const s = mapRawStage({ id: 61, name: "Lead In", pipeline_id: 8, order_nr: 1 });
    expect(s).toEqual({ id: 61, name: "Lead In", pipelineId: 8, orderNr: 1 });
  });
  it("maps a v1 nested pipeline relation and defaults a missing name to null", () => {
    const s = mapRawStage({ id: 5, pipeline_id: { value: 8, name: "Sales" } });
    expect(s).toMatchObject({ id: 5, name: null, pipelineId: 8, orderNr: null });
  });
});

describe("mapRawPersonContact", () => {
  it("uses the primary email and phone values from Pipedrive person arrays", () => {
    expect(
      mapRawPersonContact({
        name: "Pat Owner",
        email: [
          { value: "secondary@example.com", primary: false },
          { value: "owner@example.com", primary: true },
        ],
        phone: [
          { value: "(555) 000-0000", primary: false },
          { value: "(555) 867-5309", primary: true },
        ],
      }),
    ).toEqual({
      firstName: "Pat",
      email: "owner@example.com",
      phone: "(555) 867-5309",
    });
  });

  it("returns nulls for blank contact arrays", () => {
    expect(mapRawPersonContact({ name: "", email: [{ value: " " }], phone: [] })).toEqual({
      firstName: null,
      email: null,
      phone: null,
    });
  });
});

describe("createPipedriveClient — stage names", () => {
  it("fetchStages paginates /api/v2/stages and maps rows", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [{ id: 56, name: "Contract", pipeline_id: 8, order_nr: 6 }],
          additional_data: { next_cursor: "S2" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [{ id: 61, name: "Lead In", pipeline_id: 8, order_nr: 1 }],
          additional_data: { next_cursor: null },
        }),
      );
    const client = createPipedriveClient({
      apiToken: "tok_secret",
      companyDomain: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const stages = await client.fetchStages();
    expect(stages.map((s) => s.id)).toEqual([56, 61]);
    expect(stages[0]).toEqual({ id: 56, name: "Contract", pipelineId: 8, orderNr: 6 });
    const firstUrl = String(fetchImpl.mock.calls[0][0]);
    expect(firstUrl).toContain("https://acme.pipedrive.com/api/v2/stages");
    expect(firstUrl).toContain("api_token=tok_secret");
    expect(String(fetchImpl.mock.calls[1][0])).toContain("cursor=S2");
  });

  it("joins the stage name onto a v2 deal that omits stage_name", async () => {
    const fetchImpl = routeFetch({
      stages: {
        success: true,
        data: [{ id: 61, name: "Lead In", pipeline_id: 8, order_nr: 1 }],
        additional_data: { next_cursor: null },
      },
      deals: {
        success: true,
        data: [{ id: 1, value: 100, status: "open", stage_id: 61 }],
        additional_data: { next_cursor: null },
      },
    });
    const client = createPipedriveClient({
      apiToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [deal] = await client.fetchOpenDeals();
    expect(deal!.stageId).toBe(61);
    expect(deal!.stageName).toBe("Lead In");
  });

  it("does not overwrite a stage_name the deal payload already carries", async () => {
    const fetchImpl = routeFetch({
      stages: {
        success: true,
        data: [{ id: 61, name: "Lead In", pipeline_id: 8, order_nr: 1 }],
        additional_data: { next_cursor: null },
      },
      deals: {
        success: true,
        data: [{ id: 1, value: 100, status: "open", stage_id: 61, stage_name: "Explicit" }],
        additional_data: { next_cursor: null },
      },
    });
    const client = createPipedriveClient({
      apiToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [deal] = await client.fetchOpenDeals();
    expect(deal!.stageName).toBe("Explicit");
  });

  it("is resilient: a /stages failure leaves deals synced with a null stage name", async () => {
    const fetchImpl = routeFetch({
      stagesOk: false,
      stagesStatus: 500,
      deals: {
        success: true,
        data: [{ id: 1, value: 100, status: "open", stage_id: 61 }],
        additional_data: { next_cursor: null },
      },
    });
    const client = createPipedriveClient({
      apiToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const deals = await client.fetchOpenDeals();
    expect(deals).toHaveLength(1);
    expect(deals[0]!.stageName).toBeNull();
  });
});

describe("createPipedriveClient — person contact", () => {
  it("fetches one person without leaking the token in errors", async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
      jsonResponse({
        success: true,
        data: {
          name: "Pat Owner",
          email: [{ value: "owner@example.com", primary: true }],
          phone: [{ value: "(555) 867-5309", primary: true }],
        },
      }),
    );
    const client = createPipedriveClient({
      apiToken: "tok_secret",
      companyDomain: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.fetchPersonContact(7)).resolves.toEqual({
      firstName: "Pat",
      email: "owner@example.com",
      phone: "(555) 867-5309",
    });
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("https://acme.pipedrive.com/api/v1/persons/7");
    expect(url).toContain("api_token=tok_secret");

    const failingFetch = vi.fn().mockResolvedValue(jsonResponse({}, false, 403));
    const failingClient = createPipedriveClient({
      apiToken: "tok_secret",
      fetchImpl: failingFetch as unknown as typeof fetch,
    });
    await expect(failingClient.fetchPersonContact(8)).rejects.toMatchObject({
      name: "PipedriveError",
      status: 403,
    });
    await expect(failingClient.fetchPersonContact(8)).rejects.not.toThrow(/tok_secret/);
  });
});

// ── PSG-646: org names (fetch /api/v2/organizations + join onto deals) ────────────────
// v2 `/deals` returns `org_id` as a bare number with no org name; without this join the
// mirror stores orgName null and the recurring engine can't identify any account.
describe("createPipedriveClient — org names", () => {
  it("joins the org name onto a v2 deal that omits org_name (org_id is a bare number)", async () => {
    const fetchImpl = routeFetch({
      orgs: {
        success: true,
        data: [{ id: 1238, name: "Majestic Auto Body" }],
        additional_data: { next_cursor: null },
      },
      deals: {
        success: true,
        data: [{ id: 3534, value: 100, status: "won", org_id: 1238 }],
        additional_data: { next_cursor: null },
      },
    });
    const client = createPipedriveClient({
      apiToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [deal] = await client.fetchOpenDeals();
    expect(deal!.orgId).toBe(1238);
    expect(deal!.orgName).toBe("Majestic Auto Body");
  });

  it("does not overwrite an org_name the deal payload already carries (v1 nested)", async () => {
    const fetchImpl = routeFetch({
      orgs: {
        success: true,
        data: [{ id: 7, name: "From Orgs Endpoint" }],
        additional_data: { next_cursor: null },
      },
      deals: {
        success: true,
        data: [{ id: 1, value: 100, status: "open", org_id: { value: 7, name: "Bodyshop A" } }],
        additional_data: { next_cursor: null },
      },
    });
    const client = createPipedriveClient({
      apiToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [deal] = await client.fetchOpenDeals();
    expect(deal!.orgName).toBe("Bodyshop A");
  });

  it("paginates /api/v2/organizations across cursors when joining", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/v2/stages")) {
        return jsonResponse({ success: true, data: [], additional_data: { next_cursor: null } });
      }
      if (u.includes("/api/v2/organizations")) {
        if (u.includes("cursor=O2")) {
          return jsonResponse({
            success: true,
            data: [{ id: 8509, name: "Collision Leaders" }],
            additional_data: { next_cursor: null },
          });
        }
        return jsonResponse({
          success: true,
          data: [{ id: 1201, name: "LaMettry's Collision" }],
          additional_data: { next_cursor: "O2" },
        });
      }
      return jsonResponse({
        success: true,
        data: [{ id: 3663, value: 100, status: "won", org_id: 8509 }],
        additional_data: { next_cursor: null },
      });
    });
    const client = createPipedriveClient({
      apiToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [deal] = await client.fetchOpenDeals();
    expect(deal!.orgName).toBe("Collision Leaders");
    const orgUrls = fetchImpl.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/api/v2/organizations"));
    expect(orgUrls).toHaveLength(2);
  });

  it("is resilient: an /organizations failure leaves deals synced with a null org name", async () => {
    const fetchImpl = routeFetch({
      orgsOk: false,
      orgsStatus: 500,
      deals: {
        success: true,
        data: [{ id: 1, value: 100, status: "won", org_id: 1238 }],
        additional_data: { next_cursor: null },
      },
    });
    const client = createPipedriveClient({
      apiToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const deals = await client.fetchOpenDeals();
    expect(deals).toHaveLength(1);
    expect(deals[0]!.orgName).toBeNull();
  });
});
