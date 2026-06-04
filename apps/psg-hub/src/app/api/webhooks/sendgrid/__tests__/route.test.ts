import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SendGrid signature verifier.
const { verifySignature, convertPublicKeyToECDSA } = vi.hoisted(() => ({
  verifySignature: vi.fn(),
  convertPublicKeyToECDSA: vi.fn(() => ({})),
}));
vi.mock("@sendgrid/eventwebhook", () => ({
  // Must be constructable (`new EventWebhook()`) — use a function, not an arrow.
  EventWebhook: vi.fn(function () {
    return { convertPublicKeyToECDSA, verifySignature };
  }),
  EventWebhookHeader: {
    SIGNATURE: () => "X-Twilio-Email-Event-Webhook-Signature",
    TIMESTAMP: () => "X-Twilio-Email-Event-Webhook-Timestamp",
  },
}));

// Mock the service-role client (.from().upsert()).
const { upsert, from } = vi.hoisted(() => {
  const upsert = vi.fn();
  const from = vi.fn(() => ({ upsert }));
  return { upsert, from };
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import { POST } from "@/app/api/webhooks/sendgrid/route";

const DEFAULT_HEADERS = {
  "X-Twilio-Email-Event-Webhook-Signature": "sig",
  "X-Twilio-Email-Event-Webhook-Timestamp": "ts",
};

function makeRequest(body: string, headers: Record<string, string> = DEFAULT_HEADERS) {
  return new Request("http://localhost/api/webhooks/sendgrid", {
    method: "POST",
    body,
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ error: null });
});

describe("POST /api/webhooks/sendgrid", () => {
  it("persists events on a valid signature and returns 200", async () => {
    verifySignature.mockReturnValue(true);
    const body = JSON.stringify([
      { sg_event_id: "evt_1", sg_message_id: "msg_1", event: "delivered", email: "a@psgweb.me", timestamp: 1735689600 },
      { sg_event_id: "evt_2", event: "bounce", email: "b@psgweb.me", timestamp: 1735689601 },
    ]);

    const res = await POST(makeRequest(body));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(from).toHaveBeenCalledWith("email_events");
    expect(upsert).toHaveBeenCalledTimes(1);

    const [rows, opts] = upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: "sg_event_id", ignoreDuplicates: true });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sg_event_id: "evt_1",
      event: "delivered",
      email: "a@psgweb.me",
      message_id: "msg_1",
    });
    expect(rows[0].occurred_at).toBe(new Date(1735689600 * 1000).toISOString());
    expect(rows[1]).toMatchObject({ sg_event_id: "evt_2", message_id: null });
  });

  it("rejects an invalid signature with 400 and does not write", async () => {
    verifySignature.mockReturnValue(false);
    const res = await POST(makeRequest(JSON.stringify([{ sg_event_id: "x" }])));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects when signature/timestamp headers are missing", async () => {
    verifySignature.mockReturnValue(true);
    const res = await POST(makeRequest(JSON.stringify([{ sg_event_id: "x" }]), {}));
    expect(res.status).toBe(400);
    expect(verifySignature).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("uses ignoreDuplicates so a replayed sg_event_id is idempotent", async () => {
    verifySignature.mockReturnValue(true);
    const body = JSON.stringify([
      { sg_event_id: "evt_dupe", event: "open", email: "c@psgweb.me", timestamp: 1735689600 },
    ]);

    await POST(makeRequest(body));
    await POST(makeRequest(body)); // SendGrid replay

    expect(upsert).toHaveBeenCalledTimes(2);
    for (const call of upsert.mock.calls) {
      expect(call[1]).toEqual({ onConflict: "sg_event_id", ignoreDuplicates: true });
    }
  });

  it("returns 500 when persistence fails so SendGrid retries", async () => {
    verifySignature.mockReturnValue(true);
    upsert.mockResolvedValue({ error: { message: "db down" } });
    const res = await POST(
      makeRequest(JSON.stringify([{ sg_event_id: "evt_1", event: "delivered", email: "a@psgweb.me", timestamp: 1 }]))
    );
    expect(res.status).toBe(500);
  });

  it("skips events without sg_event_id (no write) and still returns 200", async () => {
    verifySignature.mockReturnValue(true);
    const res = await POST(makeRequest(JSON.stringify([{ event: "processed", email: "x@psgweb.me" }])));
    expect(res.status).toBe(200);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed JSON body", async () => {
    verifySignature.mockReturnValue(true);
    const res = await POST(makeRequest("not-json"));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});
