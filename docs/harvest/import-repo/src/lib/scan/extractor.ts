import type { ExtractionResult, ScanDriver } from "./types";
import type { FormSchema } from "./schema";
import { MockExtractor } from "./drivers/mock";
import { AnthropicVisionExtractor } from "./drivers/anthropic-vision";

export interface IFormExtractor {
  readonly name: ScanDriver;
  extract(
    pageImage: Buffer,
    schema: FormSchema,
    pageIndex: number
  ): Promise<ExtractionResult>;
}

/**
 * Resolve a driver by name. Falls back to env SCAN_DRIVER, then "mock".
 *
 * Plan 04-5-01 ships the mock driver only. Nanonets + Anthropic land in 04-5-02.
 * Requesting an un-installed driver throws a loud error so UI/tests surface it
 * during setup rather than silently degrading.
 */
export function getExtractor(name?: ScanDriver): IFormExtractor {
  const driver: ScanDriver =
    (name as ScanDriver) ??
    (process.env.SCAN_DRIVER as ScanDriver) ??
    "mock";

  switch (driver) {
    case "mock":
      return new MockExtractor();
    case "anthropic":
      return new AnthropicVisionExtractor();
    case "nanonets":
    case "modular":
      throw new Error(
        `Driver "${driver}" not installed. Set SCAN_DRIVER=mock or SCAN_DRIVER=anthropic.`
      );
    default: {
      const exhaustive: never = driver;
      throw new Error(`Unknown SCAN_DRIVER: ${String(exhaustive)}`);
    }
  }
}

/**
 * Run the configured driver; fall back to mock on any thrown error.
 * Plan 04-5-02 will replace the mock fallback with the anthropic driver.
 */
export async function extractWithFallback(
  pageImage: Buffer,
  schema: FormSchema,
  pageIndex: number
): Promise<ExtractionResult> {
  const primary = getExtractor();
  try {
    return await primary.extract(pageImage, schema, pageIndex);
  } catch (err) {
    console.warn(
      `[scan] primary driver ${primary.name} failed; falling back to mock`,
      { errorClass: (err as Error).name }
    );
    const fallback = new MockExtractor();
    return await fallback.extract(pageImage, schema, pageIndex);
  }
}
