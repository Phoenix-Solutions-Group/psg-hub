import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailError } from "@/lib/mail/types";

const sendEmail = vi.fn();
const claimBoardBriefingOutbox = vi.fn();
const markBoardBriefingOutboxSent = vi.fn();
const service = { __service: true };

vi.mock("@/lib/mail/sendgrid", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(() => service) }));
vi.mock("@/lib/board-briefing/outbox", () => ({
  claimBoardBriefingOutbox: (...args: unknown[]) => claimBoardBriefingOutbox(...args),
  markBoardBriefingOutboxSent: (...args: unknown[]) => markBoardBriefingOutboxSent(...args),
}));

import { GET, POST } from "../route";

function req(auth?: string): Request {
  return new Request("http://localhost/api/cron/board-briefing-email", {
    method: "GET",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue({ statusCode: 202, messageId: "msg-1" });
  claimBoardBriefingOutbox.mockReset().mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    briefingDate: "2026-07-09",
    subject: "Daily board briefing",
    bodyMarkdown: "Revenue is up.\nNo blockers.",
    briefingUrl: "https://paperclip.example/PSG/issues/PSG-209#document-daily-briefing",
    generatedAt: "2026-07-09T12:00:00Z",
  });
  markBoardBriefingOutboxSent.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("SENDGRID_FROM_EMAIL", "ops@psgweb.me");
  vi.stubEnv("BOARD_BRIEFING_RECIPIENTS", "nick@example.com");
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/board-briefing-email auth", () => {
  it("401 without Authorization and does not read the outbox", async () => {
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(claimBoardBriefingOutbox).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("401 with the wrong secret", async () => {
    const res = await GET(req("Bearer wrong"));

    expect(res.status).toBe(401);
    expect(claimBoardBriefingOutbox).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const res = await GET(req("Bearer cron-secret"));

    expect(res.status).toBe(401);
    expect(claimBoardBriefingOutbox).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/board-briefing-email delivery", () => {
  it("returns 503 when no staged briefing is ready and never sends a blank email", async () => {
    claimBoardBriefingOutbox.mockResolvedValue(null);

    const res = await GET(req("Bearer cron-secret"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "no_board_briefing_ready" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(markBoardBriefingOutboxSent).not.toHaveBeenCalled();
  });

  it("sends the freshest claimed briefing and marks that claim sent", async () => {
    const res = await GET(req("Bearer cron-secret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      briefingDate: "2026-07-09",
      recipientCount: 1,
      messageId: "msg-1",
    });
    expect(claimBoardBriefingOutbox).toHaveBeenCalledWith(
      service,
      expect.objectContaining({ claimToken: expect.any(String) }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["nick@example.com"],
        from: "ops@psgweb.me",
        subject: "Daily board briefing",
        clickTracking: false,
      }),
    );
    const claimToken = claimBoardBriefingOutbox.mock.calls[0]![1].claimToken;
    expect(markBoardBriefingOutboxSent).toHaveBeenCalledWith(
      service,
      "11111111-1111-4111-8111-111111111111",
      claimToken,
      { messageId: "msg-1" },
    );
  });

  it("does not mark sent when SendGrid fails", async () => {
    sendEmail.mockRejectedValue(new Error("sendgrid down"));

    const res = await GET(req("Bearer cron-secret"));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "send_failed", reason: "unexpected_error" });
    expect(markBoardBriefingOutboxSent).not.toHaveBeenCalled();
  });

  it("reports a safe provider status when SendGrid rejects the message", async () => {
    sendEmail.mockRejectedValue(
      new MailError("SendGrid send failed (status 403)", {
        statusCode: 403,
        retryable: false,
      }),
    );

    const res = await GET(req("Bearer cron-secret"));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "send_failed", reason: "sendgrid_status_403" });
    expect(markBoardBriefingOutboxSent).not.toHaveBeenCalled();
  });

  it("reports the outbox as unavailable when the database cannot claim a row", async () => {
    claimBoardBriefingOutbox.mockRejectedValue(
      new Error("Could not find the table 'public.board_briefing_outbox' in the schema cache"),
    );

    const res = await GET(req("Bearer cron-secret"));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "outbox_unavailable",
      reason: "outbox_schema_unavailable",
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(markBoardBriefingOutboxSent).not.toHaveBeenCalled();
  });

  it("reports when a sent briefing cannot be stamped in the outbox", async () => {
    markBoardBriefingOutboxSent.mockRejectedValue(new Error("update failed"));

    const res = await GET(req("Bearer cron-secret"));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "sent_stamp_failed",
      reason: "unexpected_error",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("fails honestly and never sends when the staged row has no body", async () => {
    claimBoardBriefingOutbox.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      briefingDate: "2026-07-09",
      bodyMarkdown: " ",
      briefingUrl: "https://paperclip.example/doc",
    });

    const res = await GET(req("Bearer cron-secret"));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "invalid_staged_briefing",
      message: "body is required",
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(markBoardBriefingOutboxSent).not.toHaveBeenCalled();
  });

  it("POST uses the same path for manual operator runs", async () => {
    const res = await POST(req("Bearer cron-secret"));

    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
