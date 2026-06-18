import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Append-only audit trail for superadmin / admin actions (v1.5, PSG-29).
 *
 * Every privileged write in the admin surface MUST call recordAuditEvent so the
 * `access_audit` table holds a complete, immutable history (the table itself
 * rejects UPDATE/DELETE — see migration 20260618130000). Writes use the
 * service-role client because `access_audit` is RLS default-deny with no
 * INSERT policy; superadmins read it back through the RLS SELECT policy.
 */

/**
 * Closed vocabulary of auditable admin actions. Keep in sync with the admin
 * server actions that emit them — one constant per mutating operation so the
 * audit UI can filter/label without parsing free text.
 */
export const AUDIT_ACTIONS = [
  // users / roles / shops
  "role.grant",
  "role.revoke",
  "shop.assign",
  "shop.unassign",
  "tier.change",
  // modules + access matrix
  "module.visibility.set",
  "module_access.grant",
  "module_access.deny",
  "module_access.clear",
  // security profiles — legacy per-user functions_jsonb (security_profiles)
  "security_profile.fn.grant",
  "security_profile.fn.revoke",
  // security profiles — named-profile model (v1.1: security_profile_defs +
  // user_security_profile_assignments)
  "security_profile.assign",
  "security_profile.unassign",
  // named security-profile catalog CRUD (v1.1 / PSG-39: security_profile_defs)
  "security_profile_def.create",
  "security_profile_def.update",
  "security_profile_def.delete",
  // superadmin allowlist
  "superadmin.add",
  "superadmin.remove",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

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
