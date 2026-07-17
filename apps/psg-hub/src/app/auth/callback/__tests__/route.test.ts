import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession,
    },
  })),
}));

const { GET } = await import("@/app/auth/callback/route");

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("GET /auth/callback", () => {
  it("routes recovery code links to reset-password when next is missing", async () => {
    const res = await GET(
      new NextRequest("http://127.0.0.1:3100/auth/callback?code=abc&type=recovery")
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3100/reset-password");
  });

  it("keeps same-app next redirects and rejects external redirects", async () => {
    const dashboard = await GET(
      new NextRequest("http://127.0.0.1:3100/auth/callback?code=abc&next=%2Fdashboard")
    );
    const external = await GET(
      new NextRequest("http://127.0.0.1:3100/auth/callback?code=abc&next=https%3A%2F%2Fevil.test")
    );

    expect(dashboard.headers.get("location")).toBe("http://localhost:3100/dashboard");
    expect(external.headers.get("location")).toBe("http://localhost:3100/dashboard");
  });
});
