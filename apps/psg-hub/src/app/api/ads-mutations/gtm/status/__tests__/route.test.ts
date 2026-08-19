import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

let opsGate: unknown = { ok: true, userId: "user-1", access: {} };
const listGtmContainerStatuses = vi.fn();

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: async (_fn: string) => opsGate,
}));

vi.mock("@/lib/gtm/status", () => ({
  listGtmContainerStatuses: (...args: unknown[]) => listGtmContainerStatuses(...args),
}));

const { GET } = await import("@/app/api/ads-mutations/gtm/status/route");

const SHOP_ID = "11111111-2222-4333-8444-555555555555";

function req(qs = `?shop_id=${SHOP_ID}`) {
  return new NextRequest(`http://localhost/api/ads-mutations/gtm/status${qs}`);
}

beforeEach(() => {
  opsGate = { ok: true, userId: "user-1", access: {} };
  listGtmContainerStatuses.mockReset();
});

describe("GET /api/ads-mutations/gtm/status", () => {
  it("returns the stored GTM container readiness inventory for a shop", async () => {
    listGtmContainerStatuses.mockResolvedValue([
      {
        shopId: SHOP_ID,
        containerId: "GTM-PSG123",
        accountName: "PSG",
        containerName: "Wallace site",
        workspace: {
          id: "12",
          name: "Default Workspace",
          fingerprint: "abc123",
          status: "modified",
        },
        publishedVersion: {
          id: "7",
          name: "Lead tracking",
          fingerprint: "pub456",
        },
        tags: [{ tagId: "100", name: "GA4 lead", type: "gaawe", paused: false }],
        triggers: [{ triggerId: "200", name: "Lead form submit", type: "customEvent" }],
        lastCheckedAt: "2026-07-10T20:00:00.000Z",
      },
    ]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(listGtmContainerStatuses).toHaveBeenCalledWith(SHOP_ID);
    await expect(res.json()).resolves.toMatchObject({
      shopId: SHOP_ID,
      containers: [{ containerId: "GTM-PSG123" }],
    });
  });

  it("rejects a missing or malformed shop id", async () => {
    const res = await GET(req("?shop_id=not-a-uuid"));

    expect(res.status).toBe(422);
    expect(listGtmContainerStatuses).not.toHaveBeenCalled();
  });

  it("propagates the Ads Mutation Studio capability gate", async () => {
    opsGate = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(listGtmContainerStatuses).not.toHaveBeenCalled();
  });
});

