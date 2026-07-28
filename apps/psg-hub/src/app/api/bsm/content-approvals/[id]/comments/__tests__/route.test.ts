import { describe, expect, it, vi } from "vitest";

const addBsmCustomerReviewComment = vi.fn();
const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        getUser,
      },
    }),
}));

vi.mock("@/lib/bsm/customer-content-review", () => ({
  addBsmCustomerReviewComment,
  BsmCustomerReviewError: class BsmCustomerReviewError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  REPLY_PHOTO_MAX_BYTES: 8 * 1024 * 1024,
}));

describe("content approval customer comments route", () => {
  it("rejects oversized multipart photo replies before parsing the form body", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const formData = vi.fn(() => {
      throw new Error("formData should not be called for oversized uploads");
    });
    const request = {
      headers: new Headers({
        "content-type": "multipart/form-data; boundary=reply-photo",
        "content-length": String(8 * 1024 * 1024 + 256 * 1024 + 1),
      }),
      formData,
    } as unknown as Request;
    const { POST } = await import("../route");

    const response = await POST(request, { params: Promise.resolve({ id: "review-1" }) });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "The photo is too large. Attach one photo under 8 MB.",
    });
    expect(formData).not.toHaveBeenCalled();
    expect(addBsmCustomerReviewComment).not.toHaveBeenCalled();
  });
});
