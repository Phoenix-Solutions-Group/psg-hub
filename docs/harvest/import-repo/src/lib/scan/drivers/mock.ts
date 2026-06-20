import type { IFormExtractor } from "../extractor";
import type { ExtractionResult, ScanField } from "../types";
import type { FormSchema } from "../schema";

/**
 * Deterministic mock extractor used by plan 04-5-01.
 * Lets UI (04-5-03) and smoke tests run without a real inference endpoint.
 * Every field returns `MOCK_<key>`, every checkbox returns false.
 */
export class MockExtractor implements IFormExtractor {
  readonly name = "mock" as const;

  async extract(
    _pageImage: Buffer,
    schema: FormSchema,
    pageIndex: number
  ): Promise<ExtractionResult> {
    const fields: ScanField[] = schema.fields.map((spec) => ({
      key: spec.key,
      value: `MOCK_${spec.key}`,
      confidence: 0.8,
      tier: "medium",
    }));
    const checkboxes: Record<string, boolean | null> = Object.fromEntries(
      schema.checkboxes.map((c) => [c.key, false])
    );
    return {
      driver: "mock",
      pageIndex,
      fields,
      checkboxes,
      latencyMs: 10,
    };
  }
}
