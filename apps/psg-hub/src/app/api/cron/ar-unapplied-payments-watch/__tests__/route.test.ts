import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { GET, POST } = await import("../route");

function req(method: "GET" | "POST" = "GET"): Request {
  return new Request("http://localhost/api/cron/ar-unapplied-payments-watch", {
    method,
    headers: { authorization: "Bearer cron-secret" },
  });
}

function sseResponse(payload: unknown, status = 200): Response {
  const body = `data: ${JSON.stringify({ result: payload })}\n`;
  return new Response(body, {
    status,
    headers: { "content-type": "application/json, text/event-stream" },
  });
}

function sseResponseWithDone(payload: unknown, status = 200): Response {
  const body = `data: ${JSON.stringify({ result: payload })}\ndata: [DONE]\n`;
  return new Response(body, {
    status,
    headers: { "content-type": "application/json, text/event-stream" },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("PAPERCLIP_API_URL", "https://paperclip.example");
  vi.stubEnv("PAPERCLIP_API_KEY", "paperclip-token");
  vi.stubEnv("PAPERCLIP_COMPANY_ID", "co-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron/ar-unapplied-payments-watch auth", () => {
  it("401 without Authorization and never calls MCP/Paperclip", async () => {
    const reqNoAuth = new Request("http://localhost/api/cron/ar-unapplied-payments-watch");
    const res = await GET(reqNoAuth);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401 with wrong Authorization and never calls MCP/Paperclip", async () => {
    const reqWrongAuth = new Request("http://localhost/api/cron/ar-unapplied-payments-watch", {
      headers: { authorization: "Bearer wrong" },
    });
    const res = await GET(reqWrongAuth);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cron/ar-unapplied-payments-watch data path", () => {
  it("posts today's loose-payment summary to PSG-478 and returns 200", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              CompanyInfo: { CompanyName: "Phoenix Solutions Group" },
            }),
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      sseResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              QueryResponse: {
                Payment: [{ UnappliedAmt: 1500.5 }, { UnappliedAmt: 0 }, { UnappliedAmt: "2750.25" }],
                maxResults: 1000,
                startPosition: 1,
              },
            }),
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: "issue-1", identifier: "PSG-478", status: "in_progress" }]),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "issue-1" }));

    const res = await GET(req());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.loosePaymentCount).toBe(2);
    expect(body.loosePaymentTotal).toBe(4250.75);
    expect(body.issue).toBe("PSG-478");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns 503 if the company mismatch is detected", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              CompanyInfo: { CompanyName: "Wrong Company" },
            }),
          },
        ],
      }),
    );

    const res = await POST(req("POST"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("qbo_company_mismatch");
    expect(body.expectedCompany).toBe("Phoenix Solutions Group");
    expect(body.actualCompany).toBe("Wrong Company");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("counts unapplied payments across paginated MCP pages and ignores DONE stream trailer", async () => {
    const firstPagePayments = Array.from({ length: 1000 }, () => ({ UnappliedAmt: 0 }));
    const secondPagePayments = [{ UnappliedAmt: "4.12" }, { UnappliedAmt: "3.00" }];

    fetchMock.mockResolvedValueOnce(
      sseResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              CompanyInfo: { CompanyName: "Phoenix Solutions Group" },
            }),
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      sseResponseWithDone({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              QueryResponse: {
                Payment: firstPagePayments,
                maxResults: "1000",
                startPosition: "1",
              },
            }),
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      sseResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              QueryResponse: {
                Payment: secondPagePayments,
                maxResults: 1000,
                startPosition: "1001",
              },
            }),
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "issue-1", identifier: "PSG-478" }]));
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "issue-1" }));

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.loosePaymentCount).toBe(2);
    expect(body.loosePaymentTotal).toBe(7.12);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
