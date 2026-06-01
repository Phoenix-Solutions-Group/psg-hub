import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Twilio SDK. The default export is a CALLABLE factory carrying attached
// helpers; the route uses twilio.validateRequest, so attach it to the callable.
const { validateRequest } = vi.hoisted(() => ({ validateRequest: vi.fn() }));
vi.mock("twilio", () => {
  const factory = vi.fn(() => ({ messages: { create: vi.fn() } }));
  return { default: Object.assign(factory, { validateRequest }) };
});

// Mock the service-role client (.from().upsert()).
const { upsert, from } = vi.hoisted(() => {
  const upsert = vi.fn();
  const from = vi.fn(() => ({ upsert }));
  return { upsert, from };
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from }),
}));

import { POST } from "@/app/api/webhooks/twilio/route";

const SIG = { "X-Twilio-Signature": "sig" };
// Matches vitest.setup.ts TWILIO_WEBHOOK_BASE_URL + the route path.
const SIGNED_URL = "https://test.psgweb.me/api/webhooks/twilio";

function makeRequest(
  form: Record<string, string>,
  headers: Record<string, string> = SIG
) {
  const body = new URLSearchParams(form).toString();
  return new Request("http://localhost/api/webhooks/twilio", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ error: null });
});

describe("POST /api/webhooks/twilio", () => {
  it("persists a status callback and returns 204", async () => {
    validateRequest.mockReturnValue(true);
    const form = {
      MessageSid: "SM1",
      MessageStatus: "delivered",
      From: "+15557122661",
      To: "+15558675310",
    };

    const res = await POST(makeRequest(form));

    expect(res.status).toBe(204);
    expect(from).toHaveBeenCalledWith("sms_events");
    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, opts] = upsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: "message_sid,status", ignoreDuplicates: true });
    expect(rows[0]).toMatchObject({
      message_sid: "SM1",
      status: "delivered",
      direction: "outbound",
      from_number: "+15557122661",
      to_number: "+15558675310",
      error_code: null,
    });

    // Signature verified against the ENV-reconstructed URL + the PARSED params.
    expect(validateRequest).toHaveBeenCalledWith(
      process.env.TWILIO_AUTH_TOKEN,
      "sig",
      SIGNED_URL,
      form
    );
  });

  it("persists an inbound message and returns 200 text/xml empty TwiML", async () => {
    validateRequest.mockReturnValue(true);
    const form = {
      MessageSid: "SM2",
      SmsStatus: "received",
      From: "+15558675310",
      To: "+15557122661",
      Body: "hello",
    };

    const res = await POST(makeRequest(form));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/xml");
    await expect(res.text()).resolves.toContain("<Response></Response>");
    const [rows] = upsert.mock.calls[0];
    expect(rows[0]).toMatchObject({
      message_sid: "SM2",
      status: "received",
      direction: "inbound",
    });
  });

  it("captures error_code on a failed status callback", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(
      makeRequest({ MessageSid: "SM3", MessageStatus: "undelivered", ErrorCode: "30003" })
    );
    expect(res.status).toBe(204);
    expect(upsert.mock.calls[0][0][0]).toMatchObject({
      status: "undelivered",
      error_code: 30003,
    });
  });

  it("rejects an invalid signature with 403 and does not write", async () => {
    validateRequest.mockReturnValue(false);
    const res = await POST(makeRequest({ MessageSid: "SM1", MessageStatus: "sent" }));
    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects when the X-Twilio-Signature header is missing (400, no verify, no write)", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(makeRequest({ MessageSid: "SM1", MessageStatus: "sent" }, {}));
    expect(res.status).toBe(400);
    expect(validateRequest).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a validly-signed request with no MessageSid (400, no write)", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(makeRequest({ MessageStatus: "sent" }));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("uses ignoreDuplicates so a replayed (message_sid, status) is idempotent", async () => {
    validateRequest.mockReturnValue(true);
    const form = { MessageSid: "SMdup", MessageStatus: "delivered" };

    await POST(makeRequest(form));
    await POST(makeRequest(form)); // Twilio retry of the same transition

    expect(upsert).toHaveBeenCalledTimes(2);
    for (const call of upsert.mock.calls) {
      expect(call[1]).toEqual({ onConflict: "message_sid,status", ignoreDuplicates: true });
    }
  });

  it("returns 500 when persistence fails so Twilio retries", async () => {
    validateRequest.mockReturnValue(true);
    upsert.mockResolvedValue({ error: { message: "db down" } });
    const res = await POST(makeRequest({ MessageSid: "SM1", MessageStatus: "delivered" }));
    expect(res.status).toBe(500);
  });

  it("fails closed with 500 when TWILIO_AUTH_TOKEN is unset", async () => {
    const original = process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_AUTH_TOKEN;
    try {
      const res = await POST(makeRequest({ MessageSid: "SM1", MessageStatus: "sent" }));
      expect(res.status).toBe(500);
      expect(validateRequest).not.toHaveBeenCalled();
    } finally {
      process.env.TWILIO_AUTH_TOKEN = original;
    }
  });

  it("fails closed with 500 when TWILIO_WEBHOOK_BASE_URL is unset", async () => {
    const original = process.env.TWILIO_WEBHOOK_BASE_URL;
    delete process.env.TWILIO_WEBHOOK_BASE_URL;
    try {
      const res = await POST(makeRequest({ MessageSid: "SM1", MessageStatus: "sent" }));
      expect(res.status).toBe(500);
      expect(validateRequest).not.toHaveBeenCalled();
    } finally {
      process.env.TWILIO_WEBHOOK_BASE_URL = original;
    }
  });

  it("preserves the query string when reconstructing the signed URL", async () => {
    // The query string is part of the HMAC; dropping it would 403 every
    // query-bearing webhook in production. Pin that `.search` survives.
    validateRequest.mockReturnValue(true);
    const req = new Request("http://localhost/api/webhooks/twilio?foo=bar", {
      method: "POST",
      body: new URLSearchParams({ MessageSid: "SM1", MessageStatus: "sent" }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...SIG },
    });

    await POST(req);

    expect(validateRequest).toHaveBeenCalledWith(
      process.env.TWILIO_AUTH_TOKEN,
      "sig",
      `${SIGNED_URL}?foo=bar`,
      { MessageSid: "SM1", MessageStatus: "sent" }
    );
  });

  it("tolerates a trailing slash in TWILIO_WEBHOOK_BASE_URL (no double slash)", async () => {
    validateRequest.mockReturnValue(true);
    const original = process.env.TWILIO_WEBHOOK_BASE_URL;
    process.env.TWILIO_WEBHOOK_BASE_URL = "https://test.psgweb.me/";
    try {
      await POST(makeRequest({ MessageSid: "SM1", MessageStatus: "sent" }));
      expect(validateRequest).toHaveBeenCalledWith(
        process.env.TWILIO_AUTH_TOKEN,
        "sig",
        SIGNED_URL, // single slash — the trailing slash was normalized away
        { MessageSid: "SM1", MessageStatus: "sent" }
      );
    } finally {
      process.env.TWILIO_WEBHOOK_BASE_URL = original;
    }
  });
});
