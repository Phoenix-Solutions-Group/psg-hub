// PSG-395 (Track B) — FileMaker full-DB → staging → canonical ingest.
// Public surface. The supabase store is intentionally NOT re-exported here so
// pure consumers/tests can import the orchestration without pulling `server-only`.
export { stagingContentHash } from "./content-hash";
export { dedupAction } from "./dedup";
export type { DedupAction, ExistingCanonical } from "./dedup";
export { extractLandingRecords } from "./extract";
export type { ExtractArgs, ExtractResult } from "./extract";
export { ingestFmTable } from "./ingest";
export type {
  CanonicalWriteArgs,
  ExistingCanonicalRow,
  IngestStore,
  IngestTableArgs,
} from "./ingest";
export {
  CANONICAL_TABLE,
  ENTITY_IMPORT_KIND,
  FILEMAKER_SOURCE_SYSTEM,
  LANDING_TABLE,
  STAGING_ENTITIES,
} from "./types";
export type { IngestStats, LandingRecord, StagingEntity } from "./types";
