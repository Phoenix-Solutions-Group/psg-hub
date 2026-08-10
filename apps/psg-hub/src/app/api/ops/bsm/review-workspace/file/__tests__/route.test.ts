import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

const getStaffReviewWorkspaceFileDownload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: () => Promise.resolve({
    ok: true,
    userId: "staff-1",
    access: { role: "psg_internal", functions: new Set(["manage_bsm_content_approvals"]) },
  }),
}));

vi.mock("@/lib/bsm/review-workspace", async () => ({
  ...(await vi.importActual<typeof import("@/lib/bsm/review-workspace")>("@/lib/bsm/review-workspace")),
  bsmReviewWorkspaceInternalEnabled: () => true,
  getStaffReviewWorkspaceFileDownload,
}));

describe("staff review workspace file route", () => {
  beforeEach(() => getStaffReviewWorkspaceFileDownload.mockReset());

  it("renders inspected HTML inline with a locked-down response", async () => {
    getStaffReviewWorkspaceFileDownload.mockResolvedValueOnce({
      data: new Blob(["<!doctype html><h1>Visual proof</h1>"], { type: "text/html" }),
      originalFilename: "landing-page.html",
      contentType: "text/html",
      byteSize: 41,
    });

    const response = await GET(new Request(
      "https://hub.test/api/ops/bsm/review-workspace/file?projectId=11111111-1111-4111-8111-111111111111&reviewItemId=22222222-2222-4222-8222-222222222222&versionId=33333333-3333-4333-8333-333333333333",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="landing-page.html"');
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(response.headers.get("Content-Security-Policy")).toContain("img-src https:");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await expect(response.text()).resolves.toContain("<h1>Visual proof</h1>");
  });
});
