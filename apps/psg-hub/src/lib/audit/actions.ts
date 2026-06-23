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
  // generic agent→approve→publish approval queue (PSG-245 / Wave 2 G-d) — an
  // agent-proposed action (content / gbp_post / review_reply / …) is queued, then
  // approved or rejected by a role-gated human; the action publishes ONLY on
  // approve. Each decision is attributable to an actor + shop so the human gate is
  // provable. Generic over action_type so G-a/b/c all publish through one gate.
  "approval.approve",
  "approval.reject",
  // sitemap & content-architecture run (PSG-258 / Wave 1A) — a superadmin runs the
  // gated sitemap pipeline for a shop from /ops/sitemap. The run is metered (G5-gated
  // content-gap / cluster-refine) and persists a client deliverable, so each run is
  // attributable to an actor + shop. The payload's `outcome` records complete vs.
  // awaiting a checkpoint approval.
  "sitemap.run",
  // Google Business Profile connection (PSG-247 / Wave 2 G-b) — a shop owner
  // disconnects (revokes) the per-shop GBP OAuth grant. The refresh token is
  // revoked at Google and the linked-account row flipped to `revoked`; the action
  // is audited so a credential teardown is attributable to an actor + shop.
  // (Connect runs through the OAuth consent flow, recorded by the linked-account row.)
  "gbp.disconnect",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
