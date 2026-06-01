import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Twilio SDK. The default export is BOTH the client factory (callable)
// AND carries attached helpers (.validateRequest, .RestException). So the mock's
// default must be a CALLABLE function with the client shape it returns — not a
// plain object. (The 03-01 "constructable mock" lesson, applied to a
// callable-with-attached-props default export.)
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("twilio", () => {
  const factory = vi.fn(() => ({ messages: { create } }));
  return { default: factory };
});

import { createSmsSender, isRetryableTwilioError } from "@/lib/sms/twilio";
import { CircuitBreaker } from "@/lib/resilience";

function twilioMessage(status = "queued", sid = "SMxxxx") {
  return { sid, status, errorCode: null };
}

// Mirror the SDK's RestException shape minimally: the HTTP status lives in
// `.status` (NOT `.code`, which is the Twilio vendor error code). The adapter's
// structural statusOf reads `.status`, so a plain object suffices here.
function twilioError(status: number, code = 0) {
  return Object.assign(new Error(`HTTP ${status}`), { status, code });
}

// Fast, deterministic retry seam for the adapter under test.
const fastRetry = {
  retries: 3,
  baseDelayMs: 1,
  sleep: () => Promise.resolve(),
  jitter: () => 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSmsSender / sendSms", () => {
  it("sends via the Messaging Service and returns sid + status", async () => {
    create.mockResolvedValueOnce(twilioMessage("queued", "SM1"));
    const sender = createSmsSender({ retry: fastRetry });

    const result = await sender.send({ to: "+15558675310", body: "hi" });

    expect(result).toEqual({ sid: "SM1", status: "queued", errorCode: null });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      to: "+15558675310",
      body: "hi",
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
    });
  });

  it("retries a transient 500 then succeeds", async () => {
    create
      .mockRejectedValueOnce(twilioError(500))
      .mockResolvedValueOnce(twilioMessage("sent", "SM2"));
    const sender = createSmsSender({ retry: fastRetry });

    const result = await sender.send({ to: "+15558675310", body: "x" });

    expect(result.sid).toBe("SM2");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent 400 (e.g. code 21211) and surfaces a non-retryable SmsError", async () => {
    create.mockRejectedValue(twilioError(400, 21211));
    const sender = createSmsSender({ retry: fastRetry });

    await expect(
      sender.send({ to: "+15558675310", body: "x" })
    ).rejects.toMatchObject({
      name: "SmsError",
      retryable: false,
      statusCode: 400,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fails fast with a retryable SmsError once the circuit is open", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
      isFailure: isRetryableTwilioError,
      now: () => 0,
    });
    const sender = createSmsSender({
      breaker,
      retry: { retries: 0, sleep: () => Promise.resolve() },
    });
    create.mockRejectedValue(twilioError(500));

    // First call fails (500, transient) → trips the breaker.
    await expect(
      sender.send({ to: "+15558675310", body: "x" })
    ).rejects.toMatchObject({ name: "SmsError", retryable: true, statusCode: 500 });
    expect(create).toHaveBeenCalledTimes(1);

    // Second call short-circuits — create is NOT invoked again.
    await expect(
      sender.send({ to: "+15558675310", body: "x" })
    ).rejects.toMatchObject({ name: "SmsError", retryable: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("throws a non-retryable SmsError when no sender is configured", async () => {
    const svc = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const num = process.env.TWILIO_PHONE_NUMBER;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    delete process.env.TWILIO_PHONE_NUMBER;
    try {
      const sender = createSmsSender({ retry: fastRetry });
      await expect(
        sender.send({ to: "+15558675310", body: "x" })
      ).rejects.toMatchObject({ name: "SmsError", retryable: false });
      expect(create).not.toHaveBeenCalled();
    } finally {
      if (svc !== undefined) process.env.TWILIO_MESSAGING_SERVICE_SID = svc;
      if (num !== undefined) process.env.TWILIO_PHONE_NUMBER = num;
    }
  });
});

describe("isRetryableTwilioError", () => {
  it("treats 429 and 5xx as retryable, other 4xx as permanent", () => {
    expect(isRetryableTwilioError(twilioError(429))).toBe(true);
    expect(isRetryableTwilioError(twilioError(503))).toBe(true);
    expect(isRetryableTwilioError(twilioError(400))).toBe(false);
    expect(isRetryableTwilioError(twilioError(401))).toBe(false);
  });

  it("treats an unknown/network error (no numeric status) as retryable", () => {
    expect(isRetryableTwilioError(new Error("ECONNRESET"))).toBe(true);
  });
});
