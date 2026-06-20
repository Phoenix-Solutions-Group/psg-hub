import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";

const DPI = 200;
const BASE_DPI = 72;
const SCALE = DPI / BASE_DPI;
export const MAX_PAGES = Infinity;

interface CanvasAndContext {
  canvas: Canvas | null;
  context: SKRSContext2D | null;
}

/**
 * pdf.js calls into this factory to obtain and release canvas instances
 * during page render. @napi-rs/canvas gives us a DOM-compatible surface
 * that works under Vercel Fluid (Node runtime) without cairo/pango deps.
 */
class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    if (!canvasAndContext.canvas) return;
    canvasAndContext.canvas.width = Math.max(1, Math.floor(width));
    canvasAndContext.canvas.height = Math.max(1, Math.floor(height));
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    if (canvasAndContext.canvas) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    }
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * Rasterize a PDF to one PNG Buffer per page at 200 DPI.
 * Throws `Error("Too many pages: N")` if the PDF exceeds MAX_PAGES.
 * Throws `Error("Invalid PDF")` if pdf.js rejects the bytes.
 */
export async function rasterizePdf(pdfBytes: Uint8Array): Promise<Buffer[]> {
  const factory = new NodeCanvasFactory();

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: pdfBytes,
      disableWorker: true,
      // pdf.js types don't cleanly expose the factory option; runtime accepts it.
      CanvasFactory: NodeCanvasFactory as unknown as never,
    } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  } catch (err) {
    throw new Error(`Invalid PDF: ${(err as Error).message}`);
  }

  if (doc.numPages > MAX_PAGES) {
    await doc.destroy();
    throw new Error(`Too many pages: ${doc.numPages}`);
  }

  const buffers: Buffer[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });
      const { canvas, context } = factory.create(viewport.width, viewport.height);
      if (!canvas || !context) throw new Error("Canvas allocation failed");

      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
      }).promise;

      buffers.push(canvas.toBuffer("image/png"));
      page.cleanup();
      factory.destroy({ canvas, context });
    }
  } finally {
    await doc.destroy();
  }

  return buffers;
}
