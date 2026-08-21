import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  listUsers: vi.fn(),
  startReviewWorkspaceRound: vi.fn(),
  updateInvitation: vi.fn(),
}));

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: vi.fn(async () => ({ ok: true, userId: "33333333-3333-4333-8333-333333333333", access: { role: "psg_superadmin" } })),
}));
vi.mock("@/lib/mail/sendgrid", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: { admin: { listUsers: mocks.listUsers } },
    from: () => ({
      update: (payload: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          mocks.updateInvitation(payload, id);
          return { error: null };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/bsm/review-workspace", () => ({
  ReviewWorkspaceInputError: class extends Error { status = 400; },
  bsmReviewWorkspaceInternalEnabled: () => true,
  createReviewWorkspaceProject: vi.fn(),
  createInternalReviewWorkspaceSlice: vi.fn(),
  listStaffReviewWorkspaces: vi.fn(),
  startReviewWorkspaceRound: mocks.startReviewWorkspaceRound,
}));

import { POST } from "@/app/api/ops/bsm/review-workspace/projects/route";

describe("review workspace invitation delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startReviewWorkspaceRound.mockResolvedValue({
      projectId: "22222222-2222-4222-8222-222222222222",
      roundId: "44444444-4444-4444-8444-444444444444",
      documentCount: 2,
      invitations: [{
        invitationId: "55555555-5555-4555-8555-555555555555",
        reviewerEmail: "owner@example.com",
        reviewerName: "Shop Owner",
        inviteToken: "private-token",
        inviteCode: "123456",
      }],
    });
    mocks.listUsers.mockResolvedValue({
      data: { users: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "owner@example.com" }] },
      error: null,
    });
    mocks.sendEmail.mockResolvedValue({ statusCode: 202, messageId: "message-1" });
  });

  it("emails each private link and marks the invitation sent", async () => {
    const response = await POST(new Request("https://hub.example/api/ops/bsm/review-workspace/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start_review",
        projectId: "22222222-2222-4222-8222-222222222222",
        reviewers: [{ email: "owner@example.com", name: "Shop Owner" }],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: { name: "Shop Owner", email: "owner@example.com" },
      clickTracking: false,
      text: expect.stringContaining("One-time code: 123456"),
    }));
    expect(mocks.startReviewWorkspaceRound).toHaveBeenCalledWith(expect.objectContaining({
      reviewers: [{ email: "owner@example.com", name: "Shop Owner", profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    }));
    expect(mocks.updateInvitation).toHaveBeenCalledWith(expect.objectContaining({
      status: "sent",
      last_code_sent_at: expect.any(String),
    }), "55555555-5555-4555-8555-555555555555");
    expect(body.failedDeliveryCount).toBe(0);
    expect(body.review.invitations[0].deliveryStatus).toBe("sent");
  });

  it("returns the secure manual link when email delivery fails", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("SendGrid unavailable"));

    const response = await POST(new Request("https://hub.example/api/ops/bsm/review-workspace/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start_review", projectId: "22222222-2222-4222-8222-222222222222", reviewers: [{ email: "owner@example.com" }] }),
    }));
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body.failedDeliveryCount).toBe(1);
    expect(body.review.invitations[0]).toMatchObject({
      inviteToken: "private-token",
      inviteCode: "123456",
      deliveryStatus: "failed",
    });
    expect(mocks.updateInvitation).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", last_code_sent_at: null }), expect.any(String));
  });
});
