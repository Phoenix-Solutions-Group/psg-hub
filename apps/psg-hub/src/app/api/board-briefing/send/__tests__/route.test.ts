import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
vi.mock("@/lib/mail/sendgrid", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

import { POST } from "../route";

function req(body: unknown, auth?: string): Request {
  return new Request("http://localhost/api/board-briefing/send", {
    method: "POST",
    headers: {
      ...(auth ? { authorization: auth } : {}),
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue({ statusCode: 202, messageId: "msg-1" });
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("SENDGRID_FROM_EMAIL", "ops@psgweb.me");
  vi.stubEnv("BOARD_BRIEFING_RECIPIENTS", "nick@example.com, board@example.com");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/board-briefing/send auth", () => {
  it("401 without Authorization header and never sends email", async () => {
    const res = await POST(req({ body: "Brief", briefingUrl: "https://paperclip.example/doc" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("401 with the wrong secret and never sends email", async () => {
    const res = await POST(req({ body: "Brief", briefingUrl: "https://paperclip.example/doc" }, "Bearer wrong"));

    expect(res.status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(req({ body: "Brief", briefingUrl: "https://paperclip.example/doc" }, "Bearer cron-secret"));

    expect(res.status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/board-briefing/send payload handling", () => {
  it("400 on invalid JSON and never sends email", async () => {
    const res = await POST(req("{not-json", "Bearer cron-secret"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["body", { briefingUrl: "https://paperclip.example/doc" }],
    ["briefingUrl", { body: "Brief" }],
  ])("400 when required pushed field %s is missing", async (_field, payload) => {
    const res = await POST(req(payload, "Bearer cron-secret"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_payload" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("503 when board recipients are not configured", async () => {
    vi.stubEnv("BOARD_BRIEFING_RECIPIENTS", "");
    const res = await POST(req({ body: "Brief", briefingUrl: "https://paperclip.example/doc" }, "Bearer cron-secret"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "board_briefing_not_configured" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/board-briefing/send happy path", () => {
  it("sends the pushed briefing through the existing mail adapter", async () => {
    const res = await POST(
      req(
        {
          body: "Revenue is up.\nNo blockers.",
          briefingUrl: "https://paperclip.example/PSG/issues/PSG-209#document-daily-briefing",
          subject: "Daily board briefing",
          generatedAt: "2026-07-09T12:00:00Z",
        },
        "Bearer cron-secret",
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recipientCount: 2, messageId: "msg-1" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["nick@example.com", "board@example.com"],
        from: "ops@psgweb.me",
        subject: "Daily board briefing",
        clickTracking: false,
      }),
    );
    const message = sendEmail.mock.calls[0]![0] as { html: string; text: string };
    expect(message.text).toContain("Revenue is up.");
    expect(message.text).toContain("https://paperclip.example/PSG/issues/PSG-209#document-daily-briefing");
    expect(message.html).toContain("Revenue is up.<br>No blockers.");
  });
});
