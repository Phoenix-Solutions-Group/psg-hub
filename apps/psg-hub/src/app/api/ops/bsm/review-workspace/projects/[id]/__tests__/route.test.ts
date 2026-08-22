import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateReviewWorkspaceProject: vi.fn(),
  revokeReviewWorkspaceInvitation: vi.fn(),
  closeReviewWorkspaceRoundEarly: vi.fn(),
  addStaffThreadReply: vi.fn(),
  addStaffReviewAnnotation: vi.fn(),
  setStaffThreadStatus: vi.fn(),
  addReviewWorkspaceCollaborator: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: vi.fn(async () => ({ ok: true, userId: "33333333-3333-4333-8333-333333333333", access: { role: "psg_superadmin" } })),
  requireSuperadmin: vi.fn(),
}));
vi.mock("@/lib/bsm/review-workspace", () => ({
  ReviewWorkspaceInputError: class extends Error { status = 400; },
  addReviewWorkspaceCollaborator: mocks.addReviewWorkspaceCollaborator,
  addStaffThreadReply: mocks.addStaffThreadReply,
  addStaffReviewAnnotation: mocks.addStaffReviewAnnotation,
  closeReviewWorkspaceRoundEarly: mocks.closeReviewWorkspaceRoundEarly,
  getStaffReviewWorkspaceResult: vi.fn(),
  removeReviewWorkspaceProject: vi.fn(),
  revokeReviewWorkspaceInvitation: mocks.revokeReviewWorkspaceInvitation,
  setStaffThreadStatus: mocks.setStaffThreadStatus,
  updateReviewWorkspaceProject: mocks.updateReviewWorkspaceProject,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ auth: { admin: { listUsers: mocks.listUsers } } }),
}));

import { PATCH } from "@/app/api/ops/bsm/review-workspace/projects/[id]/route";

const context = { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) };

describe("review workspace admin actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates workspace details through the shared project route", async () => {
    mocks.updateReviewWorkspaceProject.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", title: "Revised review" });
    const response = await PATCH(new Request("https://hub.example/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_workspace", title: "Revised review", description: "Review these files." }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.updateReviewWorkspaceProject).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "22222222-2222-4222-8222-222222222222",
      title: "Revised review",
      description: "Review these files.",
    }));
  });

  it("resolves a PSG user by email and adds them as a workspace collaborator", async () => {
    mocks.listUsers.mockResolvedValue({
      data: { users: [{ id: "44444444-4444-4444-8444-444444444444", email: "teammate@psgweb.com" }] },
      error: null,
    });
    mocks.addReviewWorkspaceCollaborator.mockResolvedValue({
      profileId: "44444444-4444-4444-8444-444444444444",
      role: "collaborator",
    });

    const response = await PATCH(new Request("https://hub.example/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_collaborator", email: "Teammate@PSGWeb.com" }),
    }), context);

    expect(response.status).toBe(201);
    expect(mocks.addReviewWorkspaceCollaborator).toHaveBeenCalledWith(expect.objectContaining({
      collaboratorProfileId: "44444444-4444-4444-8444-444444444444",
    }));
  });

  it("routes reviewer revocation without closing the whole round", async () => {
    mocks.revokeReviewWorkspaceInvitation.mockResolvedValue({ status: "revoked" });
    const response = await PATCH(new Request("https://hub.example/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke_invitation", invitationId: "55555555-5555-4555-8555-555555555555", reason: "Reviewer changed." }),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.revokeReviewWorkspaceInvitation).toHaveBeenCalledWith(expect.objectContaining({
      invitationId: "55555555-5555-4555-8555-555555555555",
      reason: "Reviewer changed.",
    }));
    expect(mocks.closeReviewWorkspaceRoundEarly).not.toHaveBeenCalled();
  });

  it("routes PSG replies and thread resolution through the authorized project", async () => {
    mocks.addStaffThreadReply.mockResolvedValue({ id: "reply-1" });
    mocks.setStaffThreadStatus.mockResolvedValue({ threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "needs_clarification" });

    const reply = await PATCH(new Request("https://hub.example/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reply_thread", threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", body: "Updated proof is ready." }),
    }), context);
    const resolved = await PATCH(new Request("https://hub.example/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_thread_status", threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "needs_clarification" }),
    }), context);

    expect(reply.status).toBe(201);
    expect(resolved.status).toBe(200);
    expect(mocks.addStaffThreadReply).toHaveBeenCalledWith(expect.objectContaining({ projectId: "22222222-2222-4222-8222-222222222222", body: "Updated proof is ready." }));
    expect(mocks.setStaffThreadStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "needs_clarification" }));
  });

  it("routes PSG pin comments through the authorized project", async () => {
    mocks.addStaffReviewAnnotation.mockResolvedValue({ id: "comment-1" });
    const response = await PATCH(new Request("https://hub.example/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_annotation",
        reviewItemId: "77777777-7777-4777-8777-777777777777",
        versionId: "88888888-8888-4888-8888-888888888888",
        body: "Move this callout higher.",
        viewport: "desktop",
        xRatio: 0.4,
        yRatio: 0.6,
      }),
    }), context);

    expect(response.status).toBe(201);
    expect(mocks.addStaffReviewAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "22222222-2222-4222-8222-222222222222",
      body: "Move this callout higher.",
      xRatio: 0.4,
      yRatio: 0.6,
    }));
  });
});
