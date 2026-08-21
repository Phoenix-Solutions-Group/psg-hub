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
  await import("@/app/api/collision-intelligence/forecast-model-review/route");

function request(fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request(
    "https://hub.psgweb.me/api/collision-intelligence/forecast-model-review",
    { method: "POST", headers: { origin: "https://hub.psgweb.me" }, body },
  );
}

const validFields = {
  shop_id: "11111111-1111-4111-8111-111111111111",
  decision: "approve",
  review_notes: "All four held-out horizons clear the governed evidence gates.",
  evidence_confirmed: "confirmed",
};

beforeEach(() => {
  user = null;
  rpc.mockReset().mockResolvedValue({
    data: { promotion_status: "approved" },
    error: null,
  });
  getDashboardAccess.mockReset();
});

describe("POST collision forecast model review", () => {
  it("rejects unauthenticated and non-superadmin users", async () => {
    expect((await POST(request())).status).toBe(401);

    user = { id: "user-1" };
    getDashboardAccess.mockResolvedValue({ role: "psg_internal", shopIds: [] });
    expect((await POST(request())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires explicit evidence confirmation and substantive notes", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });

    expect(
      (
        await POST(
          request({
            ...validFields,
            review_notes: "Looks good",
            evidence_confirmed: "",
          }),
        )
      ).status,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes an approved four-horizon decision to the atomic RPC", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });

    const response = await POST(request(validFields));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "result=forecast_model_approved",
    );
    expect(rpc).toHaveBeenCalledWith("review_collision_forecast_models", {
      p_shop_id: validFields.shop_id,
      p_decision: "approve",
      p_actor_profile_id: "superadmin-1",
      p_review_notes: validFields.review_notes,
    });
  });

  it("uses the same audited RPC for rejection", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });

    const response = await POST(
      request({ ...validFields, decision: "reject" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "result=forecast_model_rejected",
    );
    expect(rpc).toHaveBeenCalledWith(
      "review_collision_forecast_models",
      expect.objectContaining({ p_decision: "reject" }),
    );
  });
});
