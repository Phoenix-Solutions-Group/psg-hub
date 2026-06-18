import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AUDIT_ACTIONS,
  buildAuditRow,
  recordAuditEvent,
} from "@/lib/audit/access-audit";

// Capture what recordAuditEvent inserts (names must start with `mock` for
// vi.mock hoisting).
let mockInserted: unknown = null;
let mockError: { message: string } | null = null;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (row: unknown) => {
        mockInserted = row;
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                mockError
                  ? { data: null, error: mockError }
                  : { data: { id: "audit-1" }, error: null }
              ),
          }),
        };
      },
    }),
  }),
}));

beforeEach(() => {
  mockInserted = null;
  mockError = null;
});

describe("buildAuditRow", () => {
  it("maps a fully-specified event to the row shape", () => {
    expect(
      buildAuditRow({
        actorProfileId: "actor-1",
        action: "role.grant",
        targetProfileId: "user-9",
        targetShopId: "shop-3",
        payload: { from: "customer", to: "psg_internal" },
      })
    ).toEqual({
      actor_profile_id: "actor-1",
      target_profile_id: "user-9",
      target_shop_id: "shop-3",
      action: "role.grant",
      payload_jsonb: { from: "customer", to: "psg_internal" },
    });
  });

  it("normalises missing targets to null and defaults payload to {}", () => {
    expect(
      buildAuditRow({ actorProfileId: "actor-1", action: "superadmin.add" })
    ).toEqual({
      actor_profile_id: "actor-1",
      target_profile_id: null,
      target_shop_id: null,
      action: "superadmin.add",
      payload_jsonb: {},
    });
  });

  it("throws when the actor is missing", () => {
    expect(() =>
      buildAuditRow({ actorProfileId: "", action: "role.grant" })
    ).toThrow(/actorProfileId is required/);
  });

  it("throws on an action outside the closed vocabulary", () => {
    expect(() =>
      // @ts-expect-error — deliberately invalid action
      buildAuditRow({ actorProfileId: "a", action: "role.escalate" })
    ).toThrow(/unknown action/);
  });

  it("keeps the action vocabulary unique", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
});

describe("recordAuditEvent", () => {
  it("inserts the built row and returns the new id", async () => {
    const id = await recordAuditEvent({
      actorProfileId: "actor-1",
      action: "tier.change",
      targetShopId: "shop-3",
      payload: { from: "essentials", to: "growth" },
    });
    expect(id).toBe("audit-1");
    expect(mockInserted).toEqual({
      actor_profile_id: "actor-1",
      target_profile_id: null,
      target_shop_id: "shop-3",
      action: "tier.change",
      payload_jsonb: { from: "essentials", to: "growth" },
    });
  });

  it("surfaces a DB error with the action for context", async () => {
    mockError = { message: "permission denied" };
    await expect(
      recordAuditEvent({ actorProfileId: "actor-1", action: "shop.assign" })
    ).rejects.toThrow(/recordAuditEvent failed \(shop.assign\): permission denied/);
  });
});
