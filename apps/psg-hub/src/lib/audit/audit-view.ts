// Import from the pure action module (NOT access-audit.ts) — access-audit.ts is
// `server-only` and this file feeds a "use client" component. See actions.ts.
import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit/actions";

/**
 * Presentation helpers for the access_audit viewer (v1.5 / PSG-29 phase 3).
 *
 * Pure (no I/O) so they are unit-testable. The server page reads the rows and
 * resolves actor/target display names; these helpers turn the closed action
 * vocabulary into human labels + a coarse category for filtering, and render a
 * one-line summary of a row's payload without leaking large blobs into the UI.
 */

/** Coarse grouping used by the viewer's category filter. */
export type AuditCategory =
  | "users"
  | "modules"
  | "profiles"
  | "superadmin"
  | "intel"
  | "production"
  | "other";

const ACTION_LABELS: Record<AuditAction, string> = {
  "role.grant": "Granted role",
  "role.revoke": "Revoked role",
  "shop.assign": "Assigned to shop",
  "shop.unassign": "Removed from shop",
  "tier.change": "Changed tier",
  "module.visibility.set": "Set module visibility",
  "module_access.grant": "Allowed module (grant)",
  "module_access.deny": "Denied module (grant)",
  "module_access.clear": "Cleared module grant",
  "security_profile.fn.grant": "Granted capability",
  "security_profile.fn.revoke": "Revoked capability",
  "security_profile.assign": "Assigned security profile",
  "security_profile.unassign": "Unassigned security profile",
  "security_profile_def.create": "Created security profile",
  "security_profile_def.update": "Edited security profile",
  "security_profile_def.delete": "Deleted security profile",
  "superadmin.add": "Added superadmin",
  "superadmin.remove": "Removed superadmin",
  "intel.competitor_report.run": "Ran competitor report",
  "production.template.approve": "Approved mail template",
  "production.template.release": "Released mail template",
  "production.template.revoke": "Revoked mail template",
};

/** Human label for an action; falls back to the raw key for forward-compat. */
export function auditActionLabel(action: string): string {
  return (ACTION_LABELS as Record<string, string>)[action] ?? action;
}

/** Coarse category for an action, used by the viewer filter. */
export function auditCategory(action: string): AuditCategory {
  if (action.startsWith("role.") || action.startsWith("shop.") || action === "tier.change") {
    return "users";
  }
  if (action.startsWith("module")) return "modules";
  if (action.startsWith("security_profile")) return "profiles";
  if (action.startsWith("superadmin")) return "superadmin";
  if (action.startsWith("intel")) return "intel";
  if (action.startsWith("production")) return "production";
  return "other";
}

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  users: "Users, roles & shops",
  modules: "Module access",
  profiles: "Security profiles",
  superadmin: "Superadmin allowlist",
  intel: "Intel reports",
  production: "Mail production",
  other: "Other",
};

/** The set of known actions, ordered, for building filter option lists. */
export function knownAuditActions(): readonly AuditAction[] {
  return AUDIT_ACTIONS;
}

/**
 * Compact one-line summary of a payload for the audit table. Picks a few
 * meaningful keys (name, role, tier, effect, slug, securityProfileId) and joins
 * them; never dumps the full JSON. Returns "" when nothing notable is present.
 */
export function summarizePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const p = payload as Record<string, unknown>;
  const parts: string[] = [];
  const pick = (key: string, label?: string) => {
    const v = p[key];
    if (v === undefined || v === null) return;
    if (typeof v === "object") return; // skip nested before/after blobs
    parts.push(`${label ?? key}: ${String(v)}`);
  };
  pick("name");
  pick("slug");
  pick("role");
  pick("effect");
  pick("tier");
  pick("toTier", "tier");
  pick("visibility");
  if (parts.length === 0 && typeof p.action === "string") parts.push(String(p.action));
  return parts.join(" · ");
}

/** Keys that `summarizePayload` surfaces in the one-line summary. */
const SUMMARIZED_KEYS = new Set([
  "name",
  "slug",
  "role",
  "effect",
  "tier",
  "toTier",
  "visibility",
  "action",
]);

/**
 * Does this payload carry forensic detail that the one-line summary drops?
 * `summarizePayload` deliberately omits nested before/after blobs and any keys
 * it does not specifically pick; this returns true when there is more to show,
 * so the viewer offers an expandable drill-down (PSG-88 P2) only where useful.
 */
export function hasPayloadDetail(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  return Object.entries(p).some(([key, value]) => {
    if (value === undefined || value === null) return false;
    // A nested before/after blob, or any key the summary did not surface.
    return typeof value === "object" || !SUMMARIZED_KEYS.has(key);
  });
}

/**
 * Pretty-print the full payload for the drill-down panel. Stable key order and
 * 2-space indent so before/after blobs are diff-readable. Returns "" for an
 * empty / non-object payload.
 */
export function formatPayloadDetail(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const p = payload as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(p).sort()) ordered[key] = p[key];
  try {
    return JSON.stringify(ordered, null, 2);
  } catch {
    return "";
  }
}
