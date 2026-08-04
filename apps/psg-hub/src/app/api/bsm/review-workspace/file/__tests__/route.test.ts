import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

const getGuestReviewWorkspaceFileDownload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/bsm/review-workspace", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bsm/review-workspace")>(
    "@/lib/bsm/review-workspace",
  );
  return {
    ...actual,
    bsmReviewWorkspaceInternalEnabled: () => true,
    getGuestReviewWorkspaceFileDownload,
  };
});

describe("guest review workspace file route", () => {
  beforeEach(() => {
    getGuestReviewWorkspaceFileDownload.mockReset();
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
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(response.headers.get("Content-Security-Policy")).toContain("img-src data: blob: https:");
    await expect(response.text()).resolves.toContain("<h1>Visual proof</h1>");
  });

  it("renders .html files as pages when storage labels them as plain text", async () => {
    getGuestReviewWorkspaceFileDownload.mockResolvedValueOnce({
      data: new Blob(["<!doctype html><html><body><h1>Saved page</h1></body></html>"], { type: "text/plain" }),
      originalFilename: "saved-proof.html",
      contentType: "text/plain",
      byteSize: 61,
    });

    const response = await GET(
      new Request(
        "https://hub.test/api/bsm/review-workspace/file?sessionHash=session-hash&reviewItemId=11111111-1111-4111-8111-111111111111&versionId=22222222-2222-4222-8222-222222222222",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    await expect(response.text()).resolves.toContain("<h1>Saved page</h1>");
  });

  it("keeps PDF files inline without a page policy that can block Chrome's PDF viewer", async () => {
    getGuestReviewWorkspaceFileDownload.mockResolvedValueOnce({
      data: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
      originalFilename: "review-proof.pdf",
      contentType: "application/pdf",
      byteSize: 8,
    });

    const response = await GET(
      new Request(
        "https://hub.test/api/bsm/review-workspace/file?sessionHash=session-hash&reviewItemId=11111111-1111-4111-8111-111111111111&versionId=22222222-2222-4222-8222-222222222222",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="review-proof.pdf"');
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
