import { beforeEach, describe, expect, it, vi } from "vitest";

const getDashboardAccess = vi.fn();
let user: { id: string } | null = null;
let evidence: { source_label_normalized: string } | null = null;
let updated: { source_label_normalized: string } | null = null;
const upsert = vi.fn();
const update = vi.fn();

vi.mock("@/lib/auth/shop-access", () => ({ getDashboardAccess }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "v_collision_insurer_alias_review_queue") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: evidence, error: null })),
        };
      }
      return {
        upsert,
        update: vi.fn((patch: unknown) => {
          update(patch);
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: updated, error: null })),
          };
        }),
      };
    }),
  })),
}));

const { POST } =
  await import("@/app/api/collision-intelligence/insurer-alias-review/route");

function request(fields: Record<string, string>) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request(
    "https://hub.psgweb.me/api/collision-intelligence/insurer-alias-review",
    { method: "POST", headers: { origin: "https://hub.psgweb.me" }, body },
  );
}

beforeEach(() => {
  user = null;
  evidence = null;
  updated = null;
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
  update.mockReset();
  getDashboardAccess.mockReset();
});

describe("POST insurer alias review", () => {
  it("rejects unauthenticated and non-superadmin users", async () => {
    expect((await POST(request({}))).status).toBe(401);

    user = { id: "user-1" };
    getDashboardAccess.mockResolvedValue({ role: "psg_internal", shopIds: [] });
    expect((await POST(request({}))).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("approves an observed candidate without overwriting a prior decision", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });
    evidence = { source_label_normalized: "state farm ins" };
    updated = { source_label_normalized: "state farm ins" };

    const response = await POST(
      request({
        action: "approve",
        source_label_normalized: "state farm ins",
        canonical_insurer_key: "state farm",
        canonical_insurer_name: "State Farm",
        review_notes: "Verified carrier label",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("result=approved");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        review_status: "approved",
        canonical_insurer_key: "state farm",
        reviewed_by: "superadmin-1",
      }),
    );
  });
});
