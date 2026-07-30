import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

const getBsmReviewCurrentFileDownload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
      },
    }),
}));

vi.mock("@/lib/bsm/customer-content-review", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bsm/customer-content-review")>(
    "@/lib/bsm/customer-content-review",
  );
  return {
    ...actual,
    getBsmReviewCurrentFileDownload,
  };
});

const REVIEW_ITEM_ID = "11111111-1111-4111-8111-111111111111";

async function getFileResponse(input: { filename: string; contentType: string }) {
  getBsmReviewCurrentFileDownload.mockResolvedValueOnce({
    data: new Blob([new Uint8Array([1, 2, 3])], { type: input.contentType }),
    originalFilename: input.filename,
    contentType: input.contentType,
    byteSize: 3,
  });

  return GET(new Request(`https://hub.test/api/bsm/content-approvals/${REVIEW_ITEM_ID}/file`), {
    params: Promise.resolve({ id: REVIEW_ITEM_ID }),
  });
}

describe("content approval current-file route", () => {
  beforeEach(() => {
    getBsmReviewCurrentFileDownload.mockReset();
  });

  it("allows safe browser-inline file types", async () => {
    for (const file of [
      { filename: "proof.pdf", contentType: "application/pdf" },
      { filename: "before-after.png", contentType: "image/png" },
      { filename: "copy.txt", contentType: "text/plain" },
      { filename: "copy.md", contentType: "text/markdown" },
    ]) {
      const response = await getFileResponse(file);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toBe(`inline; filename="${file.filename}"`);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  it("forces HTML and Word uploads to open as attachments", async () => {
    for (const file of [
      { filename: "landing.html", contentType: "text/html" },
      {
        filename: "mailer.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ]) {
      const response = await getFileResponse(file);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${file.filename}"`);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("rejects malformed review item ids before file lookup", async () => {
    const response = await GET(new Request("https://hub.test/api/bsm/content-approvals/not-a-uuid/file"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(getBsmReviewCurrentFileDownload).not.toHaveBeenCalled();
  });
});
