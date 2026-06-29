// PSG-395 (Track B) — FileMaker export table -> raw landing records.
//
// The "extractor" step: walk one parsed FM export table into faithful, as-text
// landing records. We capture the FULL source row verbatim (not just mapped
// columns) so the landing table is a lossless replay buffer — re-deriving
// canonical rows later (or adding a newly-mapped field) never needs the original
// file. The per-customer column→canonical mapping is applied DOWNSTREAM (upsert
// step), keeping the extractor identical for every customer.

import type { RawTable } from "../../types";
import { stagingContentHash } from "./content-hash";
import type { LandingRecord, StagingEntity } from "./types";

export type ExtractArgs = {
  entity: StagingEntity;
  companyId: string;
  sourceSystem: string;
  /** Originating export filename (provenance / audit), or null. */
  sourceFile: string | null;
  /** Parsed FM export table (headers + as-text rows). */
  table: RawTable;
  /** Header of the column holding the FileMaker primary key for this table. */
  sourceIdColumn: string;
};

export type ExtractResult = {
  records: LandingRecord[];
  /** Source rows dropped because they carried no primary key (cannot dedup). */
  droppedNoPk: number;
};

/**
 * Turn a parsed FM export table into landing records. Each output record carries
 * the full source row (as-text), its FileMaker PK as `sourceId`, and a stable
 * content hash. Rows missing a primary key are dropped (counted) — without a PK
 * there is no stable dedup identity, and silently synthesizing one would risk
 * duplicates on the next import.
 */
export function extractLandingRecords(args: ExtractArgs): ExtractResult {
  const { entity, companyId, sourceSystem, sourceFile, table, sourceIdColumn } = args;
  const records: LandingRecord[] = [];
  let droppedNoPk = 0;

  for (const row of table.rows) {
    const sourceId = (row[sourceIdColumn] ?? "").trim();
    if (!sourceId) {
      droppedNoPk++;
      continue;
    }
    // Faithful as-text capture of every source column, ordered by the table's
    // declared header order for readability (hash is order-independent anyway).
    const columns: Record<string, string> = {};
    for (const header of table.headers) {
      columns[header] = row[header] ?? "";
    }
    records.push({
      entity,
      companyId,
      sourceSystem,
      sourceId,
      sourceFile,
      columns,
      contentHash: stagingContentHash(columns),
    });
  }

  return { records, droppedNoPk };
}
