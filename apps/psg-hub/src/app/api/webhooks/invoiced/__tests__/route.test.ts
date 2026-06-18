import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// Mocked service-role client. `from(table)` dispatches per table so we can assert the
// idempotency ledger upsert + the invoices upsert independently.
const { eventsUpsert, invoicesUpsert, mapMaybeSingle, from } = vi.hoisted(() => {
  const eventsUpsert = vi.fn();
  const invoicesUpsert = vi.fn();
  const mapMaybeSingle = vi.fn();
  const from = vi.fn((table: string) => {
    if (table === "invoiced_events") {
      return {
        upsert: (...args: unknown[]) => {
          eventsUpsert(...args);
          return { select: () => Promise.resolve({ data: [{ event_id: "x" }], error: null }) };
        },
      };
    }
    if (table === "invoiced_customer_map") {
      return { select: () => ({ eq: () => ({ maybeSingle: mapMaybeSingle }) }) };
    }
    if (table === "invoices") {
      return {
        upsert: (...args: unknown[]) => {
          invoicesUpsert(...args);
          return Promise.resolve({ error: null });
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { eventsUpsert, invoicesUpsert, mapMaybeSingle, from };
});

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from }) }));

import { POST } from "@/app/api/webhooks/invoiced/route";

const SECRET = "whsec_test";
const HEADER = "x-invoiced-signature";

function sign(body: string) {
  return crypto.createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}
function makeRequest(body: string, signature = sign(body)) {
  return new Request("http://localhost/api/webhooks/invoiced", {
    method: "POST",
    body,
    headers: { [HEADER]: signature },
  });
}

const INVOICE_EVENT = JSON.stringify({
  id: "event_1",
  type: "invoice.updated",
  object: {
    id: 42,
    number: "INV-0042",
    total: 250,
    currency: "USD",
    status: "sent",
    customer: { id: 9, name: "Wallace Collision" },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INVOICED_WEBHOOK_SECRET = SECRET;
  delete process.env.INVOICED_WEBHOOK_HEADER;
  mapMaybeSingle.mockResolvedValue({ data: { shop_id: "shop-1" } });
});

describe("POST /api/webhooks/invoiced", () => {
  it("mirrors an invoice on a valid signature and returns 200", async () => {
    const res = await POST(makeRequest(INVOICE_EVENT));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });

    // Ledger uses ignoreDuplicates for replay-safety.
    const [, ledgerOpts] = eventsUpsert.mock.calls[0];
    expect(ledgerOpts).toEqual({ onConflict: "event_id", ignoreDuplicates: true });

    // Invoice upserted by external_id, attributed to the mapped shop.
    const [row, opts] = invoicesUpsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: "external_id" });
    expect(row).toMatchObject({
      shop_id: "shop-1",
      external_id: "42",
      number: "INV-0042",
      amount_cents: 25000,
      status: "open",
    });
  });

  it("rejects an invalid signature with 400 and does not write", async () => {
    const res = await POST(makeRequest(INVOICE_EVENT, "deadbeef"));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 500 when the secret is not configured", async () => {
    delete process.env.INVOICED_WEBHOOK_SECRET;
    const res = await POST(makeRequest(INVOICE_EVENT));
    expect(res.status).toBe(500);
    expect(from).not.toHaveBeenCalled();
  });

  it("is idempotent: a replayed event upserts by external_id both times", async () => {
    await POST(makeRequest(INVOICE_EVENT));
    await POST(makeRequest(INVOICE_EVENT)); // Invoiced replay
    expect(invoicesUpsert).toHaveBeenCalledTimes(2);
    for (const call of invoicesUpsert.mock.calls) {
      expect(call[1]).toEqual({ onConflict: "external_id" });
      expect(call[0]).toMatchObject({ external_id: "42" });
    }
  });

  it("honors a per-invoice metadata.shop_id override (no map lookup)", async () => {
    const body = JSON.stringify({
      id: "event_2",
      type: "invoice.created",
      object: { id: 7, total: 10, status: "sent", metadata: { shop_id: "shop-override" } },
    });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mapMaybeSingle).not.toHaveBeenCalled();
    expect(invoicesUpsert.mock.calls[0][0]).toMatchObject({ shop_id: "shop-override" });
  });

  it("records the event but skips the invoice when the customer is unmapped", async () => {
    mapMaybeSingle.mockResolvedValue({ data: null });
    const res = await POST(makeRequest(INVOICE_EVENT));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ skipped: "unmapped_customer" });
    expect(eventsUpsert).toHaveBeenCalledTimes(1); // ledger recorded
    expect(invoicesUpsert).not.toHaveBeenCalled(); // but no attribution
  });

  it("records the ledger and returns 200 for a non-invoice event", async () => {
    const body = JSON.stringify({ id: "event_3", type: "customer.created" });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(eventsUpsert).toHaveBeenCalledTimes(1);
    expect(invoicesUpsert).not.toHaveBeenCalled();
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await POST(makeRequest("not-json"));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
