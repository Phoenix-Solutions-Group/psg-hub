import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockExchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  })),
}));

const { GET } = await import("@/app/auth/callback/route");

function request(url: string) {
  return new NextRequest(url);
}

beforeEach(() => {
  mockExchangeCodeForSession.mockReset();
  mockExchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("GET /auth/callback", () => {
  it("routes recovery code links to the reset-password screen when next is missing", async () => {
    const response = await GET(request("http://localhost/auth/callback?code=abc&type=recovery"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/reset-password");
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("keeps regular code links on the dashboard by default", async () => {
    const response = await GET(request("http://localhost/auth/callback?code=abc"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/dashboard");
  });
});
