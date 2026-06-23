import { describe, it, expect, vi, beforeEach } from "vitest";

// twilio default export is a callable factory that ALSO carries .validateRequest.
const { validateRequest } = vi.hoisted(() => ({ validateRequest: vi.fn() }));
vi.mock("twilio", () => ({
  default: Object.assign(
    vi.fn(() => ({})),
    { validateRequest }
  ),
}));

// Fake solicitation store — capture recorded opt-out events.
const { recorded } = vi.hoisted(() => ({ recorded: [] as unknown[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/ops/solicitation/store", () => ({
  supabaseSolicitationStore: () => ({
    recordOptOutEvent: async (e: unknown) => {
      recorded.push(e);
    },
  }),
}));

import { POST } from "../route";

function smsRequest(params: Record<string, string>, sig = "good-sig") {
  const body = new URLSearchParams(params).toString();
  return new Request("https://hub.psgweb.me/api/sms/webhook", {
    method: "POST",
    headers: { "X-Twilio-Signature": sig, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  delete process.env.TWILIO_SMS_WEBHOOK_URL;
});

describe("POST /api/sms/webhook", () => {
  it("rejects an invalid Twilio signature (403), records nothing", async () => {
    validateRequest.mockReturnValue(false);
    const res = await POST(smsRequest({ From: "+15558675309", Body: "STOP", MessageSid: "SM1" }));
    expect(res.status).toBe(403);
    expect(recorded).toHaveLength(0);
  });

  it("records an opt-out on STOP (idempotency key = MessageSid)", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(smsRequest({ From: "+15558675309", Body: "Stop.", MessageSid: "SM-stop" }));
    expect(res.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      channel: "sms",
      state: "opted_out",
      reason: "sms_stop",
      source: "sms_webhook",
      event_ref: "sms:SM-stop",
    });
  });

  it("records an opt-IN on START", async () => {
    validateRequest.mockReturnValue(true);
    await POST(smsRequest({ From: "+15558675309", Body: "START", MessageSid: "SM-start" }));
    expect(recorded[0]).toMatchObject({ state: "opted_in", reason: "sms_start" });
  });

  it("answers HELP with an info reply and records nothing", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(smsRequest({ From: "+15558675309", Body: "HELP", MessageSid: "SM-h" }));
    const xml = await res.text();
    expect(xml).toContain("<Message>");
    expect(recorded).toHaveLength(0);
  });

  it("ignores an ordinary reply (no state change)", async () => {
    validateRequest.mockReturnValue(true);
    const res = await POST(smsRequest({ From: "+15558675309", Body: "thanks!", MessageSid: "SM-x" }));
    expect(res.status).toBe(200);
    expect(recorded).toHaveLength(0);
  });

  it("fails closed (500) when TWILIO_AUTH_TOKEN is unset", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await POST(smsRequest({ From: "+15558675309", Body: "STOP", MessageSid: "SM1" }));
    expect(res.status).toBe(500);
    expect(validateRequest).not.toHaveBeenCalled();
  });
});
