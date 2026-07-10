import { describe, it, expect, vi } from "vitest";
import {
  LobAdapter,
  mapLobStatus,
  mapLobDeliverability,
  isRetryableLobStatus,
} from "@/lib/production/lob";
import { MailProductionError, type MailDocument } from "@/lib/production/types";
import { CircuitBreaker } from "@/lib/resilience";

// Fast, deterministic retry seam (no real backoff sleeps).
const fastRetry = { retries: 2, baseDelayMs: 0, sleep: async () => {}, jitter: () => 0 };

/** Recover the vitest mock surface from a fetch impl cast to `typeof fetch`. */
function mockOf(fn: typeof fetch): { mock: { calls: unknown[][] } } {
  return fn as unknown as { mock: { calls: unknown[][] } };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeAdapter(fetchImpl: typeof fetch) {
  return new LobAdapter({
    fetchImpl,
    apiKey: "test_key",
    retry: fastRetry,
    breaker: new CircuitBreaker({
      failureThreshold: 5,
      isFailure: (e) => (e instanceof MailProductionError ? e.retryable : true),
    }),
  });
}

const TO = {
  name: "Jane Customer",
  addressLine1: "210 King St",
  city: "San Francisco",
  state: "CA",
  zip: "94107",
};
const FROM = {
  name: "PSG Body Shop",
  addressLine1: "1 Shop Way",
  city: "Phoenix",
  state: "AZ",
  zip: "85001",
};

describe("mapLobStatus", () => {
  it("maps event_type ids and bare names onto canonical statuses", () => {
    expect(mapLobStatus("postcard.delivered")).toBe("delivered");
    expect(mapLobStatus("letter.in_transit")).toBe("in_transit");
    expect(mapLobStatus("postcard.rendered_pdf")).toBe("rendered");
    expect(mapLobStatus("processed_for_delivery")).toBe("processed_for_delivery");
    expect(mapLobStatus("postcard.re-routed")).toBe("re_routed");
    expect(mapLobStatus("letter.deleted")).toBe("cancelled");
    expect(mapLobStatus("something_new")).toBe("unknown");
    expect(mapLobStatus(null)).toBe("unknown");
  });
});

describe("mapLobDeliverability", () => {
  it("collapses Lob deliverability into the canonical set", () => {
    expect(mapLobDeliverability("deliverable")).toBe("deliverable");
    expect(mapLobDeliverability("deliverable_incorrect_unit")).toBe(
      "deliverable_with_unit_correction"
    );
    expect(mapLobDeliverability("deliverable_missing_unit")).toBe("deliverable_missing_unit");
    expect(mapLobDeliverability("undeliverable")).toBe("undeliverable");
    expect(mapLobDeliverability(undefined)).toBe("unknown");
  });
});

describe("isRetryableLobStatus", () => {
  it("treats 429/5xx and network (undefined) as retryable, 4xx as not", () => {
    expect(isRetryableLobStatus(429)).toBe(true);
    expect(isRetryableLobStatus(503)).toBe(true);
    expect(isRetryableLobStatus(undefined)).toBe(true);
    expect(isRetryableLobStatus(422)).toBe(false);
    expect(isRetryableLobStatus(401)).toBe(false);
  });
});

describe("LobAdapter.verifyAddress", () => {
  it("returns deliverable + normalized address on a clean verify", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        deliverability: "deliverable",
        primary_line: "210 KING ST",
        components: { city: "SAN FRANCISCO", state: "CA", zip_code: "94107" },
      })
    ) as unknown as typeof fetch;

    const adapter = makeAdapter(fetchImpl);
    const result = await adapter.verifyAddress(TO);

    expect(result.deliverability).toBe("deliverable");
    expect(result.deliverable).toBe(true);
    expect(result.normalized?.addressLine1).toBe("210 KING ST");
    expect(result.normalized?.city).toBe("SAN FRANCISCO");

    // Verification hits us_verifications with primary_line/zip_code form fields.
    const [, init] = mockOf(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("primary_line=210+King+St");
    expect(String(init.body)).toContain("zip_code=94107");
  });

  it("flags undeliverable as not deliverable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { deliverability: "undeliverable" })
    ) as unknown as typeof fetch;
    const result = await makeAdapter(fetchImpl).verifyAddress(TO);
    expect(result.deliverable).toBe(false);
    expect(result.deliverability).toBe("undeliverable");
  });
});

describe("LobAdapter.submit", () => {
  it("submits a postcard with to/from + idempotency key and maps the result", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: "psc_abc123",
        expected_delivery_date: "2026-07-01",
        url: "https://lob-assets.test/psc_abc123.pdf",
      })
    ) as unknown as typeof fetch;

    const adapter = makeAdapter(fetchImpl);
    const doc: MailDocument = {
      documentId: "doc-1",
      pieceType: "postcard",
      to: TO,
      from: FROM,
      front: "<html>front</html>",
      back: "<html>back</html>",
      size: "6x9",
      metadata: { batchId: "batch-9" },
    };
    const result = await adapter.submit(doc);

    expect(result.vendor).toBe("lob");
    expect(result.externalId).toBe("psc_abc123");
    expect(result.status).toBe("created");
    expect(result.expectedDeliveryDate).toBe("2026-07-01");
    expect(result.proofUrl).toContain("psc_abc123");

    const [url, init] = mockOf(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/postcards");
    // documentId becomes the Lob Idempotency-Key (no double-mail on retry).
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("doc-1");
    const body = String(init.body);
    expect(body).toContain("to%5Bname%5D=Jane+Customer");
    expect(body).toContain("from%5Baddress_state%5D=AZ");
    expect(body).toContain("front=%3Chtml%3Efront%3C%2Fhtml%3E");
    expect(body).toContain("back=%3Chtml%3Eback%3C%2Fhtml%3E");
    expect(body).toContain("size=6x9");
    expect(body).toContain("metadata%5BbatchId%5D=batch-9");
  });

  it("submits a letter to the letters endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { id: "ltr_xyz", expected_delivery_date: "2026-07-02" })
    ) as unknown as typeof fetch;

    const adapter = makeAdapter(fetchImpl);
    const result = await adapter.submit({
      documentId: "doc-2",
      pieceType: "letter",
      to: TO,
      from: FROM,
      file: "https://assets.test/letter.pdf",
      color: true,
    });

    expect(result.externalId).toBe("ltr_xyz");
    const [url, init] = mockOf(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/letters");
    expect(String(init.body)).toContain("color=true");
  });

  it("submits a self_mailer to the letters endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        id: "ltr_self1",
        expected_delivery_date: "2026-07-03",
      })
    ) as unknown as typeof fetch;

    const adapter = makeAdapter(fetchImpl);
    const result = await adapter.submit({
      documentId: "doc-self-1",
      pieceType: "self_mailer",
      to: TO,
      from: FROM,
      file: "https://assets.test/self-mailer.pdf",
      size: "8.5x11",
      color: true,
    });

    expect(result.externalId).toBe("ltr_self1");
    const [url, init] = mockOf(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/letters");
    const body = String(init.body);
    expect(body).not.toContain("size=");
    expect(body).toContain("color=true");
    expect(body).toContain("address_placement=top_first_page");
    expect(body).toContain("use_type=marketing");
  });

  it("retries transient 503 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: "upstream" } }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "psc_ok" })) as unknown as typeof fetch;

    const adapter = makeAdapter(fetchImpl);
    const result = await adapter.submit({
      documentId: "doc-3",
      pieceType: "postcard",
      to: TO,
      from: FROM,
    });
    expect(result.externalId).toBe("psc_ok");
    expect(mockOf(fetchImpl).mock.calls.length).toBe(2);
  });

  it("does not retry a 422 and surfaces the Lob error message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(422, { error: { message: "front is required" } })
    ) as unknown as typeof fetch;

    const adapter = makeAdapter(fetchImpl);
    await expect(
      adapter.submit({ documentId: "doc-4", pieceType: "postcard", to: TO, from: FROM })
    ).rejects.toMatchObject({ retryable: false, statusCode: 422, message: "front is required" });
    // Exactly one call — a permanent error is not retried.
    expect(mockOf(fetchImpl).mock.calls.length).toBe(1);
  });
});

describe("LobAdapter.cancel", () => {
  it("DELETEs the letters collection for an ltr_ id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { id: "ltr_1", deleted: true })
    ) as unknown as typeof fetch;
    await makeAdapter(fetchImpl).cancel("ltr_1");
    const [url, init] = mockOf(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/letters/ltr_1");
    expect(init.method).toBe("DELETE");
  });
});
