import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  constructEvent,
  claim,
  from,
  subsUpsert,
  invoiceUpdate,
  invoiceEq,
  membership,
} = vi.hoisted(() => {
  const constructEvent = vi.fn();
  const claim = vi.fn();
  const subsUpsert = vi.fn();
  const invoiceUpdate = vi.fn();
  const invoiceEq = vi.fn();
  const membership = vi.fn();
  const from = vi.fn((table: string) => {
    switch (table) {
      case "stripe_events":
        return { upsert: () => ({ select: () => Promise.resolve(claim()) }) };
      case "subscriptions":
        return {
          upsert: (...a: unknown[]) => {
            subsUpsert(...a);
            return Promise.resolve({ error: null });
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      case "shops":
        return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      case "shop_users":
        return {
          select: () => ({ eq: () => ({ limit: () => ({ single: membership }) }) }),
        };
      case "invoices":
        return {
          update: (...a: unknown[]) => {
            invoiceUpdate(...a);
            return {
              eq: (...e: unknown[]) => {
                invoiceEq(...e);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      default:
        throw new Error(`unexpected table ${table}`);
    }
  });
  return { constructEvent, claim, from, subsUpsert, invoiceUpdate, invoiceEq, membership };
});

vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ webhooks: { constructEvent } }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from }) }));

import { POST } from "@/app/api/webhooks/stripe/route";

function makeRequest() {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "sig" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec";
  // Default: the event id is newly claimed (not a duplicate).
  claim.mockResolvedValue({ data: [{ event_id: "evt_1" }], error: null });
  membership.mockResolvedValue({ data: { shop_id: "shop-1" } });
});

describe("POST /api/webhooks/stripe", () => {
  it("returns 400 on an invalid signature", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("bad sig");
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("short-circuits a duplicate event (idempotent, no reprocessing)", async () => {
    claim.mockResolvedValue({ data: [], error: null }); // ignoreDuplicates inserted nothing
    constructEvent.mockReturnValue({
      id: "evt_dupe",
      type: "checkout.session.completed",
      data: { object: { metadata: { invoice_id: "inv-1" }, mode: "payment" } },
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ duplicate: true });
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it("marks an invoice paid on a one-off checkout.session.completed", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_123",
          mode: "payment",
          payment_intent: "pi_123",
          metadata: { invoice_id: "inv-1" },
        },
      },
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(invoiceUpdate).toHaveBeenCalledTimes(1);
    expect(invoiceUpdate.mock.calls[0][0]).toMatchObject({
      status: "paid",
      stripe_payment_intent_id: "pi_123",
      stripe_checkout_session_id: "cs_123",
    });
    expect(invoiceEq).toHaveBeenCalledWith("id", "inv-1");
    expect(subsUpsert).not.toHaveBeenCalled(); // not a subscription
  });

  it("marks an invoice paid on payment_intent.succeeded", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_999", metadata: { invoice_id: "inv-9" } } },
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(invoiceUpdate.mock.calls[0][0]).toMatchObject({ status: "paid" });
    expect(invoiceEq).toHaveBeenCalledWith("id", "inv-9");
  });

  it("UPSERTs the subscription (S3 fix) on a subscription checkout", async () => {
    constructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { user_id: "user-1", tier: "growth" },
        },
      },
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(subsUpsert).toHaveBeenCalledTimes(1);
    const [row, opts] = subsUpsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: "stripe_subscription_id" });
    expect(row).toMatchObject({
      shop_id: "shop-1",
      stripe_subscription_id: "sub_1",
      tier: "growth",
      status: "active",
    });
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });
});
