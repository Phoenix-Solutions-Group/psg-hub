import { describe, it, expect, vi } from "vitest";
import {
  createPipedriveClient,
  mapRawDeal,
  pipedriveBaseUrl,
  PipedriveError,
} from "../client";

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
