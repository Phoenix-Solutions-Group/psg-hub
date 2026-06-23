// PSG-248 — supabase-backed persistence for opt-outs + the send audit (server).
//
// Two append-only tables (migration 20260624140000_review_solicitation.sql):
//   - solicitation_opt_outs       — one immutable row per STOP/START/unsubscribe
//                                    event, idempotent on event_ref.
//   - review_solicitation_sends   — one immutable row per (approval, channel,
//                                    contact) send attempt — the send audit;
//                                    idempotent on (approval_id, channel,
//                                    contact_hash).
// Both are RLS default-deny; writes use the service-role client AFTER the gate /
// signed-webhook checks, mirroring the rest of the ops modules. The pure store
// INTERFACE (SolicitationStore) is what the publisher depends on, so the
// orchestration is unit-testable with an in-memory fake.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OptOutEvent, SolicitationChannel } from "./types";

export type SendStatus = "sent" | "failed" | "skipped";

/** One row of the send audit (mirrors review_solicitation_sends columns). */
export interface SendAuditRow {
  shop_id: string;
  approval_id: string;
  channel: SolicitationChannel;
  contact_hash: string;
  status: SendStatus;
  skip_reason?: string | null;
  provider_ref?: string | null;
  error?: string | null;
  company_id?: string | null;
  created_at?: string;
}

/** Persistence surface the publisher + routes depend on (faked in tests). */
export interface SolicitationStore {
  /** Append an opt-out/opt-in event; idempotent on event_ref. */
  recordOptOutEvent(event: OptOutEvent): Promise<void>;
  /** All opt-out events for one (channel, contact), used to fold current status. */
  getOptOutEvents(
    channel: SolicitationChannel,
    contactHash: string
  ): Promise<OptOutEvent[]>;
  /** Does a send row already exist for this (approval, channel, contact)? */
  sendExists(
    approvalId: string,
    channel: SolicitationChannel,
    contactHash: string
  ): Promise<boolean>;
  /** Append one send-audit row; idempotent on (approval_id, channel, contact_hash). */
  recordSend(row: SendAuditRow): Promise<void>;
}

const OPT_OUTS = "solicitation_opt_outs";
const SENDS = "review_solicitation_sends";

/** Supabase-backed SolicitationStore (service-role; RLS bypassed by design). */
export function supabaseSolicitationStore(
  service: SupabaseClient
): SolicitationStore {
  return {
    async recordOptOutEvent(event) {
      // ignoreDuplicates + UNIQUE(event_ref) = idempotent replay of a webhook /
      // unsubscribe click.
      const { error } = await service
        .from(OPT_OUTS)
        .upsert(
          {
            channel: event.channel,
            contact_hash: event.contact_hash,
            state: event.state,
            reason: event.reason,
            source: event.source,
            event_ref: event.event_ref,
          },
          { onConflict: "event_ref", ignoreDuplicates: true }
        );
      if (error) throw new Error(`opt-out record failed: ${error.message}`);
    },

    async getOptOutEvents(channel, contactHash) {
      const { data, error } = await service
        .from(OPT_OUTS)
        .select("channel, contact_hash, state, reason, source, event_ref, created_at")
        .eq("channel", channel)
        .eq("contact_hash", contactHash)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`opt-out lookup failed: ${error.message}`);
      return (data as unknown as OptOutEvent[] | null) ?? [];
    },

    async sendExists(approvalId, channel, contactHash) {
      const { data, error } = await service
        .from(SENDS)
        .select("id")
        .eq("approval_id", approvalId)
        .eq("channel", channel)
        .eq("contact_hash", contactHash)
        .maybeSingle();
      if (error) throw new Error(`send lookup failed: ${error.message}`);
      return data != null;
    },

    async recordSend(row) {
      const { error } = await service
        .from(SENDS)
        .upsert(
          {
            shop_id: row.shop_id,
            approval_id: row.approval_id,
            channel: row.channel,
            contact_hash: row.contact_hash,
            status: row.status,
            skip_reason: row.skip_reason ?? null,
            provider_ref: row.provider_ref ?? null,
            error: row.error ?? null,
            company_id: row.company_id ?? null,
          },
          {
            onConflict: "approval_id,channel,contact_hash",
            ignoreDuplicates: true,
          }
        );
      if (error) throw new Error(`send record failed: ${error.message}`);
    },
  };
}
