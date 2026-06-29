// PSG-395 (Track B) — FileMaker full-DB → staging → canonical ingest types.
//
// Track B builds the SCALABLE multi-customer ingest (single-RO acceptance is
// covered by Track A + the v1.1 importer). The flow is:
//
//   FM full-DB export  ->  raw landing tables (staging.fm_*, columns-as-text)
//                      ->  dedup vs. canonical by (source_system, source_id)+hash
//                      ->  upsert canonical (repair_orders/estimates) by business
//                          key ON CONFLICT  ->  zero duplicates on re-run.
//
// "next customer = new company_id + saved import_template, no code change": the
// per-customer column→canonical mapping lives in import_templates, never here.

import type { ImportKind } from "../../types";

/**
 * The canonical entities a FileMaker full-DB export feeds. Mirrors the v1.1
 * import kinds that carry a business key (repair_orders.ro_number /
 * estimates.estimate_number are both UNIQUE per company). Customer rows are
 * created/linked through the RO/estimate path (the v1.1 data model has no
 * standalone customer business key), so they ride along rather than upserting
 * independently — see `fm_repair_customers` landing note in the migration.
 */
export type StagingEntity = "repair_order" | "estimate";

export const STAGING_ENTITIES: readonly StagingEntity[] = ["repair_order", "estimate"];

/** Default source-system tag written to provenance columns. */
export const FILEMAKER_SOURCE_SYSTEM = "filemaker";

/** staging landing table for each entity. */
export const LANDING_TABLE: Record<StagingEntity, string> = {
  repair_order: "staging.fm_repair_orders",
  estimate: "staging.fm_estimates",
};

/** canonical (public) target table for each entity. */
export const CANONICAL_TABLE: Record<StagingEntity, string> = {
  repair_order: "repair_orders",
  estimate: "estimates",
};

/** The v1.1 import kind that shapes each entity (reuses validate/commit). */
export const ENTITY_IMPORT_KIND: Record<StagingEntity, ImportKind> = {
  repair_order: "ro",
  estimate: "estimate",
};

/**
 * One raw record landed from a FileMaker export. `columns` is the faithful
 * as-text capture of the source row (the landing table stores it verbatim);
 * `sourceId` is the FileMaker primary key for that record; `contentHash` is the
 * stable hash of `columns` (see content-hash.ts).
 */
export type LandingRecord = {
  entity: StagingEntity;
  companyId: string;
  sourceSystem: string;
  sourceId: string;
  sourceFile: string | null;
  columns: Record<string, string>;
  contentHash: string;
};

/** Per-entity counts from an ingest pass. */
export type IngestStats = {
  entity: StagingEntity;
  landed: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
};
