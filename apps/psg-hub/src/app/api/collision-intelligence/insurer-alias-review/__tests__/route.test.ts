import { beforeEach, describe, expect, it, vi } from "vitest";

const getDashboardAccess = vi.fn();
let user: { id: string } | null = null;
let evidence: {
  source_label_normalized: string;
  source_label_name: string;
} | null = null;
let updated: { source_label_normalized: string } | null = null;
let masterInsurer: { name: string } | null = null;
let approvedInsurer: {
  canonical_insurer_key: string;
  canonical_insurer_name: string;
} | null = null;
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
      if (table === "insurance_companies") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: masterInsurer,
            error: null,
          })),
        };
      }
      return {
        upsert,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({
          data: approvedInsurer,
          error: null,
        })),
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
  masterInsurer = null;
  approvedInsurer = null;
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

  it("uses the observed source name without accepting a typed reporting name", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });
    evidence = {
      source_label_normalized: "state farm ins",
      source_label_name: "State Farm Ins.",
    };
    updated = { source_label_normalized: "state farm ins" };

    const response = await POST(
      request({
        action: "approve",
        source_label_normalized: "state farm ins",
        canonical_target: "source",
        canonical_insurer_name: "Wrong typed value",
        review_notes: "Verified carrier label",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("result=approved");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        review_status: "approved",
        canonical_insurer_key: "state farm ins",
        canonical_insurer_name: "State Farm Ins.",
        reviewed_by: "superadmin-1",
      }),
    );
  });

  it("resolves a selected master insurer on the server", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });
    evidence = {
      source_label_normalized: "travelers ins",
      source_label_name: "Travelers Ins",
    };
    masterInsurer = { name: "Travelers Insurance" };
    updated = { source_label_normalized: "travelers ins" };

    const response = await POST(
      request({
        action: "approve",
        source_label_normalized: "travelers ins",
        canonical_target: "master:11111111-1111-4111-8111-111111111111",
      }),
    );

    expect(response.status).toBe(303);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        canonical_insurer_key: "travelers insurance",
        canonical_insurer_name: "Travelers Insurance",
      }),
    );
  });

  it("rejects an invented insurer target", async () => {
    user = { id: "superadmin-1" };
    getDashboardAccess.mockResolvedValue({
      role: "psg_superadmin",
      shopIds: [],
    });
    evidence = {
      source_label_normalized: "travelers ins",
      source_label_name: "Travelers Ins",
    };

    const response = await POST(
      request({
        action: "approve",
        source_label_normalized: "travelers ins",
        canonical_target: "typed:State Farm",
      }),
    );

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
