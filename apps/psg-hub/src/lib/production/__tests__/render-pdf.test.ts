import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderMailPdf,
  type RenderHttpResponse,
  type RenderHttpPost,
} from "@/lib/production/render-pdf";
import { CircuitBreaker } from "@/lib/resilience";

const fastRetry = { retries: 2, baseDelayMs: 0, sleep: async () => {}, jitter: () => 0 };

function pdfResponse(status: number, bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])): RenderHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.buffer.slice(0),
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.MAIL_RENDER_URL = "https://worker.psgweb.me/render";
  process.env.RENDER_TOKEN = "tok_test";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("renderMailPdf", () => {
  it("POSTs the html to the worker with a bearer token and returns the bytes", async () => {
    const httpPost = vi.fn<RenderHttpPost>(async () => pdfResponse(200));
    const out = await renderMailPdf("<html>hi</html>", { httpPost, retry: fastRetry });

    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(4);
    expect(httpPost).toHaveBeenCalledTimes(1);
    const [url, init] = httpPost.mock.calls[0];
    expect(url).toBe("https://worker.psgweb.me/render");
    expect(init.headers.Authorization).toBe("Bearer tok_test");
    expect(JSON.parse(init.body)).toEqual({ html: "<html>hi</html>" });
  });

  it("retries a transient worker failure then succeeds", async () => {
    const httpPost = vi
      .fn()
      .mockResolvedValueOnce(pdfResponse(503))
      .mockResolvedValueOnce(pdfResponse(200));
    const out = await renderMailPdf("<html/>", {
      httpPost,
      retry: fastRetry,
      breaker: new CircuitBreaker({ failureThreshold: 5 }),
    });
    expect(out.length).toBe(4);
    expect(httpPost).toHaveBeenCalledTimes(2);
  });

  it("throws when a required env var is missing", async () => {
    delete process.env.MAIL_RENDER_URL;
    await expect(renderMailPdf("<html/>", { retry: fastRetry })).rejects.toThrow(
      /MAIL_RENDER_URL/
    );
  });
});
