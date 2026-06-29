// PSG-395 (Track B) — Live supabase IngestStore (service-role, RLS-bypass).
//
// Thin glue between the pure orchestrator (ingest.ts) and the database. All
// access is via the service-role client (bypasses RLS) — the same posture the
// v1.1 commit route uses for ingestion. The staging landing tables live in the
// `staging` schema; reaching them through PostgREST requires that schema be in
// the project's exposed-schemas config (operator step, alongside the prod
// `supabase db push` — see the migration header). The canonical writes mirror
// the v1.1 commit route's customer+RO/estimate shaping, plus the provenance
// columns (source_system, source_id, content_hash) this track adds.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalWriteArgs, ExistingCanonicalRow, IngestStore } from "./ingest";
import type { LandingRecord, StagingEntity } from "./types";

/** entity -> { canonical business-key column, landing table (in staging schema). */
const ENTITY_DB: Record<
  StagingEntity,
  { canonicalTable: string; businessKeyCol: string; landingTable: string }
> = {
  repair_order: {
    canonicalTable: "repair_orders",
    businessKeyCol: "ro_number",
    landingTable: "fm_repair_orders",
  },
  estimate: {
    canonicalTable: "estimates",
    businessKeyCol: "estimate_number",
    landingTable: "fm_estimates",
  },
};

/** Map a landing record to its staging-table row shape. */
function landingRow(record: LandingRecord) {
  return {
    company_id: record.companyId,
    source_system: record.sourceSystem,
    source_id: record.sourceId,
    source_file: record.sourceFile,
    content_hash: record.contentHash,
    columns: record.columns,
  };
}

export function createSupabaseIngestStore(service: SupabaseClient): IngestStore {
  return {
    async landLanding(entity, records) {
      if (records.length === 0) return 0;
      const { landingTable } = ENTITY_DB[entity];
      const { error } = await service
        .schema("staging")
        .from(landingTable)
        .upsert(records.map(landingRow), { onConflict: "company_id,source_system,source_id" });
      if (error) throw new Error(`landLanding(${entity}): ${error.message}`);
      return records.length;
    },

    async findCanonical(entity, companyId, businessKey): Promise<ExistingCanonicalRow | null> {
      const { canonicalTable, businessKeyCol } = ENTITY_DB[entity];
      const { data, error } = await service
        .from(canonicalTable)
        .select("id, content_hash, source_system, source_id")
        .eq("company_id", companyId)
        .eq(businessKeyCol, businessKey)
        .maybeSingle();
      if (error) throw new Error(`findCanonical(${entity}): ${error.message}`);
      if (!data) return null;
      return {
        id: data.id as string,
        contentHash: (data.content_hash as string | null) ?? null,
        sourceSystem: (data.source_system as string | null) ?? null,
        sourceId: (data.source_id as string | null) ?? null,
      };
    },

    async insertCanonical(entity, args) {
      const customerId = await insertCustomer(service, args);
      const { canonicalTable } = ENTITY_DB[entity];
      const { error } = await service.from(canonicalTable).insert({
        company_id: args.companyId,
        repair_customer_id: customerId,
        source_system: args.sourceSystem,
        source_id: args.sourceId,
        content_hash: args.contentHash,
        ...canonicalFields(entity, args),
      });
      if (error) {
        // Don't orphan the just-created customer.
        await service.from("repair_customers").delete().eq("id", customerId);
        throw new Error(`insertCanonical(${entity}): ${error.message}`);
      }
    },

    async updateCanonical(entity, id, args) {
      const { canonicalTable } = ENTITY_DB[entity];
      const { error } = await service
        .from(canonicalTable)
        .update({
          source_system: args.sourceSystem,
          source_id: args.sourceId,
          content_hash: args.contentHash,
          ...canonicalFields(entity, args),
        })
        .eq("id", id);
      if (error) throw new Error(`updateCanonical(${entity}): ${error.message}`);
    },
  };
}

/** Insert the embedded customer (mirrors the v1.1 commit route). */
async function insertCustomer(service: SupabaseClient, args: CanonicalWriteArgs): Promise<string> {
  const c = args.record.customer;
  const { data, error } = await service
    .from("repair_customers")
    .insert({
      company_id: args.companyId,
      first_name: c.first_name,
      last_name: c.last_name,
      phone: c.phone,
      email: c.email,
      address: c.address,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertCustomer: ${error?.message ?? "no row"}`);
  return data.id as string;
}

/** Canonical RO/estimate column payload (mirrors the v1.1 commit route shape). */
function canonicalFields(entity: StagingEntity, args: CanonicalWriteArgs): Record<string, unknown> {
  if (entity === "repair_order") {
    const ro = args.record.ro!;
    return {
      ro_number: ro.ro_number,
      total_loss_flag: ro.total_loss_flag,
      dates_json: ro.dates_json,
      payload_jsonb: {
        ...ro.payload_jsonb,
        vehicle: { make: ro.vehicle_make, model: ro.vehicle_model },
      },
    };
  }
  const est = args.record.estimate!;
  return {
    estimate_number: est.estimate_number,
    payload_jsonb: est.payload_jsonb,
  };
}
