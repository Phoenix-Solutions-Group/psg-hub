// PSG-395 (Track B) — Idempotent landing -> canonical upsert with dedup.
//
// Orchestrates one ingest pass for a single FM export table:
//   1. land every source row into the raw staging table (as-text, with PK +
//      content hash), upserting on (company_id, source_system, source_id);
//   2. for each row, re-derive the canonical RO/estimate via the SAME
//      validate/commit shaping the v1.1 importer uses, then dedup against the
//      canonical table by business key and apply insert/skip/update.
//
// IDEMPOTENCY (the headline acceptance): re-running the identical export yields
// zero inserts and zero updates — every row matches an existing canonical row by
// business key with an identical content hash, so dedupAction() returns "skip".
// A row first loaded by the single-file importer (NULL provenance) is recognized
// by business key and UPDATEd once to back-fill source_system/source_id/hash;
// the next run then SKIPs it. Either way: zero duplicates.
//
// The store is a narrow port so the orchestration is unit-tested against an
// in-memory fake (see __tests__), and the live supabase implementation stays
// thin glue. dedup + hash + shaping — the parts that can be wrong — are pure.

import {
  applyMapping,
  toCommitRecord,
  validateRecords,
  type CommitRecord,
  type FieldMapping,
  type RawTable,
} from "@/lib/ops/import";
import { dedupAction, type ExistingCanonical } from "./dedup";
import { stagingContentHash } from "./content-hash";
import {
  ENTITY_IMPORT_KIND,
  type IngestStats,
  type LandingRecord,
  type StagingEntity,
} from "./types";

/** Canonical row identity + provenance the store reports for a business-key match. */
export type ExistingCanonicalRow = ExistingCanonical & { id: string };

/** Everything the store needs to write one canonical row (+ its provenance). */
export type CanonicalWriteArgs = {
  companyId: string;
  businessKey: string;
  sourceSystem: string;
  sourceId: string;
  contentHash: string;
  record: CommitRecord;
};

/**
 * Narrow persistence port. The live implementation talks to supabase
 * (service-role, RLS-bypass); tests pass an in-memory fake. Keeping the port
 * thin means the testable logic lives in this file, not in the DB glue.
 */
export interface IngestStore {
  /** Upsert raw landing rows; returns the number landed. */
  landLanding(entity: StagingEntity, records: LandingRecord[]): Promise<number>;
  /** Find an existing canonical row by business key, with its provenance. */
  findCanonical(
    entity: StagingEntity,
    companyId: string,
    businessKey: string,
  ): Promise<ExistingCanonicalRow | null>;
  /** Insert a new canonical row (and its embedded customer) with provenance. */
  insertCanonical(entity: StagingEntity, args: CanonicalWriteArgs): Promise<void>;
  /** Update an existing canonical row in place (+ back-fill provenance/hash). */
  updateCanonical(entity: StagingEntity, id: string, args: CanonicalWriteArgs): Promise<void>;
}

export type IngestTableArgs = {
  store: IngestStore;
  entity: StagingEntity;
  companyId: string;
  sourceSystem: string;
  sourceFile: string | null;
  /** Parsed FM export table (headers + as-text rows). */
  table: RawTable;
  /** Per-customer column→canonical mapping (from import_templates). */
  mapping: FieldMapping;
  /** Header of the FileMaker primary-key column for this table. */
  sourceIdColumn: string;
};

const businessKeyOf = (entity: StagingEntity, record: CommitRecord): string =>
  entity === "repair_order"
    ? (record.ro?.ro_number ?? "")
    : (record.estimate?.estimate_number ?? "");

/**
 * Ingest one FM export table into staging + canonical idempotently.
 * Returns per-entity counts. Throws only on store/IO errors; per-row validation
 * failures and missing-PK rows are counted, not thrown (one bad row never aborts
 * the batch).
 */
export async function ingestFmTable(args: IngestTableArgs): Promise<IngestStats> {
  const { store, entity, companyId, sourceSystem, sourceFile, table, mapping, sourceIdColumn } =
    args;
  const kind = ENTITY_IMPORT_KIND[entity];

  // Validate/normalize with the shared pipeline; rows[] aligns 1:1 with table.rows.
  const mapped = applyMapping(table, mapping);
  const validation = validateRecords(kind, mapping, mapped);

  const landing: LandingRecord[] = [];
  const stats: IngestStats = { entity, landed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < table.rows.length; i++) {
    const rawRow = table.rows[i];
    const sourceId = (rawRow[sourceIdColumn] ?? "").trim();
    if (!sourceId) {
      // No PK => no stable dedup identity. Count as failed; do not land/insert.
      stats.failed++;
      continue;
    }

    const columns: Record<string, string> = {};
    for (const header of table.headers) columns[header] = rawRow[header] ?? "";
    const contentHash = stagingContentHash(columns);
    landing.push({ entity, companyId, sourceSystem, sourceId, sourceFile, columns, contentHash });

    const validatedRow = validation.rows[i];
    if (!validatedRow || validatedRow.errors.length > 0) {
      // Landed raw (replayable) but not promoted to canonical until clean.
      stats.failed++;
      continue;
    }

    const record = toCommitRecord(kind, validatedRow);
    const businessKey = businessKeyOf(entity, record);
    if (!businessKey) {
      stats.failed++;
      continue;
    }

    const existing = await store.findCanonical(entity, companyId, businessKey);
    const action = dedupAction(existing, { sourceSystem, sourceId, contentHash });
    const writeArgs: CanonicalWriteArgs = {
      companyId,
      businessKey,
      sourceSystem,
      sourceId,
      contentHash,
      record,
    };

    if (action === "skip") {
      stats.skipped++;
    } else if (action === "insert") {
      await store.insertCanonical(entity, writeArgs);
      stats.inserted++;
    } else {
      await store.updateCanonical(entity, existing!.id, writeArgs);
      stats.updated++;
    }
  }

  stats.landed = await store.landLanding(entity, landing);
  return stats;
}
