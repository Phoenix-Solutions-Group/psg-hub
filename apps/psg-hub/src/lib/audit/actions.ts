/**
 * Closed vocabulary of auditable admin actions (v1.5, PSG-29).
 *
 * Extracted from access-audit.ts into a PURE, dependency-free module so the
 * client-side audit viewer (audit-view.ts → access-audit-viewer.tsx, a
 * "use client" component) can import the action constant/type WITHOUT pulling in
 * access-audit.ts's `server-only` + service-client imports. That transitive edge
 * broke the production build ('server-only' cannot be imported from a Client
 * Component). Keep this file free of any I/O or server-only import.
 *
 * Keep in sync with the admin server actions that emit these — one constant per
 * mutating operation so the audit UI can filter/label without parsing free text.
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
  // intel competitor report (v1.6 / PSG-177b) — superadmin runs the (G5-gated, metered)
  // competitor intelligence report from the ops surface; the run is audited so any metered
  // spend is attributable to an actor + shop.
  "intel.competitor_report.run",
  // mail template proof/approve/release gate (PSG-217 / PSG-115b) — a template must be
  // signed off (approve) then made eligible for live batches (release) before it can be
  // mailed; each transition is attributable to an actor so the sign-off is provable.
  "production.template.approve",
  "production.template.release",
  "production.template.revoke",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
