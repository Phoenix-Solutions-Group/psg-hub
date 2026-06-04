import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SendGrid SDK (default export = mail service instance).
// vi.hoisted keeps these initialized above the hoisted vi.mock factory.
const { send, setApiKey } = vi.hoisted(() => ({
  send: vi.fn(),
  setApiKey: vi.fn(),
}));
vi.mock("@sendgrid/mail", () => ({
  default: { send, setApiKey },
}));

import { createMailSender, isRetryableMailError } from "@/lib/mail/sendgrid";
import { CircuitBreaker } from "@/lib/resilience";

function sgResponse(statusCode = 202, messageId = "msg-123") {
  return [
    { statusCode, headers: { "x-message-id": messageId }, body: {} },
    {},
  ];
}

function sgError(code: number) {
  return Object.assign(new Error(`HTTP ${code}`), {
    code,
    response: { headers: {}, body: "" },
  });
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

describe("createMailSender / sendEmail", () => {
  it("sends and returns statusCode + messageId", async () => {
    send.mockResolvedValueOnce(sgResponse(202, "abc"));
    const sender = createMailSender({ retry: fastRetry });

    const result = await sender.send({
      to: "x@psgweb.me",
      from: "noreply@psgweb.me",
      subject: "Hi",
      html: "<p>hi</p>",
    });

    expect(result).toEqual({ statusCode: 202, messageId: "abc" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      to: "x@psgweb.me",
      from: "noreply@psgweb.me",
      subject: "Hi",
    });
  });

  it("defaults from to SENDGRID_FROM_EMAIL", async () => {
    send.mockResolvedValueOnce(sgResponse());
    const sender = createMailSender({ retry: fastRetry });

    await sender.send({ to: "x@psgweb.me", subject: "Hi", text: "hi" });

    expect(send.mock.calls[0][0].from).toBe(process.env.SENDGRID_FROM_EMAIL);
  });

  it("retries a transient 429 then succeeds", async () => {
    send
      .mockRejectedValueOnce(sgError(429))
      .mockResolvedValueOnce(sgResponse(202, "ok"));
    const sender = createMailSender({ retry: fastRetry });

    const result = await sender.send({
      to: "x@psgweb.me",
      from: "f@psgweb.me",
      subject: "s",
      text: "t",
    });

    expect(result.statusCode).toBe(202);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent 400 and surfaces a non-retryable MailError", async () => {
    send.mockRejectedValue(sgError(400));
    const sender = createMailSender({ retry: fastRetry });

    await expect(
      sender.send({ to: "x@psgweb.me", from: "f@psgweb.me", subject: "s", text: "t" })
    ).rejects.toMatchObject({
      name: "MailError",
      retryable: false,
      statusCode: 400,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fails fast with a retryable MailError once the circuit is open", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
      isFailure: isRetryableMailError,
      now: () => 0,
    });
    const sender = createMailSender({
      breaker,
      retry: { retries: 0, sleep: () => Promise.resolve() },
    });
    send.mockRejectedValue(sgError(500));

    // First call fails (500, transient) → trips the breaker.
    await expect(
      sender.send({ to: "x@psgweb.me", from: "f@psgweb.me", subject: "s", text: "t" })
    ).rejects.toMatchObject({ name: "MailError", retryable: true, statusCode: 500 });
    expect(send).toHaveBeenCalledTimes(1);

    // Second call short-circuits — send is NOT invoked again.
    await expect(
      sender.send({ to: "x@psgweb.me", from: "f@psgweb.me", subject: "s", text: "t" })
    ).rejects.toMatchObject({ name: "MailError", retryable: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("throws a non-retryable MailError when no from address is available", async () => {
    const original = process.env.SENDGRID_FROM_EMAIL;
    delete process.env.SENDGRID_FROM_EMAIL;
    try {
      const sender = createMailSender({ retry: fastRetry });
      await expect(
        sender.send({ to: "x@psgweb.me", subject: "s", text: "t" })
      ).rejects.toMatchObject({ name: "MailError", retryable: false });
      expect(send).not.toHaveBeenCalled();
    } finally {
      process.env.SENDGRID_FROM_EMAIL = original;
    }
  });
});

describe("isRetryableMailError", () => {
  it("treats 429 and 5xx as retryable, other 4xx as permanent", () => {
    expect(isRetryableMailError(sgError(429))).toBe(true);
    expect(isRetryableMailError(sgError(503))).toBe(true);
    expect(isRetryableMailError(sgError(400))).toBe(false);
    expect(isRetryableMailError(sgError(401))).toBe(false);
  });

  it("treats an unknown/network error (no numeric status) as retryable", () => {
    expect(isRetryableMailError(new Error("ECONNRESET"))).toBe(true);
  });
});
