import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the mail adapter so no real send happens; we assert on what the route
// hands it. vi.hoisted keeps the spy above the hoisted vi.mock factory.
const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/mail/sendgrid", () => ({ sendEmail }));

import { POST } from "../route";

function makeRequest(form: FormData, headers: Record<string, string> = {}) {
  // A fresh forwarded IP per test avoids cross-test rate-limit bleed.
  return new Request("http://localhost/api/leads/tedesco-estimate", {
    method: "POST",
    body: form,
    headers,
  }) as unknown as import("next/server").NextRequest;
}

function baseForm(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.set("name", "Jane Driver");
  f.set("phone", "(914) 555-0199");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

let ipCounter = 0;
function uniqueIpHeaders(): Record<string, string> {
  ipCounter += 1;
  return { "x-forwarded-for": `10.0.0.${ipCounter}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Configure a destination inbox for the happy-path tests; the "unconfigured"
  // test below clears it explicitly.
  process.env.TEDESCO_LEAD_INBOX = "shop@example.test";
  sendEmail.mockResolvedValue({ statusCode: 202, messageId: "msg-1" });
});

describe("POST /api/leads/tedesco-estimate", () => {
  it("returns 200 and emails the lead on a valid submission", async () => {
    const res = await POST(makeRequest(baseForm({ car: "2019 Honda", what: "rear bumper" }), uniqueIpHeaders()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.subject).toContain("Jane Driver");
    expect(msg.text).toContain("(914) 555-0199");
    expect(msg.text).toContain("2019 Honda");
    expect(msg.text).toContain("rear bumper");
    expect(msg.to).toBe("shop@example.test");
    expect(msg.replyTo).toBe(msg.to); // replies route back to the shop inbox
    expect(msg.attachments).toEqual([]);
  });

  it("fails honestly (503, no false success) when no inbox is configured", async () => {
    delete process.env.TEDESCO_LEAD_INBOX;
    const res = await POST(makeRequest(baseForm(), uniqueIpHeaders()));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toHaveProperty("error");
    // Never confirm a lead we cannot deliver.
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects a submission missing name or phone with 400 and sends nothing", async () => {
    const f = new FormData();
    f.set("name", "No Phone");
    const res = await POST(makeRequest(f, uniqueIpHeaders()));
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("silently drops honeypot submissions without emailing", async () => {
    const res = await POST(makeRequest(baseForm({ company: "spam-bot-filled" }), uniqueIpHeaders()));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("attaches an uploaded image as a base64 attachment", async () => {
    const f = baseForm();
    f.set("photo", new File([new Uint8Array([1, 2, 3, 4])], "dent.jpg", { type: "image/jpeg" }));
    const res = await POST(makeRequest(f, uniqueIpHeaders()));
    expect(res.status).toBe(200);

    const msg = sendEmail.mock.calls[0][0];
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("dent.jpg");
    expect(msg.attachments[0].type).toBe("image/jpeg");
    expect(Buffer.from(msg.attachments[0].content, "base64")).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(msg.text).toContain("attached (dent.jpg)");
  });

  it("keeps the lead but drops a non-image upload with a note", async () => {
    const f = baseForm();
    f.set("photo", new File([new Uint8Array([1, 2, 3])], "bad.pdf", { type: "application/pdf" }));
    const res = await POST(makeRequest(f, uniqueIpHeaders()));
    expect(res.status).toBe(200);

    const msg = sendEmail.mock.calls[0][0];
    expect(msg.attachments).toEqual([]);
    expect(msg.text).toContain("omitted");
    expect(msg.text).toContain("application/pdf");
  });

  it("returns 502 (client shows call/text fallback) when the email fails", async () => {
    sendEmail.mockRejectedValueOnce(new Error("SendGrid down"));
    const res = await POST(makeRequest(baseForm(), uniqueIpHeaders()));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toHaveProperty("error");
  });

  it("rate-limits a flood of requests from the same IP with 429", async () => {
    const headers = { "x-forwarded-for": "203.0.113.7" };
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await POST(makeRequest(baseForm(), headers));
      statuses.push(res.status);
    }
    // First 5 succeed, the 6th+ are limited.
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toContain(429);
  });
});
