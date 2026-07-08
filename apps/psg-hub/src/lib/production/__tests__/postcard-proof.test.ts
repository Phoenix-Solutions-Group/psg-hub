import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  renderPostcardProofPdf,
  renderRegistryProofSheet,
  type ArtworkInput,
} from "@/lib/production/postcard-proof";
import { getPostcardSpec, inToPt } from "@/lib/production/postcard-registry";

// Minimal valid 1x1 PNG (transparent) — enough to prove embedPng runs.
const PNG_1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  )
);

async function parse(bytes: Uint8Array) {
  return PDFDocument.load(bytes);
}

describe("postcard-proof: render produces a valid, correctly-sized PDF", () => {
  it("emits a 2-page PDF (front, back) at the full-bleed point size", async () => {
    const bytes = await renderPostcardProofPdf({ size: "4x6", guides: true });
    expect(bytes.length).toBeGreaterThan(500);
    const doc = await parse(bytes);
    expect(doc.getPageCount()).toBe(2);
    const spec = getPostcardSpec("4x6");
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      expect(width).toBeCloseTo(inToPt(spec.fullBleed.inches.width), 3);
      expect(height).toBeCloseTo(inToPt(spec.fullBleed.inches.height), 3);
    }
  });

  it.each(["4x6", "6x9", "6x11"] as const)(
    "%s page size matches the registry",
    async (size) => {
      const doc = await parse(await renderPostcardProofPdf({ size }));
      const spec = getPostcardSpec(size);
      const { width, height } = doc.getPage(0).getSize();
      expect(width).toBeCloseTo(inToPt(spec.fullBleed.inches.width), 3);
      expect(height).toBeCloseTo(inToPt(spec.fullBleed.inches.height), 3);
    }
  );

  it("embeds uploaded PNG artwork on both faces without error", async () => {
    const art: ArtworkInput = { bytes: PNG_1x1, format: "png" };
    const bytes = await renderPostcardProofPdf({
      size: "6x9",
      front: art,
      back: art,
      guides: false,
      label: "batch-123",
    });
    const doc = await parse(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("accepts a JPEG artwork path (format switch)", async () => {
    // 1x1 JPEG.
    const JPG_1x1 = Uint8Array.from(
      Buffer.from(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
        "base64"
      )
    );
    const doc = await parse(
      await renderPostcardProofPdf({ size: "4x6", front: { bytes: JPG_1x1, format: "jpg" } })
    );
    expect(doc.getPageCount()).toBe(2);
  });
});

describe("postcard-proof: registry proof sheet", () => {
  it("renders one page per requested size", async () => {
    const doc = await parse(await renderRegistryProofSheet(["4x6", "6x9", "6x11"]));
    expect(doc.getPageCount()).toBe(3);
    const s4 = getPostcardSpec("4x6");
    expect(doc.getPage(0).getSize().width).toBeCloseTo(inToPt(s4.fullBleed.inches.width), 3);
  });

  it("defaults to all three sizes", async () => {
    const doc = await parse(await renderRegistryProofSheet());
    expect(doc.getPageCount()).toBe(3);
  });
});
