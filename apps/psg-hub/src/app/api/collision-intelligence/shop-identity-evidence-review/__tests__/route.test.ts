import { beforeEach, describe, expect, it, vi } from "vitest";

const getDashboardAccess = vi.fn();
const rpc = vi.fn();
let user: { id: string } | null = null;

vi.mock("@/lib/auth/shop-access", () => ({ getDashboardAccess }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ rpc })),
}));

const { POST } =
  await import("@/app/api/collision-intelligence/shop-identity-evidence-review/route");

const validFields = {
  source_shop_key: "PS229",
  address_street: "1500 Center Park Road",
  address_locality: "Lincoln",
  address_region: "ne",
  address_postal_code: "68512",
  source_name: "BBB business profile",
  source_url: "https://example.com/shop",
  review_notes: "The public profile identifies this exact physical location.",
  evidence_confirmed: "confirmed",
};

function request(fields: Record<string, string>) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request(
    "https://hub.psgweb.me/api/collision-intelligence/shop-identity-evidence-review",
    { method: "POST", headers: { origin: "https://hub.psgweb.me" }, body },
  );
}

beforeEach(() => {
  user = null;
  rpc.mockReset().mockResolvedValue({ data: {}, error: null });
  getDashboardAccess.mockReset();
});

describe("POST collision shop identity evidence review", () => {
  it("rejects unauthenticated and non-superadmin users", async () => {
    expect((await POST(request(validFields))).status).toBe(401);

    user = { id: "user-1" };
    getDashboardAccess.mockResolvedValue({ role: "psg_internal", shopIds: [] });
    expect((await POST(request(validFields))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires confirmation and a secure evidence URL", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });

    const response = await POST(
      request({ ...validFields, source_url: "http://example.com/shop" }),
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records normalized evidence without mapping the shop", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });

    const response = await POST(request(validFields));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "result=mapping_evidence_recorded",
    );
    expect(rpc).toHaveBeenCalledWith(
      "review_collision_shop_identity_evidence",
      {
        p_source_system: "filemaker_repair_customer",
        p_source_shop_key: "PS229",
        p_address_street: "1500 Center Park Road",
        p_address_locality: "Lincoln",
        p_address_region: "NE",
        p_address_postal_code: "68512",
        p_source_name: "BBB business profile",
        p_source_url: "https://example.com/shop",
        p_actor_profile_id: "superadmin-1",
        p_review_notes:
          "The public profile identifies this exact physical location.",
      },
    );
  });

  it("keeps the form read-only until the RPC is released", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "RPC unavailable" },
    });

    const response = await POST(request(validFields));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "result=mapping_evidence_release_pending",
    );
  });
});
