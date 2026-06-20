import Anthropic from "@anthropic-ai/sdk";
import type { IFormExtractor } from "../extractor";
import type { ExtractionResult, ScanField } from "../types";
import type { FormSchema } from "../schema";
import { validateField, classifyConfidence } from "../confidence";
import { normalizeCheckbox } from "../checkbox";
import { buildExtractionPrompt } from "./prompt";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

interface RawFieldResult {
  value: string | null;
  confidence: number;
}

interface RawExtractionOutput {
  page?: number;
  fields: Record<string, RawFieldResult>;
  checkboxes: Record<string, boolean | null>;
}

function parseJsonFromResponse(text: string): RawExtractionOutput | RawExtractionOutput[] {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned);
}

function mapToExtractionResult(
  parsed: RawExtractionOutput,
  schema: FormSchema,
  pageIndex: number
): ExtractionResult {
  const fields: ScanField[] = schema.fields.map((spec) => {
    const raw = parsed.fields?.[spec.key];
    const value = raw?.value ?? null;
    const rawConfidence = raw?.confidence ?? 0;
    const validation = validateField(spec, value);
    const tier = classifyConfidence(rawConfidence, validation.ok);
    return {
      key: spec.key,
      value,
      confidence: rawConfidence,
      tier,
      ...(validation.ok ? {} : { validationError: validation.error }),
    };
  });

  const checkboxes: Record<string, boolean | null> = Object.fromEntries(
    schema.checkboxes.map((c) => [c.key, normalizeCheckbox(parsed.checkboxes?.[c.key])])
  );

  return { driver: "anthropic", pageIndex, fields, checkboxes, latencyMs: 0 };
}

export class AnthropicVisionExtractor implements IFormExtractor {
  readonly name = "anthropic" as const;
  private client: Anthropic;
  private model: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }
    this.client = new Anthropic({ apiKey });
    this.model = (process.env.SCAN_MODEL || DEFAULT_MODEL).trim();
  }

  async extract(
    pageImage: Buffer,
    schema: FormSchema,
    pageIndex: number
  ): Promise<ExtractionResult> {
    const start = Date.now();
    const base64 = pageImage.toString("base64");
    const prompt = buildExtractionPrompt(schema, false);

    const isPdf = base64.startsWith("JVBER");
    const docBlock: Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } };

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: "user", content: [docBlock, { type: "text", text: prompt }] }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Anthropic response contained no text block");
    }

    let parsed: RawExtractionOutput;
    try {
      const result = parseJsonFromResponse(textBlock.text);
      parsed = Array.isArray(result) ? result[0] : result;
    } catch {
      throw new Error(`Failed to parse extraction JSON from ${this.name} driver`);
    }

    const er = mapToExtractionResult(parsed, schema, pageIndex);
    er.latencyMs = Date.now() - start;
    return er;
  }

  async extractPdf(
    pdfBytes: Buffer,
    schema: FormSchema
  ): Promise<ExtractionResult[]> {
    const start = Date.now();
    const base64 = pdfBytes.toString("base64");
    const prompt = buildExtractionPrompt(schema, true);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16384,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Anthropic response contained no text block");
    }

    let parsedArray: RawExtractionOutput[];
    try {
      const result = parseJsonFromResponse(textBlock.text);
      parsedArray = Array.isArray(result) ? result : [result];
    } catch {
      throw new Error(`Failed to parse extraction JSON from ${this.name} driver`);
    }

    const elapsed = Date.now() - start;
    const perPage = Math.round(elapsed / parsedArray.length);

    return parsedArray.map((p, i) => {
      const er = mapToExtractionResult(p, schema, i);
      er.latencyMs = perPage;
      return er;
    });
  }
}
