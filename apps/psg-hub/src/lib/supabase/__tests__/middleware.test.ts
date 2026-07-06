import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock @supabase/ssr so we can (a) assert it is NOT called on the fail-open
// branch and (b) drive the authenticated/unauthenticated cases deterministically.
let mockUser: { id: string } | null = null;
const createServerClient = vi.fn(() => ({
  auth: {
    getUser: () => Promise.resolve({ data: { user: mockUser } }),
  },
}));
vi.mock("@supabase/ssr", () => ({
  // Forward the call (ignoring args — tests assert call count, not arguments).
  createServerClient: () => createServerClient(),
}));

import { updateSession } from "@/lib/supabase/middleware";

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

function req(pathname: string) {
  return new NextRequest(new URL(`https://preview.example.com${pathname}`));
}

const originalEnv = { url: process.env[URL_KEY], anon: process.env[ANON_KEY] };

beforeEach(() => {
  mockUser = null;
  createServerClient.mockClear();
});

afterEach(() => {
  process.env[URL_KEY] = originalEnv.url;
  process.env[ANON_KEY] = originalEnv.anon;
});

describe("updateSession — fail-open when Supabase env absent (PSG-596)", () => {
  beforeEach(() => {
    delete process.env[URL_KEY];
    delete process.env[ANON_KEY];
  });

  it("returns 200 (pass-through) on a public route without calling Supabase", async () => {
    const res = await updateSession(req("/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    // The crash we are fixing came from createServerClient() with missing env —
    // it must be skipped entirely on the fail-open branch.
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("returns 200 on a public API route without calling Supabase", async () => {
    const res = await updateSession(req("/api/health"));
    expect(res.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("still gates a protected route: redirects /dashboard to /login (no bypass)", async () => {
    const res = await updateSession(req("/dashboard/reviews"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("updateSession — normal behavior when Supabase env present", () => {
  beforeEach(() => {
    process.env[URL_KEY] = "https://xyz.supabase.co";
    process.env[ANON_KEY] = "anon-test-key";
  });

  it("redirects unauthenticated user away from /dashboard to /login", async () => {
    mockUser = null;
    const res = await updateSession(req("/dashboard"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(createServerClient).toHaveBeenCalledOnce();
  });

  it("passes an authenticated user through on a protected route", async () => {
    mockUser = { id: "user-1" };
    const res = await updateSession(req("/dashboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects an authenticated user off /login to /dashboard", async () => {
    mockUser = { id: "user-1" };
    const res = await updateSession(req("/login"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("lets an unauthenticated user reach a public route", async () => {
    mockUser = null;
    const res = await updateSession(req("/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
