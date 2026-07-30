import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

const sendEmail = vi.fn();

vi.mock("@/lib/mail/sendgrid", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

function request(form: Record<string, string>, ip = "203.0.113.40") {
  const data = new FormData();
  for (const [key, value] of Object.entries(form)) {
    data.set(key, value);
  }
  return new Request("https://hub.psgweb.me/api/leads/whitepaper-download", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: data,
  });
}

describe("white paper download lead route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHITEPAPER_DOWNLOAD_INBOX = "growth@phoenixsolutionsgroup.net";
  });

  it("sends a lead email for valid download requests", async () => {
    sendEmail.mockResolvedValue({ statusCode: 202 });

    const res = await POST(
      request({
        email: "owner@example.com",
        name: "Pat Owner",
        shopName: "Pat's Collision",
        referrer: "https://example.com/post",
      }) as never
    );

    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "growth@phoenixsolutionsgroup.net",
        replyTo: "owner@example.com",
        subject: "White paper PDF download - Pat's Collision",
        clickTracking: false,
      })
    );
    const message = sendEmail.mock.calls[0][0];
    expect(message.text).toContain("owner@example.com");
    expect(message.text).toContain("Pat's Collision");
  });

  it("requires a valid email", async () => {
    const res = await POST(request({ email: "not-an-email" }) as never);

    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("drops honeypot submissions without sending email", async () => {
    const res = await POST(
      request({
        email: "owner@example.com",
        company: "spam filled this",
      }) as never
    );

    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
