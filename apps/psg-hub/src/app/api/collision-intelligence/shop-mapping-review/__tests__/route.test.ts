import { beforeEach, describe, expect, it, vi } from "vitest";

const getDashboardAccess = vi.fn();
const rpc = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
let user: { id: string } | null = null;

vi.mock("@/lib/auth/shop-access", () => ({ getDashboardAccess }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ from, rpc })),
}));

const { POST } =
  await import("@/app/api/collision-intelligence/shop-mapping-review/route");

function request(fields: Record<string, string>) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request(
    "https://hub.psgweb.me/api/collision-intelligence/shop-mapping-review",
    { method: "POST", headers: { origin: "https://hub.psgweb.me" }, body },
  );
}

beforeEach(() => {
  user = null;
  rpc
    .mockReset()
    .mockResolvedValue({ data: { mapping_status: "mapped" }, error: null });
  from.mockClear();
  select.mockClear();
  eq.mockClear();
  maybeSingle.mockReset();
  getDashboardAccess.mockReset();
});

describe("POST collision shop mapping review", () => {
  it("rejects unauthenticated and non-superadmin users", async () => {
    expect((await POST(request({}))).status).toBe(401);

    user = { id: "user-1" };
    getDashboardAccess.mockResolvedValue({ role: "psg_internal", shopIds: [] });
    expect((await POST(request({}))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires an explicit identity confirmation", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });

    const response = await POST(
      request({
        source_shop_key: "PS773",
        shop_id: "11111111-1111-4111-8111-111111111111",
        review_notes: "Confirmed legal operating identity from signed records.",
      }),
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls the atomic approval RPC for a confirmed exact-address mapping", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });
    maybeSingle.mockResolvedValue({
      data: {
        address_street: "1500 Center Park Road",
        address_locality: "Lincoln",
        address_region: "NE",
        address_postal_code: "68512",
      },
      error: null,
    });

    const response = await POST(
      request({
        source_shop_key: "PS229",
        shop_id: "11111111-1111-4111-8111-111111111111",
        review_notes: "Confirmed legal operating identity from signed records.",
        identity_confirmed: "confirmed",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "result=mapping_approved",
    );
    expect(rpc).toHaveBeenCalledWith("approve_collision_shop_mapping", {
      p_source_system: "filemaker_repair_customer",
      p_source_shop_key: "PS229",
      p_shop_id: "11111111-1111-4111-8111-111111111111",
      p_actor_profile_id: "superadmin-1",
      p_review_notes: "Confirmed legal operating identity from signed records.",
    });
  });

  it("blocks a name-only mapping without governed address evidence", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });

    const response = await POST(
      request({
        source_shop_key: "PS773",
        shop_id: "11111111-1111-4111-8111-111111111111",
        review_notes: "Confirmed legal operating identity from signed records.",
        identity_confirmed: "confirmed",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "result=mapping_evidence_missing",
    );
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks a known location from a Hub shop without its verified address", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });
    maybeSingle.mockResolvedValue({
      data: {
        address_street: null,
        address_locality: null,
        address_region: null,
        address_postal_code: null,
      },
      error: null,
    });

    const response = await POST(
      request({
        source_shop_key: "PS229",
        shop_id: "11111111-1111-4111-8111-111111111111",
        review_notes: "Confirmed legal operating identity from signed records.",
        identity_confirmed: "confirmed",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "result=mapping_location_mismatch",
    );
    expect(response.headers.get("location")).toContain("shop_source=PS229");
    expect(rpc).not.toHaveBeenCalled();
  });
});
