/**
 * PII handling checklist (v1.5 / PSG-29).
 *
 * A documented control surface for the superadmin "Access" area: it enumerates
 * where personally-identifiable information lives in BSM, the control that
 * protects each surface, and the current status of that control. Pure data so
 * the page render is trivial and the inventory is unit-testable (no orphaned or
 * mislabelled statuses). Update this list as new PII surfaces ship.
 */

export type PiiStatus = "in_place" | "partial" | "todo";

export type PiiControl = {
  /** Stable id for linking / future per-item sign-off. */
  id: string;
  /** The PII surface or data class. */
  surface: string;
  /** What protects it. */
  control: string;
  status: PiiStatus;
  /** Where the control is implemented (table, policy, or module). */
  evidence: string;
};

export const PII_STATUS_LABELS: Record<PiiStatus, string> = {
  in_place: "In place",
  partial: "Partial",
  todo: "To do",
};

export const PII_CHECKLIST: readonly PiiControl[] = [
  {
    id: "auth-emails",
    surface: "Staff & customer emails (auth.users)",
    control: "Read only via service-role admin API; never exposed to client RLS.",
    status: "in_place",
    evidence: "lib/auth/ops-access · service-role reads",
  },
  {
    id: "customer-contacts",
    surface: "Repair-customer names, phones, addresses",
    control: "RLS scoped to owning shop; ops access gated by manage_companies.",
    status: "in_place",
    evidence: "repair_customers RLS · requireOpsFn",
  },
  {
    id: "access-audit",
    surface: "Privileged-action audit trail",
    control: "Append-only (trigger + REVOKE); superadmin-read RLS.",
    status: "in_place",
    evidence: "access_audit · 20260618130000 migration",
  },
  {
    id: "module-grants",
    surface: "Per-user / per-shop module access grants",
    control: "Superadmin-only RLS; all edits recorded to access_audit.",
    status: "in_place",
    evidence: "module_access_grants · recordAuditEvent",
  },
  {
    id: "security-profiles",
    surface: "Capability assignments per user",
    control: "Superadmin-only catalog; assignments audited.",
    status: "in_place",
    evidence: "security_profile_defs · PSG-39",
  },
  {
    id: "import-pii",
    surface: "Bulk RO / estimate imports (customer PII)",
    control: "Validated + shop-scoped on commit; ops-gated wizard.",
    status: "partial",
    evidence: "lib/ops/import · validate + commit",
  },
  {
    id: "data-retention",
    surface: "Retention / deletion policy for customer PII",
    control: "Documented retention windows + deletion runbook.",
    status: "todo",
    evidence: "pending — track as a follow-up before GA",
  },
  {
    id: "access-review",
    surface: "Periodic superadmin access review",
    control: "Quarterly review of superadmin allowlist + profiles via this audit.",
    status: "todo",
    evidence: "pending — recurring routine to be scheduled",
  },
] as const;

/** Counts by status, for the page summary. */
export function piiStatusCounts(
  list: readonly PiiControl[] = PII_CHECKLIST
): Record<PiiStatus, number> {
  const out: Record<PiiStatus, number> = { in_place: 0, partial: 0, todo: 0 };
  for (const c of list) out[c.status] += 1;
  return out;
}
