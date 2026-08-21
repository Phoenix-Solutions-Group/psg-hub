import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addAssignedReviewerAnnotation: vi.fn(),
  getAssignedReviewerWorkspace: vi.fn(),
  setGuestThreadStatus: vi.fn(),
  submitAssignedReviewerRound: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "33333333-3333-4333-8333-333333333333" } } }) },
  }),
}));

vi.mock("@/lib/bsm/review-workspace", () => ({
  ReviewWorkspaceInputError: class extends Error { status = 403; },
  addAssignedReviewerAnnotation: mocks.addAssignedReviewerAnnotation,
  addAssignedReviewerThreadReply: vi.fn(),
  addGuestReviewAnnotation: vi.fn(),
  addGuestThreadReply: vi.fn(),
  bsmReviewWorkspaceInternalEnabled: () => true,
  getAssignedReviewerWorkspace: mocks.getAssignedReviewerWorkspace,
  getGuestReviewWorkspace: vi.fn(),
  reopenGuestReviewRound: vi.fn(),
  setGuestThreadStatus: mocks.setGuestThreadStatus,
  submitAssignedReviewerRound: mocks.submitAssignedReviewerRound,
  submitGuestReviewRound: vi.fn(),
}));

import { PATCH as patchComments, POST as postComments } from "@/app/api/bsm/review-workspace/comments/route";
import { POST as reopenReview } from "@/app/api/bsm/review-workspace/reopen/route";
import { POST as loadSession } from "@/app/api/bsm/review-workspace/session/route";
import { POST as submitReview } from "@/app/api/bsm/review-workspace/submit/route";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function request(path: string, body: Record<string, unknown>) {
  return new Request(`https://hub.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("assigned reviewer routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAssignedReviewerWorkspace.mockResolvedValue({ project: { id: PROJECT_ID } });
    mocks.addAssignedReviewerAnnotation.mockResolvedValue({ id: "comment-1" });
    mocks.submitAssignedReviewerRound.mockResolvedValue({ status: "submitted" });
  });

  it("loads, comments, and submits through the logged-in reviewer identity", async () => {
    const sessionResponse = await loadSession(request("/api/bsm/review-workspace/session", { projectId: PROJECT_ID }));
    expect(sessionResponse.status).toBe(200);
    expect(mocks.getAssignedReviewerWorkspace).toHaveBeenCalledWith(PROJECT_ID, USER_ID);

    const commentResponse = await postComments(request("/api/bsm/review-workspace/comments", {
      projectId: PROJECT_ID,
      reviewItemId: "77777777-7777-4777-8777-777777777777",
      versionId: "88888888-8888-4888-8888-888888888888",
      body: "Please adjust this.",
      pinNumber: 1,
      viewport: "desktop",
      xRatio: 0.4,
      yRatio: 0.6,
    }));
    expect(commentResponse.status).toBe(201);
    expect(mocks.addAssignedReviewerAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      actorProfileId: USER_ID,
      body: "Please adjust this.",
    }));

    const submitResponse = await submitReview(request("/api/bsm/review-workspace/submit", {
      projectId: PROJECT_ID,
      decisions: [{ reviewItemId: "77777777-7777-4777-8777-777777777777", versionId: "88888888-8888-4888-8888-888888888888", decision: "approved" }],
    }));
    expect(submitResponse.status).toBe(201);
    expect(mocks.submitAssignedReviewerRound).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      actorProfileId: USER_ID,
    }));
  });

  it("forbids thread management and submission reopen controls", async () => {
    const threadResponse = await patchComments(request("/api/bsm/review-workspace/comments", { projectId: PROJECT_ID, threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "resolved" }));
    expect(threadResponse.status).toBe(403);
    expect(mocks.setGuestThreadStatus).not.toHaveBeenCalled();

    const reopenResponse = await reopenReview(request("/api/bsm/review-workspace/reopen", { projectId: PROJECT_ID }));
    expect(reopenResponse.status).toBe(403);
  });
});
