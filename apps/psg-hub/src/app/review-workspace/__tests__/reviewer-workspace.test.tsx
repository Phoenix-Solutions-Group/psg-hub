import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PdfProofFrame,
  reviewDocumentTileClassName,
  reviewDocumentTileIconClassName,
  reviewDocumentTileMutedTextClassName,
} from "../reviewer-workspace";

function contrastRatio(foreground: string, background: string): number {
  function luminance(hex: string): number {
    const channels = hex
      .replace("#", "")
      .match(/.{2}/g)
      ?.map((value) => parseInt(value, 16) / 255) ?? [];
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

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

describe("review workspace document chooser contrast", () => {
  it("uses high-contrast selected colors for the document tile and nested metadata", () => {
    expect(reviewDocumentTileClassName(true)).toContain("bg-[#142838]");
    expect(reviewDocumentTileClassName(true)).toContain("text-white");
    expect(reviewDocumentTileMutedTextClassName(true)).toBe("text-white");
    expect(reviewDocumentTileIconClassName(true)).toContain("text-white");
    expect(contrastRatio("#ffffff", "#142838")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps unselected document metadata muted", () => {
    expect(reviewDocumentTileClassName(false)).toContain("bg-background");
    expect(reviewDocumentTileMutedTextClassName(false)).toBe("text-muted-foreground");
    expect(reviewDocumentTileIconClassName(false)).toContain("text-ember");
  });
});
