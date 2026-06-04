import { describe, it, expect, vi, beforeEach } from "vitest";

let insertResult: { error: unknown } = { error: null };
let insertThrows = false;
const insertSpy = vi.fn(() => {
  if (insertThrows) throw new Error("connection lost");
  return Promise.resolve(insertResult);
});

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({ insert: insertSpy })),
  })),
}));

const { logLLMCall } = await import("@/lib/logging/llm-call");

const entry = {
  userId: "u1",
  shopId: "shopA",
  reviewId: "r1",
  purpose: "review_response_draft",
  result: "success" as const,
};

beforeEach(() => {
  insertResult = { error: null };
  insertThrows = false;
  insertSpy.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("logLLMCall", () => {
  it("inserts a row and does not throw on success", async () => {
    await expect(logLLMCall(entry)).resolves.toBeUndefined();
    expect(insertSpy).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs but does not throw when the insert returns an error", async () => {
    insertResult = { error: { message: "duplicate key" } };
    await expect(logLLMCall(entry)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("swallows an unexpected throw (logging must never break the caller)", async () => {
    insertThrows = true;
    await expect(logLLMCall(entry)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
