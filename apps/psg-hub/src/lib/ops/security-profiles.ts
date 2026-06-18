import { OPS_FUNCTIONS, type OpsFunction } from "@/lib/auth/ops-access";

/**
 * Named security-profile surface helpers (v1.1 / PSG-39).
 *
 * The spine (15-00 ops-foundation migration) shipped two tables:
 *   - security_profile_defs(id, name, is_builtin, functions_jsonb)  — the catalog
 *   - user_security_profile_assignments(profile_id, security_profile_id) — membership
 * with a built-in "Administrator" def granting every v1.1 capability. This module
 * holds the PURE (no-I/O) pieces the assign/edit surface needs so they are
 * unit-testable; the DB reads/writes happen in the API routes + server page.
 */

/** Human labels for the canonical ops capability keys (for the flag editor UI). */
export const OPS_FUNCTION_LABELS: Record<OpsFunction, string> = {
  manage_companies: "Companies & ROs",
  manage_sysconfig: "System Configuration",
  manage_users: "User & Profile Admin",
  manage_reports: "Operational Reports",
  manage_production: "Production",
};

export type SecurityProfileDef = {
  id: string;
  name: string;
  is_builtin: boolean;
  functions_jsonb: Record<string, unknown>;
};

/**
 * Built-in profiles (e.g. Administrator) are the always-on safety net and must
 * not be renamed, re-flagged, or deleted from the app. Edits are rejected both
 * here (UX) and in the API route (authoritative).
 */
export function canEditProfile(def: Pick<SecurityProfileDef, "is_builtin">): boolean {
  return !def.is_builtin;
}

/**
 * Build a functions_jsonb object from a list of selected capability keys.
 * Unknown keys are dropped (fail-closed) so a tampered client can never grant a
 * capability outside the canonical vocabulary. Each selected key maps to `true`.
 */
export function buildFunctionsJsonb(selected: readonly string[]): Record<string, true> {
  const out: Record<string, true> = {};
  for (const key of selected) {
    if ((OPS_FUNCTIONS as readonly string[]).includes(key)) {
      out[key] = true;
    }
  }
  return out;
}

/** The capability keys a def currently grants (value truthy), filtered to the vocabulary. */
export function grantedFunctions(functions_jsonb: Record<string, unknown>): OpsFunction[] {
  return OPS_FUNCTIONS.filter((fn) => Boolean(functions_jsonb?.[fn]));
}

/** Normalise + validate a profile name. Returns the trimmed name or null if invalid. */
export function normalizeProfileName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return null;
  return trimmed;
}
