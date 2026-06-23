// CCC Secure Share — Phase 3 supabase-backed CccAccountStore. [PSG-267]
//
// The pure state machine (Approve/Decline/Revoke) lives in ./approval-queue.ts. This is the
// thin, server-only persistence layer over the ccc_accounts table. DB access is hidden behind
// the CccAccountStore interface so the orchestration is unit-testable with an in-memory fake;
// this store is exercised end-to-end by the routes + QA. Reads/writes use the service-role
// client because ccc_accounts SELECT is gated on membership + the manage_ccc_integration
// capability (a customer session, not the operator queue) — the superadmin queue reads ALL
// shops' rows, so it goes through the service client (RLS bypass), mirroring /ops/intel's
// service-client read path. The route's requireSuperadmin() gate is the access control.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CccConnectionStatus } from "@/lib/ccc/connection-state";
import type { CccAccountRow, CccAccountStore } from "./approval-queue";

const TABLE = "ccc_accounts";
const COLUMNS =
  "id, shop_id, ccc_account_id, facility_id, connection_status, enabled_at, " +
  "last_event_at, last_event_label, approved_by, approved_at, declined_reason, error_reason";

/** Supabase-backed CccAccountStore (service-role client; RLS bypassed by design). */
export function supabaseCccAccountStore(service: SupabaseClient): CccAccountStore {
  return {
    async get(id) {
      const { data, error } = await service
        .from(TABLE)
        .select(COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`ccc-accounts get failed: ${error.message}`);
      return (data as unknown as CccAccountRow | null) ?? null;
    },
    async update(id, patch) {
      const { data, error } = await service
        .from(TABLE)
        .update(patch)
        .eq("id", id)
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`ccc-accounts update failed: ${error.message}`);
      return data as unknown as CccAccountRow;
    },
    async list(statuses?: CccConnectionStatus[]) {
      let q = service.from(TABLE).select(COLUMNS);
      if (statuses && statuses.length > 0) q = q.in("connection_status", statuses);
      // Newest enable first; nulls (never-enabled) sort last.
      const { data, error } = await q.order("enabled_at", {
        ascending: false,
        nullsFirst: false,
      });
      if (error) throw new Error(`ccc-accounts list failed: ${error.message}`);
      return (data as unknown as CccAccountRow[] | null) ?? [];
    },
  };
}
