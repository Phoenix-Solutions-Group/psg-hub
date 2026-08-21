import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

const getGuestReviewWorkspaceFileDownload = vi.hoisted(() => vi.fn());
const getAssignedReviewerWorkspaceFileDownload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "33333333-3333-4333-8333-333333333333" } } }) } }),
}));

vi.mock("@/lib/bsm/review-workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bsm/review-workspace")>(
    "@/lib/bsm/review-workspace",
  );
  return {
    ...actual,
    bsmReviewWorkspaceInternalEnabled: () => true,
    getAssignedReviewerWorkspaceFileDownload,
    getGuestReviewWorkspaceFileDownload,
  };
});

describe("guest review workspace file route", () => {
  beforeEach(() => {
    getGuestReviewWorkspaceFileDownload.mockReset();
    getAssignedReviewerWorkspaceFileDownload.mockReset();
  });

  it("renders HTML review files inline for private reviewer sessions", async () => {
    getGuestReviewWorkspaceFileDownload.mockResolvedValueOnce({
      data: new Blob(["<!doctype html><html><body><h1>Visual proof</h1></body></html>"], { type: "text/html" }),
      originalFilename: "landing-page.html",
      contentType: "text/html",
      byteSize: 63,
    });

    const response = await GET(
      new Request(
        "https://hub.test/api/bsm/review-workspace/file?sessionHash=session-hash&reviewItemId=11111111-1111-4111-8111-111111111111&versionId=22222222-2222-4222-8222-222222222222",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="landing-page.html"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox allow-same-origin");
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'none'");
    expect(response.headers.get("Content-Security-Policy")).not.toContain("allow-scripts");
    expect(response.headers.get("Content-Security-Policy")).toContain("img-src https:");
    await expect(response.text()).resolves.toContain("<h1>Visual proof</h1>");
  });

  it("authorizes assigned-reviewer files with the logged-in profile", async () => {
    getAssignedReviewerWorkspaceFileDownload.mockResolvedValueOnce({
      data: new Blob(["proof"], { type: "application/pdf" }),
      originalFilename: "proof.pdf",
      contentType: "application/pdf",
      byteSize: 5,
    });

    const response = await GET(new Request(
      "https://hub.test/api/bsm/review-workspace/file?projectId=22222222-2222-4222-8222-222222222222&reviewItemId=11111111-1111-4111-8111-111111111111&versionId=22222222-2222-4222-8222-222222222222",
    ));

    expect(response.status).toBe(200);
    expect(getAssignedReviewerWorkspaceFileDownload).toHaveBeenCalledWith({
      projectId: "22222222-2222-4222-8222-222222222222",
      actorProfileId: "33333333-3333-4333-8333-333333333333",
      reviewItemId: "11111111-1111-4111-8111-111111111111",
      versionId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
