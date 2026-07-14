import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExchangeCode = vi.fn();
const mockVerifyOtp = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mockExchangeCode,
      verifyOtp: mockVerifyOtp,
    },
  })),
  // Preserve any exports we do not mock.
  createBrowserClient: vi.fn(),
}));

const { GET } = await import("@/app/auth/callback/route");

function req(url: string) {
  return new NextRequest(url);
}

beforeEach(() => {
  mockExchangeCode.mockReset().mockResolvedValue({ data: null, error: null });
  mockVerifyOtp.mockReset().mockResolvedValue({ data: null, error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("GET /auth/callback", () => {
  it("uses code-based session exchange when code is present", async () => {
    const res = await GET(req("http://localhost/auth/callback?code=abc&next=%2Fdashboard"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/dashboard");
    expect(mockExchangeCode).toHaveBeenCalledWith("abc");
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("falls back to OTP verification for recovery links", async () => {
    const res = await GET(
      req("http://localhost/auth/callback?token=tok&token_hash=hash&type=recovery")
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/auth/reset-password");
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      type: "recovery",
      token: "tok",
      token_hash: "hash",
    });
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });

  it("rejects links without code or recovery token", async () => {
    const res = await GET(req("http://localhost/auth/callback"));
    expect(res.status).toBe(400);
    expect(mockExchangeCode).not.toHaveBeenCalled();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });
});
