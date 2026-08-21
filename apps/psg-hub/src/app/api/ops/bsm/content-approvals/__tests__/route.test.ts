import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "../route";

const getStaffReviewWorkspaceResult = vi.hoisted(() => vi.fn());
const processReviewWorkspaceUploadedVersion = vi.hoisted(() => vi.fn());
const maybeSingle = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: () => Promise.resolve({
    ok: true,
    userId: "staff-1",
    access: { role: "psg_internal", functions: new Set(["manage_bsm_content_approvals"]) },
  }),
}));

vi.mock("@/lib/bsm/review-workspace", () => ({ getStaffReviewWorkspaceResult }));
vi.mock("@/lib/bsm/review-workspace-processing", () => ({
  ReviewWorkspaceProcessingError: class ReviewWorkspaceProcessingError extends Error {},
  processReviewWorkspaceUploadedVersion,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return { from: vi.fn(() => query) };
  },
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const shopId = "22222222-2222-4222-8222-222222222222";
const reviewItemId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";

function request() {
  return new Request("https://hub.test/api/ops/bsm/content-approvals", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, reviewItemId, versionId }),
  });
}

describe("content approval processing route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStaffReviewWorkspaceResult.mockResolvedValue({
      project: { id: projectId, shopId },
      documents: [{ itemId: reviewItemId, versionId: "55555555-5555-4555-8555-555555555555" }],
    });
    processReviewWorkspaceUploadedVersion.mockResolvedValue({ processingStatus: "ready" });
  });

  it("processes the current replacement version even when the closed round references the prior version", async () => {
    maybeSingle.mockResolvedValue({ data: { id: reviewItemId, current_version_id: versionId }, error: null });

    const response = await PUT(request());

    expect(response.status).toBe(200);
    expect(processReviewWorkspaceUploadedVersion).toHaveBeenCalledWith(
      { projectId, shopId, reviewItemId, versionId },
      expect.objectContaining({ client: expect.any(Object) }),
    );
  });

  it("rejects a version that is not the workspace document's current version", async () => {
    maybeSingle.mockResolvedValue({
      data: { id: reviewItemId, current_version_id: "55555555-5555-4555-8555-555555555555" },
      error: null,
    });

    const response = await PUT(request());

    expect(response.status).toBe(404);
    expect(processReviewWorkspaceUploadedVersion).not.toHaveBeenCalled();
  });
});
