// PSG-245 / Wave 2 (G-d) — supabase-backed ApprovalQueueStore.
//
// The pure gate (state machine + orchestration) lives in ./gate.ts. This is the
// thin, server-only persistence layer over the approval_queue table. DB access is
// hidden behind the ApprovalQueueStore interface so the orchestration is
// unit-testable with an in-memory fake; this store is exercised end-to-end by the
// routes + QA. Writes use the service-role client because approval_queue is RLS
// default-deny with a SELECT-only policy (no INSERT/UPDATE policy) — writes happen
// only after the route's per-shop owner/manager app gate, mirroring the rest of
// the production module.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalQueueRow, ApprovalQueueStore, ApprovalStatus } from "./gate";

const TABLE = "approval_queue";
const COLUMNS =
  "id, shop_id, action_type, title, summary, payload_jsonb, status, proposed_by, " +
  "decided_by_profile_id, decided_by_name, decided_at, decision_notes, " +
  "published_at, publish_error, created_at, updated_at";

/** Supabase-backed ApprovalQueueStore (service-role client; RLS bypassed by design). */
export function supabaseApprovalQueueStore(service: SupabaseClient): ApprovalQueueStore {
  return {
    async insert(row) {
      const { data, error } = await service
        .from(TABLE)
        .insert(row)
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`approval-queue insert failed: ${error.message}`);
      return data as unknown as ApprovalQueueRow;
    },
    async get(id) {
      const { data, error } = await service
        .from(TABLE)
        .select(COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`approval-queue get failed: ${error.message}`);
      return (data as unknown as ApprovalQueueRow | null) ?? null;
    },
    async update(id, patch) {
      const { data, error } = await service
        .from(TABLE)
        .update(patch)
        .eq("id", id)
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`approval-queue update failed: ${error.message}`);
      return data as unknown as ApprovalQueueRow;
    },
    async listByShop(shopId, statuses?: ApprovalStatus[]) {
      let q = service.from(TABLE).select(COLUMNS).eq("shop_id", shopId);
      if (statuses && statuses.length > 0) q = q.in("status", statuses);
      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw new Error(`approval-queue list failed: ${error.message}`);
      return (data as unknown as ApprovalQueueRow[] | null) ?? [];
    },
  };
}
