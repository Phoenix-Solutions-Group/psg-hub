import type { Row } from "@/lib/processing/types";

export type ScanDriver = "nanonets" | "anthropic" | "modular" | "mock";

export type ConfidenceTier = "high" | "medium" | "low" | "invalid";

export interface ScanFieldCrop {
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScanField {
  key: string;
  value: string | null;
  confidence: number;
  tier: ConfidenceTier;
  validationError?: string;
  imageCrop?: ScanFieldCrop;
}

export interface ExtractionResult {
  driver: ScanDriver;
  pageIndex: number;
  fields: ScanField[];
  checkboxes: Record<string, boolean | null>;
  rawModelOutput?: unknown;
  latencyMs: number;
}

export type ScanJobStatus =
  | "idle"
  | "uploading"
  | "rasterizing"
  | "extracting"
  | "reviewing"
  | "ready"
  | "error";

export interface ScanJob {
  id: string;
  fileName: string;
  pageCount: number;
  status: ScanJobStatus;
  pages: ExtractionResult[];
  mergedRow: Row | null;
  error: string | null;
  startedAt: number;
  driverUsed: ScanDriver | null;
}

export interface ExtractResponse {
  jobId: string;
  status: ScanJobStatus;
  fileName: string;
  pageCount: number;
  driverUsed: ScanDriver;
  pages: ExtractionResult[];
  mergedRow: Row;
  conflicts: { key: string; values: string[] }[];
  /** base64 data URL of the original PDF for client-side review render */
  pdfDataUrl?: string;
}
