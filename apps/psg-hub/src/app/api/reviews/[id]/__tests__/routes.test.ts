import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be declared before importing the handlers under test.

const { notifyBsmApprovalAdmins } = vi.hoisted(() => ({
  notifyBsmApprovalAdmins: vi.fn(),
}));

const anthropicCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreate };
  },
}));

vi.mock("@/lib/bsm/approval-notifications", () => ({
  notifyBsmApprovalAdmins,
}));

// Supabase mocks
type User = { id: string } | null;
let mockUser: User = null;
let mockReview: { id: string; shop_id: string; platform: string; rating: number; body: string | null; author: string | null } | null = null;
let mockMembership: { role: "owner" | "manager" | "viewer" } | null = null;
let mockShop: { id: string; name: string } | null = null;
let mockExistingResponse: {
  id: string;
  review_id: string;
  shop_id: string;
  body: string;
  status: "draft" | "approved" | "rejected";
  tone_preset: string;
  model_id: string;
  prompt_version: string;
  version: number;
  safety_flags: string[];
  safety_overridden: boolean;
  approved_by: string | null;
  approved_at: string | null;
} | null = null;
let mockInsertedComment: {
  id: string;
  review_id: string;
  response_id: string | null;
  body: string;
  created_at: string;
} | null = null;
let mockRateLimitCount = 0;
let serviceUpdateReturnsRow = true;

function builder<T>(data: T) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function serverClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "review_items") return builder(mockReview);
      if (table === "shop_users") return builder(mockMembership);
      if (table === "shops") return builder(mockShop);
      if (table === "review_responses") return builder(mockExistingResponse);
      if (table === "review_response_comments") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: mockInsertedComment,
                error: null,
              }),
            }),
          }),
        };
      }
      return builder(null);
    }),
  };
}

function serviceClient() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "llm_call_log") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ count: mockRateLimitCount, error: null }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      if (table === "review_responses") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: mockExistingResponse,
            error: null,
          }),
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "resp-new", version: 1 },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: serviceUpdateReturnsRow
                      ? { id: "resp-1", version: 2 }
                      : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverClient()),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceClient()),
}));

const { POST: draftPOST } = await import(
  "@/app/api/reviews/[id]/draft-response/route"
);
const { POST: approvePOST } = await import(
  "@/app/api/reviews/[id]/approve-response/route"
);
const { POST: commentPOST } = await import(
  "@/app/api/reviews/[id]/comments/route"
);

function req(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  anthropicCreate.mockReset();
  notifyBsmApprovalAdmins.mockReset();
  notifyBsmApprovalAdmins.mockResolvedValue({
    inAppCreated: 1,
    inAppSkipped: 0,
    emailSent: 1,
    emailSkipped: 0,
    emailFailed: 0,
  });
  mockUser = null;
  mockReview = null;
  mockMembership = null;
  mockShop = null;
  mockExistingResponse = null;
  mockInsertedComment = {
    id: "comment-1",
    review_id: "r1",
    response_id: "resp-1",
    body: "Looks ready.",
    created_at: "2026-07-17T16:00:00.000Z",
  };
  mockRateLimitCount = 0;
  serviceUpdateReturnsRow = true;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-key";
});

describe("POST /api/reviews/[id]/comments", () => {
  const baseReview = {
    id: "r1",
    shop_id: "shopA",
    platform: "google",
    rating: 4,
    body: "good",
    author: "X",
  };

  it("401 when unauthed", async () => {
    mockUser = null;
    const res = await commentPOST(req({ body: "Looks ready." }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 cross-tenant comment attempt", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = null;
    const res = await commentPOST(req({ body: "Looks ready." }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(403);
  });

  it("400 when comment is blank", async () => {
    mockUser = { id: "u1" };
    const res = await commentPOST(req({ body: "   " }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 when response id belongs to another review", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockExistingResponse = {
      id: "resp-1",
      review_id: "other-review",
      shop_id: "shopA",
      body: "draft body",
      status: "draft",
      tone_preset: "default",
      model_id: "m",
      prompt_version: "v1",
      version: 1,
      safety_flags: [],
      safety_overridden: false,
      approved_by: null,
      approved_at: null,
    };
    const res = await commentPOST(
      req({ body: "Looks ready.", responseId: "resp-1" }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("200 adds a scoped comment", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "manager" };
    mockShop = { id: "shopA", name: "Acme Collision" };
    mockExistingResponse = {
      id: "resp-1",
      review_id: "r1",
      shop_id: "shopA",
      body: "draft body",
      status: "draft",
      tone_preset: "default",
      model_id: "m",
      prompt_version: "v1",
      version: 1,
      safety_flags: [],
      safety_overridden: false,
      approved_by: null,
      approved_at: null,
    };
    const res = await commentPOST(
      req({ body: "Looks ready.", responseId: "resp-1" }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.comment.body).toBe("Looks ready.");
    expect(notifyBsmApprovalAdmins).toHaveBeenCalledOnce();
    expect(notifyBsmApprovalAdmins).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shopId: "shopA",
        shopName: "Acme Collision",
        reviewItemId: "r1",
        reviewItemTitle: "google review from X",
        eventKey: "review:r1:comment:comment-1",
        eventType: "comment_created",
        messagePreview: "Looks ready.",
      }),
    );
  });

  it("uses a stable comment event key when a saved action is replayed", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "manager" };
    mockShop = { id: "shopA", name: "Acme Collision" };

    const first = await commentPOST(req({ body: "Looks ready." }), {
      params: Promise.resolve({ id: "r1" }),
    });
    const second = await commentPOST(req({ body: "Looks ready." }), {
      params: Promise.resolve({ id: "r1" }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(notifyBsmApprovalAdmins).toHaveBeenCalledTimes(2);
    expect(notifyBsmApprovalAdmins.mock.calls[0][1]).toMatchObject({
      eventKey: "review:r1:comment:comment-1",
    });
    expect(notifyBsmApprovalAdmins.mock.calls[1][1]).toMatchObject({
      eventKey: "review:r1:comment:comment-1",
    });
  });
});

describe("POST /api/reviews/[id]/draft-response", () => {
  it("401 when unauthed; does not call Anthropic", async () => {
    mockUser = null;
    const res = await draftPOST(req({}), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(401);
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("404 when review not found; does not call Anthropic", async () => {
    mockUser = { id: "u1" };
    mockReview = null;
    const res = await draftPOST(req({}), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(404);
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("403 cross-tenant (no membership); does not call Anthropic", async () => {
    mockUser = { id: "u1" };
    mockReview = {
      id: "r1",
      shop_id: "shopB",
      platform: "google",
      rating: 4,
      body: "good",
      author: "X",
    };
    mockMembership = null;
    const res = await draftPOST(req({}), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(403);
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("429 when rate limit exceeded; does not call Anthropic", async () => {
    mockUser = { id: "u1" };
    mockReview = {
      id: "r1",
      shop_id: "shopA",
      platform: "google",
      rating: 4,
      body: "good",
      author: "X",
    };
    mockMembership = { role: "owner" };
    mockShop = { id: "shopA", name: "Acme" };
    mockRateLimitCount = 10; // at limit
    const res = await draftPOST(req({}), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(429);
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("200 drafts and upserts a response (happy path)", async () => {
    mockUser = { id: "u1" };
    mockReview = {
      id: "r1",
      shop_id: "shopA",
      platform: "google",
      rating: 5,
      body: "great",
      author: "Jane",
    };
    mockMembership = { role: "owner" };
    mockShop = { id: "shopA", name: "Acme" };
    mockRateLimitCount = 0;
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Thank you, Jane!" }],
      usage: { input_tokens: 12, output_tokens: 8 },
    });
    const res = await draftPOST(req({ tone: "warm" }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.response.id).toBe("resp-new");
    expect(anthropicCreate).toHaveBeenCalledOnce();
  });
});

describe("POST /api/reviews/[id]/approve-response", () => {
  const baseReview = {
    id: "r1",
    shop_id: "shopA",
    platform: "google",
    rating: 4,
    body: "good",
    author: "X",
  };
  const baseDraft = {
    id: "resp-1",
    review_id: "r1",
    shop_id: "shopA",
    body: "draft body",
    status: "draft" as const,
    tone_preset: "default",
    model_id: "m",
    prompt_version: "v1",
    version: 1,
    safety_flags: [],
    safety_overridden: false,
    approved_by: null,
    approved_at: null,
  };

  it("401 when unauthed", async () => {
    mockUser = null;
    const res = await approvePOST(
      req({ action: "approve", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("403 when viewer tries to approve", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "viewer" };
    mockExistingResponse = baseDraft;
    const res = await approvePOST(
      req({ action: "approve", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("409 when approving with unresolved safety flags", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockExistingResponse = {
      ...baseDraft,
      safety_flags: ["admission_of_fault"],
    };
    const res = await approvePOST(
      req({ action: "approve", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(409);
  });

  it("409 when expectedVersion does not match", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockExistingResponse = baseDraft;
    serviceUpdateReturnsRow = false;
    const res = await approvePOST(
      req({ action: "approve", expectedVersion: 99 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(409);
  });

  it("403 when non-owner tries override_safety", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "manager" };
    mockExistingResponse = {
      ...baseDraft,
      safety_flags: ["admission_of_fault"],
    };
    const res = await approvePOST(
      req({ action: "override_safety", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("200 approves a clean draft as owner (version matches)", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockShop = { id: "shopA", name: "Acme Collision" };
    mockExistingResponse = baseDraft; // status draft, no flags, version 1
    serviceUpdateReturnsRow = true;
    const res = await approvePOST(
      req({ action: "approve", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.response.id).toBe("resp-1");
    expect(notifyBsmApprovalAdmins).toHaveBeenCalledOnce();
    expect(notifyBsmApprovalAdmins).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventKey: "review:r1:response:resp-1:decision:approve:version:2",
        eventType: "decision_approved",
        reviewItemTitle: "google review from X",
        shopName: "Acme Collision",
      }),
    );
  });

  it("400 when action is missing/invalid", async () => {
    mockUser = { id: "u1" };
    const res = await approvePOST(req({ expectedVersion: 1 }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 when expectedVersion is not a number", async () => {
    mockUser = { id: "u1" };
    const res = await approvePOST(req({ action: "approve" }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(400);
  });

  it("404 when no draft exists", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockExistingResponse = null;
    const res = await approvePOST(
      req({ action: "approve", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("200 rejects a draft", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "manager" };
    mockShop = { id: "shopA", name: "Acme Collision" };
    mockExistingResponse = baseDraft;
    const res = await approvePOST(
      req({ action: "reject", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(200);
    expect(notifyBsmApprovalAdmins).toHaveBeenCalledOnce();
    expect(notifyBsmApprovalAdmins).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventKey: "review:r1:response:resp-1:decision:reject:version:2",
        eventType: "decision_declined",
      }),
    );
  });

  it("200 updates draft body (recomputes safety, bumps version)", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockShop = { id: "shopA", name: "Acme Collision" };
    mockExistingResponse = baseDraft;
    const res = await approvePOST(
      req({ action: "update", body: "Edited reply.", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(200);
    expect(notifyBsmApprovalAdmins).toHaveBeenCalledOnce();
    expect(notifyBsmApprovalAdmins).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventKey: "review:r1:response:resp-1:decision:update:version:2",
        eventType: "decision_updates_requested",
        messagePreview: "Edited reply.",
      }),
    );
  });

  it("400 update without a body", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockExistingResponse = baseDraft;
    const res = await approvePOST(
      req({ action: "update", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("200 unapproves an approved response back to draft", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockExistingResponse = { ...baseDraft, status: "approved" };
    const res = await approvePOST(
      req({ action: "unapprove", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(200);
  });

  it("200 override_safety as owner when flags present", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockExistingResponse = {
      ...baseDraft,
      safety_flags: ["admission_of_fault"],
    };
    const res = await approvePOST(
      req({ action: "override_safety", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(200);
  });

  it("409 approving a non-draft status", async () => {
    mockUser = { id: "u1" };
    mockReview = baseReview;
    mockMembership = { role: "owner" };
    mockExistingResponse = { ...baseDraft, status: "approved" };
    const res = await approvePOST(
      req({ action: "approve", expectedVersion: 1 }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(409);
  });
});
