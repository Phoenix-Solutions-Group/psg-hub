import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
// The action vocabulary lives in a pure, server-only-free module so client code
// (the audit viewer) can import it without dragging this file's service client
// into the client bundle. Re-exported here for back-compat with existing importers.
import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit/actions";

/**
 * Append-only audit trail for superadmin / admin actions (v1.5, PSG-29).
 *
 * Every privileged write in the admin surface MUST call recordAuditEvent so the
 * `access_audit` table holds a complete, immutable history (the table itself
 * rejects UPDATE/DELETE — see migration 20260618130000). Writes use the
 * service-role client because `access_audit` is RLS default-deny with no
 * INSERT policy; superadmins read it back through the RLS SELECT policy.
 */

export { AUDIT_ACTIONS, type AuditAction };

export type AuditEvent = {
  /** Acting superadmin's profile id (auth.uid()). Required. */
  actorProfileId: string;
  action: AuditAction;
  /** Target user, when the action acts on a user. */
  targetProfileId?: string | null;
  /** Target shop, when the action acts on a shop. */
  targetShopId?: string | null;
  /** Structured before/after or parameters of the change. */
  payload?: Record<string, unknown>;
};

export type AuditRow = {
  actor_profile_id: string;
  target_profile_id: string | null;
  target_shop_id: string | null;
  action: AuditAction;
  payload_jsonb: Record<string, unknown>;
};

/**
 * Pure mapping from a domain event to the DB row shape — no I/O, unit-tested.
 * Normalises optional/undefined targets to explicit nulls and defaults payload.
 * Throws on a missing actor or an action outside the closed vocabulary so a
 * mis-wired caller fails loudly rather than writing an untraceable row.
 */
export function buildAuditRow(event: AuditEvent): AuditRow {
  if (!event.actorProfileId) {
    throw new Error("recordAuditEvent: actorProfileId is required");
  }
  if (!AUDIT_ACTIONS.includes(event.action)) {
    throw new Error(`recordAuditEvent: unknown action "${event.action}"`);
  }
  return {
    actor_profile_id: event.actorProfileId,
    target_profile_id: event.targetProfileId ?? null,
    target_shop_id: event.targetShopId ?? null,
    action: event.action,
    payload_jsonb: event.payload ?? {},
  };
}

/**
 * Persist one audit row. Call AFTER the underlying mutation succeeds so the
 * trail reflects committed changes. Returns the inserted row id.
 */
export async function recordAuditEvent(event: AuditEvent): Promise<string> {
  const row = buildAuditRow(event);
  const service = createServiceClient();
  const { data, error } = await service
    .from("access_audit")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    throw new Error(`recordAuditEvent failed (${event.action}): ${error.message}`);
  }
  return data.id as string;
}
