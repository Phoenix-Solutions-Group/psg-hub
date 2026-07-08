import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderReportPdf,
  type RenderHttpResponse,
  type RenderHttpPost,
} from "@/lib/report/render-client";
import { CircuitBreaker, CircuitOpenError } from "@/lib/resilience";

const SLUG = "11111111-1111-1111-1111-111111111111__2026-05";

function pdfResponse(bytes = [37, 80, 68, 70]): RenderHttpResponse {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}
function errorResponse(status = 500, body = ""): RenderHttpResponse {
  return {
    ok: false,
    status,
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => body,
  };
}

beforeEach(() => {
  process.env.REPORT_RENDER_URL = "https://render.example.com/render";
  process.env.RENDER_TOKEN = "test-render-token";
  process.env.NEXT_PUBLIC_APP_URL = "https://hub.psgweb.me";
});

describe("renderReportPdf", () => {
  it("POSTs the print URL to the worker with the RENDER_TOKEN bearer and returns PDF bytes", async () => {
    const httpPost = vi.fn<RenderHttpPost>(async () => pdfResponse());
    const bytes = await renderReportPdf(SLUG, { httpPost });

    expect(httpPost).toHaveBeenCalledTimes(1);
    const [url, init] = httpPost.mock.calls[0]!;
    expect(url).toBe("https://render.example.com/render");
    expect(init.headers.Authorization).toBe("Bearer test-render-token");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      url: "https://hub.psgweb.me/reports/" + SLUG + "/print",
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
  });

  it("retries a transient failure then succeeds (wrapped in withRetry)", async () => {
    const httpPost = vi
      .fn<RenderHttpPost>()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(pdfResponse());
    const bytes = await renderReportPdf(SLUG, {
      httpPost,
      retry: { sleep: async () => {} },
    });
    expect(httpPost).toHaveBeenCalledTimes(2);
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
  });

  it("trips the circuit breaker after repeated failure", async () => {
    const httpPost = vi.fn(async () => errorResponse(500, "render failed: page crashed"));
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    // first call: retries exhausted -> throws, breaker records the failure and opens
    await expect(
      renderReportPdf(SLUG, { httpPost, breaker, retry: { retries: 0 } })
    ).rejects.toThrow(/render worker responded 500: render failed: page crashed/);
    // second call: breaker is open -> fails fast without calling the transport
    httpPost.mockClear();
    await expect(
      renderReportPdf(SLUG, { httpPost, breaker, retry: { retries: 0 } })
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(httpPost).not.toHaveBeenCalled();
  });

  it("fails loud when required env is missing", async () => {
    delete process.env.REPORT_RENDER_URL;
    await expect(renderReportPdf(SLUG, { httpPost: vi.fn() })).rejects.toThrow(
      /missing required env REPORT_RENDER_URL/
    );
  });
});
