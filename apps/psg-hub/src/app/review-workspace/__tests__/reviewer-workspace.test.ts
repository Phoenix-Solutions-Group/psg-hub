import { describe, expect, it } from "vitest";
import { buildHighlightSegments, normalizedPointerAnchor, reviewWorkspaceCapabilities } from "@/app/review-workspace/reviewer-workspace";

describe("reviewer workspace annotations", () => {
  it("renders overlapping highlight ranges without losing text", () => {
    const segments = buildHighlightSegments("Review this headline", [
      { startOffset: 0, endOffset: 6 },
      { startOffset: 5, endOffset: 11 },
    ]);

    expect(segments.map((segment) => segment.text).join("")).toBe("Review this headline");
    expect(segments.filter((segment) => segment.highlighted).map((segment) => segment.text).join("")).toBe("Review this");
  });

  it("normalizes and clamps a click to the proof bounds", () => {
    expect(normalizedPointerAnchor(150, 75, { left: 100, top: 50, width: 200, height: 100 })).toEqual({
      xRatio: 0.25,
      yRatio: 0.25,
    });
    expect(normalizedPointerAnchor(500, 0, { left: 100, top: 50, width: 200, height: 100 })).toEqual({
      xRatio: 1,
      yRatio: 0,
    });
  });

  it("keeps assigned reviewers comment-only without decision or management controls", () => {
    expect(reviewWorkspaceCapabilities(true)).toEqual({
      canManageThreads: false,
      canReopenSubmission: false,
      canSubmitDecisions: false,
    });
    expect(reviewWorkspaceCapabilities(false)).toEqual({
      canManageThreads: true,
      canReopenSubmission: true,
      canSubmitDecisions: true,
    });
  });
});
