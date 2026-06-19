import { describe, it, expect, vi } from "vitest";
import { runMutation } from "../client";

// A minimal Response-like stub so we don't depend on the runtime's fetch/Response.
function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const BODY = {
  mutationKey: "google_ads.negative_keywords",
  targetRef: "123-456-7890",
  params: { campaign_id: 1, negatives: [] },
};

describe("runMutation", () => {
  it("posts to the dry-run endpoint with mode owned by the route (no mode in body)", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      res(200, { result: { jobId: "j1", before: {}, requestedChanges: {}, after: {} } })
    );
    await runMutation("dry-run", BODY, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/ads-mutations/dry-run");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).not.toHaveProperty("mode");
  });

  it("uses the execute endpoint for execute mode", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      res(200, { result: { jobId: "j2", before: {}, requestedChanges: {}, after: {} } })
    );
    await runMutation("execute", BODY, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/ads-mutations/execute");
  });

  it("maps a 200 to { ok, result }", async () => {
    const result = { jobId: "job-9", before: { a: 1 }, requestedChanges: {}, after: { a: 2 } };
    const out = await runMutation("dry-run", BODY, async () => res(200, { result }));
    expect(out).toEqual({ status: "ok", result });
  });

  it("maps a 503 gated response to { gated, message }", async () => {
    const out = await runMutation("dry-run", BODY, async () =>
      res(503, { error: "Vercel Sandbox is not enabled", gated: true })
    );
    expect(out.status).toBe("gated");
    if (out.status === "gated") expect(out.message).toContain("Sandbox");
  });

  it("does NOT treat a 503 without gated:true as gated", async () => {
    const out = await runMutation("dry-run", BODY, async () => res(503, { error: "upstream down" }));
    expect(out.status).toBe("error");
  });

  it("maps a 422 to { invalid } with detail", async () => {
    const out = await runMutation("dry-run", BODY, async () =>
      res(422, { error: "Governance failed", errors: ["Target required"] })
    );
    expect(out.status).toBe("invalid");
    if (out.status === "invalid") expect(out.detail).toEqual(["Target required"]);
  });

  it("maps a 429 to { rate_limited }", async () => {
    const out = await runMutation("execute", BODY, async () =>
      res(429, { error: "Rate limit exceeded", scope: "target", limit: 5 })
    );
    expect(out.status).toBe("rate_limited");
  });

  it("maps a thrown fetch (network failure) to { error }", async () => {
    const out = await runMutation("dry-run", BODY, async () => {
      throw new Error("Failed to fetch");
    });
    expect(out).toEqual({ status: "error", message: "Failed to fetch" });
  });

  it("falls back to a default message when the body is not JSON", async () => {
    const out = await runMutation("dry-run", BODY, async () =>
      ({ ok: false, status: 500, json: async () => { throw new Error("not json"); } } as unknown as Response)
    );
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.message).toContain("500");
  });
});
