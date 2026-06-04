import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK before importing the module under test.
const anthropicCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreate };
  },
}));

const { draftResponse } = await import("@/lib/reviews/responder");

const review = {
  platform: "google" as const,
  rating: 4,
  body: "Great service",
  author: "Jane",
};

beforeEach(() => {
  anthropicCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("draftResponse", () => {
  it("returns a trimmed body + usage + safety on success", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "  Thanks so much, Jane!  " }],
      usage: { input_tokens: 12, output_tokens: 8 },
    });

    const result = await draftResponse({ review, shopName: "Acme Body", tone: "warm" });

    expect(result.body).toBe("Thanks so much, Jane!");
    expect(result.modelId).toBe("claude-haiku-4-5-20251001");
    expect(result.promptVersion).toBeTruthy();
    expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 8 });
    expect(Array.isArray(result.safety.flags)).toBe(true);
    expect(anthropicCreate).toHaveBeenCalledOnce();
  });

  it("throws when ANTHROPIC_API_KEY is unset; does not call the model", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      draftResponse({ review, shopName: "Acme", tone: "default" })
    ).rejects.toThrow("ANTHROPIC_API_KEY is not set");
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("throws on an empty draft from the model", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "   " }],
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    await expect(
      draftResponse({ review, shopName: "Acme", tone: "default" })
    ).rejects.toThrow("Empty draft from model");
  });

  it("rethrows a non-timeout SDK error", async () => {
    anthropicCreate.mockRejectedValue(new Error("upstream 500"));
    await expect(
      draftResponse({ review, shopName: "Acme", tone: "default" })
    ).rejects.toThrow("upstream 500");
  });
});
