import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateReviewWorkspaceProject: vi.fn(),
  revokeReviewWorkspaceInvitation: vi.fn(),
  closeReviewWorkspaceRoundEarly: vi.fn(),
  addStaffThreadReply: vi.fn(),
  setStaffThreadStatus: vi.fn(),
}));

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: vi.fn(async () => ({ ok: true, userId: "33333333-3333-4333-8333-333333333333", access: { role: "psg_superadmin" } })),
  requireSuperadmin: vi.fn(),
}));
vi.mock("@/lib/bsm/review-workspace", () => ({
  ReviewWorkspaceInputError: class extends Error { status = 400; },
  addStaffThreadReply: mocks.addStaffThreadReply,
  closeReviewWorkspaceRoundEarly: mocks.closeReviewWorkspaceRoundEarly,
  getStaffReviewWorkspaceResult: vi.fn(),
  removeReviewWorkspaceProject: vi.fn(),
  revokeReviewWorkspaceInvitation: mocks.revokeReviewWorkspaceInvitation,
  setStaffThreadStatus: mocks.setStaffThreadStatus,
  updateReviewWorkspaceProject: mocks.updateReviewWorkspaceProject,
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
    mocks.setStaffThreadStatus.mockResolvedValue({ threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "resolved" });

    const reply = await PATCH(new Request("https://hub.example/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reply_thread", threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", body: "Updated proof is ready." }),
    }), context);
    const resolved = await PATCH(new Request("https://hub.example/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_thread_status", threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "resolved" }),
    }), context);

    expect(reply.status).toBe(201);
    expect(resolved.status).toBe(200);
    expect(mocks.addStaffThreadReply).toHaveBeenCalledWith(expect.objectContaining({ projectId: "22222222-2222-4222-8222-222222222222", body: "Updated proof is ready." }));
    expect(mocks.setStaffThreadStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "resolved" }));
  });
});
