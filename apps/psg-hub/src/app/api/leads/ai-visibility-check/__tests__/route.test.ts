import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "../route";

const sendEmail = vi.fn();

vi.mock("@/lib/mail/sendgrid", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

function request(form: Record<string, string>, ip = "203.0.113.10") {
  const data = new FormData();
  for (const [key, value] of Object.entries(form)) {
    data.set(key, value);
  }
  return new Request("https://hub.psgweb.me/api/leads/ai-visibility-check", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: data,
  });
}

describe("AI visibility check lead route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_VISIBILITY_CHECK_INBOX = "growth@phoenixsolutionsgroup.net";
  });

  it("sends a lead email for valid requests", async () => {
    sendEmail.mockResolvedValue({ statusCode: 202 });

    const res = await POST(
      request({
        name: "Pat Owner",
        shopName: "Pat's Collision",
        location: "Akron, OH",
        email: "pat@example.com",
        phone: "555-0100",
        utm_source: "linkedin",
        utm_medium: "social",
        utm_campaign: "new-front-door",
        utm_content: "whitepaper-cta",
      }) as never
    );

    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "growth@phoenixsolutionsgroup.net",
        replyTo: "pat@example.com",
        subject: "AI Visibility Check request - Pat's Collision - linkedin",
        clickTracking: false,
      })
    );
    const message = sendEmail.mock.calls[0][0];
    expect(message.text).toContain("utm_source:   linkedin");
    expect(message.text).toContain("utm_campaign: new-front-door");
  });

  it("requires at least one contact method", async () => {
    const res = await POST(
      request({
        name: "Pat Owner",
        shopName: "Pat's Collision",
        location: "Akron, OH",
      }) as never
    );

    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("drops honeypot submissions without sending email", async () => {
    const res = await POST(
      request({
        name: "Pat Owner",
        shopName: "Pat's Collision",
        location: "Akron, OH",
        email: "pat@example.com",
        company: "spam filled this",
      }) as never
    );

    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
