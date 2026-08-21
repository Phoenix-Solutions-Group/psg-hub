import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveShopContext = vi.fn();
const rpc = vi.fn();
let user: { id: string } | null = null;

vi.mock("@/lib/shop/context", () => ({ getActiveShopContext }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ rpc })),
}));

const { POST } =
  await import("@/app/api/collision-intelligence/weather-alert-review/route");

function request(fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request(
    "https://hub.psgweb.me/api/collision-intelligence/weather-alert-review",
    { method: "POST", headers: { origin: "https://hub.psgweb.me" }, body },
  );
}

const shopId = "11111111-1111-4111-8111-111111111111";
const acknowledgeFields = {
  action: "acknowledge",
  zip_code: "67037",
  event_type: "hail",
  event_date: "2026-08-18",
};

beforeEach(() => {
  user = null;
  rpc.mockReset().mockResolvedValue({ data: {}, error: null });
  getActiveShopContext.mockReset().mockResolvedValue({
    shops: [],
    activeShopId: null,
  });
});

describe("POST collision weather alert review", () => {
  it("rejects unauthenticated users and shop viewers", async () => {
    expect((await POST(request(acknowledgeFields))).status).toBe(401);

    user = { id: "viewer-1" };
    getActiveShopContext.mockResolvedValue({
      shops: [{ id: shopId, name: "Pilot", role: "viewer" }],
      activeShopId: shopId,
    });
    expect((await POST(request(acknowledgeFields))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("acknowledges only against the server-derived active shop", async () => {
    user = { id: "owner-1" };
    getActiveShopContext.mockResolvedValue({
      shops: [{ id: shopId, name: "Pilot", role: "owner" }],
      activeShopId: shopId,
    });

    const response = await POST(
      request({ ...acknowledgeFields, shop_id: "attacker-shop" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "weather_review=acknowledged",
    );
    expect(rpc).toHaveBeenCalledWith("acknowledge_collision_weather_alert", {
      p_shop_id: shopId,
      p_zip_code: "67037",
      p_event_type: "hail",
      p_event_date: "2026-08-18",
      p_actor_profile_id: "owner-1",
    });
  });

  it("requires a governed outcome and substantive evidence to close", async () => {
    user = { id: "manager-1" };
    getActiveShopContext.mockResolvedValue({
      shops: [{ id: shopId, name: "Pilot", role: "manager" }],
      activeShopId: shopId,
    });

    expect(
      (
        await POST(
          request({
            action: "close",
            case_id: "22222222-2222-4222-8222-222222222222",
            outcome: "no_observed_follow_through",
            outcome_notes: "Too short",
          }),
        )
      ).status,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("closes through the audited active-shop RPC", async () => {
    user = { id: "manager-1" };
    getActiveShopContext.mockResolvedValue({
      shops: [{ id: shopId, name: "Pilot", role: "manager" }],
      activeShopId: shopId,
    });
    const notes =
      "Four-week arrivals stayed inside the registered historical range.";

    const response = await POST(
      request({
        action: "close",
        case_id: "22222222-2222-4222-8222-222222222222",
        outcome: "no_observed_follow_through",
        outcome_notes: notes,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("weather_review=closed");
    expect(rpc).toHaveBeenCalledWith("close_collision_weather_alert_case", {
      p_case_id: "22222222-2222-4222-8222-222222222222",
      p_shop_id: shopId,
      p_outcome: "no_observed_follow_through",
      p_outcome_notes: notes,
      p_actor_profile_id: "manager-1",
    });
  });

  it("keeps an immature follow-up open with an actionable notice", async () => {
    user = { id: "manager-1" };
    getActiveShopContext.mockResolvedValue({
      shops: [{ id: shopId, name: "Pilot", role: "manager" }],
      activeShopId: shopId,
    });
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "55000",
        message:
          "Four complete follow-up weeks and repair history spanning the prior 52 weeks are required",
      },
    });

    const response = await POST(
      request({
        action: "close",
        case_id: "22222222-2222-4222-8222-222222222222",
        outcome: "observed_follow_through",
        outcome_notes:
          "The user attempted to close this before the repair history span matured.",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "weather_review=evidence_incomplete",
    );
  });
});
