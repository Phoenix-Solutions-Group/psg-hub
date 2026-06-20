import { describe, it, expect, vi, beforeEach } from "vitest";

type User = { id: string } | null;
let mockUser: User = null;

function serverClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverClient()),
}));

const { POST } = await import("@/app/api/onboarding/discover/route");

function req(body?: unknown) {
  return new Request("http://localhost/api/onboarding/discover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  mockUser = null;
});

describe("POST /api/onboarding/discover", () => {
  it("401 when unauthenticated", async () => {
    mockUser = null;
    const res = await POST(req({ shopName: "Acme" }));
    expect(res.status).toBe(401);
  });

  it("400 when shopName is empty", async () => {
    mockUser = { id: "u1" };
    const res = await POST(req({ shopName: "   " }));
    expect(res.status).toBe(400);
  });

  it("400 on invalid JSON", async () => {
    mockUser = { id: "u1" };
    const bad = new Request("http://localhost/api/onboarding/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });

  it("200 returns an enriched profile with the user's address echoed", async () => {
    mockUser = { id: "u1" };
    const res = await POST(
      req({
        shopName: "Tracy's Collision Center",
        address: "1500 Center Park Rd",
        city: "Lincoln",
        state: "ne",
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      profile: {
        provider: string;
        shopName: { value: string; verified: boolean };
        websiteUrl: { value: string | null; source: string };
        addressRegion: { value: string | null };
        pending: string[];
      };
    };
    expect(json.profile.provider).toBe("heuristic");
    expect(json.profile.shopName.value).toBe("Tracy's Collision Center");
    expect(json.profile.shopName.verified).toBe(false);
    expect(json.profile.addressRegion.value).toBe("NE");
    expect(json.profile.websiteUrl.value).toBe(
      "https://www.tracyscollisioncenter.com"
    );
    expect(json.profile.pending).toContain("competitors");
  });

  it("is idempotent: identical input yields an identical profile", async () => {
    mockUser = { id: "u1" };
    const body = { shopName: "Acme", city: "Lincoln", state: "NE" };
    const a = (await (await POST(req(body))).json()) as { profile: unknown };
    const b = (await (await POST(req(body))).json()) as { profile: unknown };
    expect(a.profile).toEqual(b.profile);
  });
});
