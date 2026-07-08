import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Swap the SendGrid adapter and the briefing fetch; keep the real render +
// recipient logic so the route wiring is exercised end-to-end.
const sendEmail = vi.fn();
vi.mock("@/lib/mail/sendgrid", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

const fetchBriefing = vi.fn();
vi.mock("@/lib/board-briefing/briefing", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/board-briefing/briefing")>();
  return { ...actual, fetchBriefing: (...a: unknown[]) => fetchBriefing(...a) };
});

import { GET, POST } from "../route";
import { BriefingUnavailableError } from "@/lib/board-briefing/briefing";

const GOOD_BRIEFING = {
  body: "# Daily Briefing\n\n> all good",
  updatedAt: "2026-07-08T12:03:36.999Z",
  issueId: "issue-1",
};

function req(auth?: string): Request {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return new Request("http://localhost/api/cron/board-briefing-email", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  sendEmail.mockReset().mockResolvedValue({ statusCode: 202 });
  fetchBriefing.mockReset().mockResolvedValue(GOOD_BRIEFING);
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("PAPERCLIP_API_URL", "https://home.psgweb.me");
  vi.stubEnv("PAPERCLIP_READ_TOKEN", "read-tok");
  vi.stubEnv("BOARD_BRIEFING_RECIPIENTS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("board-briefing-email auth gate", () => {
  it("401 with no credentials — nothing is fetched or sent", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(fetchBriefing).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("401 with a wrong secret", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/board-briefing-email", {
        headers: { authorization: "Bearer wrong" },
      })
    );
    expect(res.status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET is unset (fail-closed)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(req("Bearer anything"));
    expect(res.status).toBe(401);
  });
});

describe("board-briefing-email config gate", () => {
  it("503 not_configured when API url/token are missing — no send", async () => {
    vi.stubEnv("PAPERCLIP_READ_TOKEN", "");
    const res = await POST(req("Bearer cron-secret"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "board_briefing_not_configured" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("board-briefing-email fail-honest empty/missing briefing", () => {
  it("returns 5xx and does NOT send when the briefing is unavailable", async () => {
    fetchBriefing.mockRejectedValueOnce(
      new BriefingUnavailableError("Briefing document is empty", 502)
    );
    const res = await POST(req("Bearer cron-secret"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "briefing_unavailable" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("board-briefing-email success", () => {
  it("sends exactly one dated email per recipient with a live-doc link", async () => {
    vi.stubEnv(
      "BOARD_BRIEFING_RECIPIENTS",
      "nick@x.com, board@y.com"
    );
    const res = await POST(req("Bearer cron-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      sent: ["nick@x.com", "board@y.com"],
    });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const first = sendEmail.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(first.to).toBe("nick@x.com");
    expect(first.subject).toBe("PSG Board Briefing — Wed, Jul 8, 2026");
    expect(first.html).toContain("Daily Briefing");
    expect(first.html).toContain("https://home.psgweb.me/issues/issue-1");
    expect(first.text).toContain("Open the live briefing:");
  });

  it("defaults to Nick when no recipients env is set", async () => {
    const res = await POST(req("Bearer cron-secret"));
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0][0] as { to: string }).to).toBe(
      "nick@phoenixsolutionsgroup.net"
    );
  });

  it("returns 502 and alarms if a send fails, reporting which recipients", async () => {
    vi.stubEnv("BOARD_BRIEFING_RECIPIENTS", "ok@x.com, bad@y.com");
    sendEmail
      .mockResolvedValueOnce({ statusCode: 202 })
      .mockRejectedValueOnce(new Error("bounce"));
    const res = await POST(req("Bearer cron-secret"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      ok: boolean;
      sent: string[];
      failed: { to: string }[];
    };
    expect(body.ok).toBe(false);
    expect(body.sent).toEqual(["ok@x.com"]);
    expect(body.failed[0].to).toBe("bad@y.com");
  });
});
