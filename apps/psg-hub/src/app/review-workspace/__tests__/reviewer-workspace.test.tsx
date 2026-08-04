import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PdfProofFrame } from "../reviewer-workspace";

describe("review workspace PDF proof rendering", () => {
  it("embeds PDF proofs in an inline frame without the Chrome object fallback text", () => {
    const html = renderToStaticMarkup(
      <PdfProofFrame
        title="July homepage proof"
        url="/api/bsm/review-workspace/file?sessionHash=session-hash&reviewItemId=11111111-1111-4111-8111-111111111111&versionId=22222222-2222-4222-8222-222222222222"
      />,
    );

    expect(html).toContain("<iframe");
    expect(html).toContain("/api/bsm/review-workspace/file?");
    expect(html).toContain("July homepage proof PDF proof");
    expect(html).not.toContain("Chrome could not show this PDF inline");
  });
});
