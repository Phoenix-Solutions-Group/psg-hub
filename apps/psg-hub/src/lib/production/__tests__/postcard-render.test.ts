import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  POSTCARD_SIZE_SPECS,
  renderPostcardPdf,
  validatePostcardComposition,
  renderPostcardCanvas,
  renderMailArtworkDesignPdf,
  DEFAULT_CLEAR_ZONES,
} from "@/lib/production/postcard-render";

function toPts(inches: number): number {
  return inches * 72;
}

async function makeTemplate(size: keyof typeof POSTCARD_SIZE_SPECS): Promise<Uint8Array> {
  const { trimWidthIn, trimHeightIn } = POSTCARD_SIZE_SPECS[size];
  const template = await PDFDocument.create();
  const page = template.addPage([toPts(trimWidthIn), toPts(trimHeightIn)]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 0.1,
    height: 0.1,
  });
  return new Uint8Array(await template.save());
}

function onePixelPng(): Uint8Array {
  return new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64"
    )
  );
}

describe("postcard renderer", () => {
  it("validates a compliant 4x6 design doc with defaults", async () => {
    const template = await makeTemplate("4x6");
    const result = validatePostcardComposition({
      size: "4x6",
      front: { template: { bytes: template }, elements: [] },
      back: { template: { bytes: template }, elements: [] },
    });

    expect(result.valid).toBe(true);
    expect(result.canvas.withBleed).toEqual({ widthIn: 6.25, heightIn: 4.25 });
    expect(result.canvas.widthPx).toBe(1875);
    expect(result.canvas.heightPx).toBe(1275);
  });

  it("rejects non-300 dpi", async () => {
    const template = await makeTemplate("6x9");
    const result = validatePostcardComposition({
      size: "6x9",
      dpi: 150,
      front: { template: { bytes: template }, clearZones: DEFAULT_CLEAR_ZONES["6x9"] },
      back: { template: { bytes: template }, clearZones: DEFAULT_CLEAR_ZONES["6x9"] },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("dpi must be 300"))).toBe(true);
  });

  it("flags clear-zone and address-zone overlap errors", async () => {
    const template = await makeTemplate("6x11");
    const result = validatePostcardComposition({
      size: "6x11",
      front: {
        template: { bytes: template },
        clearZones: [{ x: 0, y: 0, width: 1, height: 1 }],
        elements: [{ kind: "rect", x: 0.5, y: 0.5, width: 0.4, height: 0.4, fillColor: "#ff0000" }],
      },
      back: {
        template: { bytes: template },
        addressZones: [{ x: 0, y: 0, width: 1, height: 1 }],
        elements: [{ kind: "rect", x: 0.5, y: 0.5, width: 0.4, height: 0.4, fillColor: "#000000" }],
      },
    });

    const kinds = new Set(result.issues.map((issue) => issue.kind));
    expect(kinds.has("clear-zone")).toBe(true);
    expect(kinds.has("address-zone")).toBe(true);
  });

  it("renders a two-page PDF with bleed sizing", async () => {
    const template4x6 = await makeTemplate("4x6");
    const rendered = await renderPostcardPdf({
      size: "4x6",
      front: { template: { bytes: template4x6 }, elements: [] },
      back: {
        template: { bytes: template4x6 },
        elements: [{ kind: "line", x1: 1, y1: 1, x2: 2, y2: 2 }],
      },
    });
    const doc = await PDFDocument.load(rendered.bytes);
    expect(doc.getPageCount()).toBe(2);

    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(toPts(6.25), 5);
    expect(page.getHeight()).toBeCloseTo(toPts(4.25), 5);
    expect(rendered.validation.valid).toBe(true);
  });

  it("renders a freeform mail_artwork_designs document with image, logo, shape, and no base template", async () => {
    const imageBytes = onePixelPng();
    const rendered = await renderMailArtworkDesignPdf({
      size: "6x9",
      front: {
        elements: [
          { kind: "shape", shape: "rect", x: 0.5, y: 4.75, width: 2, height: 0.5, fillColor: "#1E3A52" },
          { kind: "text", x: 0.75, y: 4.9, text: "Collision Leaders", fontSize: 14, color: "#ffffff" },
          { kind: "image", x: 0.5, y: 0.75, width: 1, height: 1, source: { bytes: imageBytes, format: "png" } },
        ],
      },
      back: {
        baseGraphic: { bytes: imageBytes, format: "png" },
        elements: [
          { kind: "logo", x: 0.5, y: 4.75, width: 0.75, height: 0.75, source: { bytes: imageBytes, format: "png" } },
        ],
      },
    });

    const doc = await PDFDocument.load(rendered.bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(toPts(9.25), 5);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(toPts(6.25), 5);
    expect(rendered.validation.canvas).toMatchObject({
      widthPx: 2775,
      heightPx: 1875,
      withBleed: { widthIn: 9.25, heightIn: 6.25 },
    });
  });

  it("places freeform coordinates in trim space, not bleed space", () => {
    const result = validatePostcardComposition({
      size: "4x6",
      front: {
        elements: [{ kind: "rect", x: 6.05, y: 1, width: 0.1, height: 0.1 }],
      },
      back: { elements: [] },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ surface: "front", kind: "bounds" })
    );
  });

  it("rejects image and logo elements that intrude on the Lob address/IMB clear zones", () => {
    const imageBytes = onePixelPng();
    const result = validatePostcardComposition({
      size: "4x6",
      front: {
        elements: [
          { kind: "image", x: 0.1, y: 0.1, width: 0.25, height: 0.25, source: { bytes: imageBytes, format: "png" } },
        ],
      },
      back: {
        elements: [
          { kind: "logo", x: 4.75, y: 0.75, width: 0.5, height: 0.5, source: { bytes: imageBytes, format: "png" } },
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surface: "front", kind: "clear-zone" }),
        expect.objectContaining({ surface: "back", kind: "address-zone" }),
      ])
    );
  });

  it("rejects template size mismatch at render", async () => {
    const wrongTemplate = await makeTemplate("6x11");
    const expected = makeTemplate("4x6");
    await expect(
      renderPostcardPdf({
        size: "4x6",
        front: { template: { bytes: await expected } },
        back: { template: { bytes: wrongTemplate } },
      })
    ).rejects.toThrow(/Template page size mismatch/);
  });

  it("computes canvas metadata from helper", () => {
    expect(renderPostcardCanvas("6x9", 0.125, 300).withBleed).toEqual({ widthIn: 9.25, heightIn: 6.25 });
    expect(renderPostcardCanvas("4x6", 0.125, 300).widthPx).toBe(1875);
  });
});
