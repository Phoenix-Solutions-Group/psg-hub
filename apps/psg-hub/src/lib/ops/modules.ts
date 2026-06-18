import type { Tier } from "@/lib/tier/gate";

/**
 * Module-registry surface helpers (v1.5 / PSG-29 phase 2).
 *
 * The data layer (migration 20260618190000_module_registry) shipped two tables:
 *   - modules(id, slug, display_name, audience, min_tier_slug, default_visibility)
 *   - module_access_grants(module_id, profile_id|shop_id|role, effect, granted_by)
 * and the pure resolver lives in `@/lib/access/module-access`. This module holds
 * the PURE (no-I/O) pieces the access-matrix editor needs — vocab, validation,
 * label maps, and the grant → role-matrix fold — so they are unit-testable; the
 * DB reads/writes happen in the API routes + the server page.
 */

export const MODULE_AUDIENCES = ["customer", "ops", "both"] as const;
export type ModuleAudience = (typeof MODULE_AUDIENCES)[number];

/** Tier slugs that may be a module's floor (mirrors src/lib/tier/gate.ts). */
export const MODULE_TIERS = ["essentials", "growth", "performance"] as const;

export const MODULE_VISIBILITIES = ["visible", "hidden"] as const;
export type ModuleVisibility = (typeof MODULE_VISIBILITIES)[number];

/** Role-scope grant targets — the app_user_roles enum values. */
export const GRANT_ROLES = ["customer", "psg_internal", "psg_superadmin"] as const;
export type GrantRole = (typeof GRANT_ROLES)[number];

export const GRANT_EFFECTS = ["allow", "deny"] as const;
export type GrantEffect = (typeof GRANT_EFFECTS)[number];

export const MODULE_AUDIENCE_LABELS: Record<ModuleAudience, string> = {
  customer: "Customer hub",
  ops: "Internal ops",
  both: "Both surfaces",
};

export const GRANT_ROLE_LABELS: Record<GrantRole, string> = {
  customer: "Customer",
  psg_internal: "PSG Internal",
  psg_superadmin: "Superadmin",
};

export type ModuleRow = {
  id: string;
  slug: string;
  display_name: string;
  audience: ModuleAudience;
  min_tier_slug: Tier | null;
  default_visibility: ModuleVisibility;
};

export type GrantRow = {
  id: string;
  module_id: string;
  profile_id: string | null;
  shop_id: string | null;
  role: GrantRole | null;
  effect: GrantEffect;
};

/** Tri-state of a role-scope cell in the access matrix. */
export type RoleEffect = GrantEffect | "inherit";

/**
 * Normalise + validate a module slug. Lowercases, trims, collapses internal
 * whitespace to single hyphens, and rejects anything outside [a-z0-9._-].
 * Returns the clean slug or null when invalid. Fail-closed: a slug that can't
 * be cleaned to the allowed charset is rejected rather than silently mangled.
 */
export function normalizeModuleSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (slug.length < 2 || slug.length > 60) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug)) return null;
  return slug;
}

/** Normalise + validate a human display name. */
export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 80) return null;
  return trimmed;
}

/** Coerce an arbitrary value to a valid module audience, or null. */
export function asAudience(raw: unknown): ModuleAudience | null {
  return (MODULE_AUDIENCES as readonly string[]).includes(raw as string)
    ? (raw as ModuleAudience)
    : null;
}

/** Coerce to a valid tier floor (null is a legitimate "no floor"). */
export function asTierFloor(raw: unknown): { ok: true; value: Tier | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if ((MODULE_TIERS as readonly string[]).includes(raw as string)) {
    return { ok: true, value: raw as Tier };
  }
  return { ok: false };
}

/** Coerce to a valid default visibility, or null. */
export function asVisibility(raw: unknown): ModuleVisibility | null {
  return (MODULE_VISIBILITIES as readonly string[]).includes(raw as string)
    ? (raw as ModuleVisibility)
    : null;
}

/** Coerce to a valid grant role, or null. */
export function asGrantRole(raw: unknown): GrantRole | null {
  return (GRANT_ROLES as readonly string[]).includes(raw as string)
    ? (raw as GrantRole)
    : null;
}

/** Coerce to a valid grant effect, or null. */
export function asGrantEffect(raw: unknown): GrantEffect | null {
  return (GRANT_EFFECTS as readonly string[]).includes(raw as string)
    ? (raw as GrantEffect)
    : null;
}

/**
 * Fold the flat grant rows into a per-module role matrix. For each module we
 * report the effect of each role-scope grant (allow/deny), or "inherit" when no
 * role grant exists for that role (the module's tier/default decides). Only
 * role-scope grants participate — profile/shop overrides resolve per-user at
 * read time via resolveModuleAccess() and are not part of the editable grid.
 */
export function roleMatrixFor(moduleId: string, grants: GrantRow[]): Record<GrantRole, RoleEffect> {
  const out: Record<GrantRole, RoleEffect> = {
    customer: "inherit",
    psg_internal: "inherit",
    psg_superadmin: "inherit",
  };
  for (const g of grants) {
    if (g.module_id !== moduleId) continue;
    if (g.role === null) continue; // profile/shop grant — not in the grid
    out[g.role] = g.effect;
  }
  return out;
}

/** Count the non-role (profile + shop) overrides on a module, for a UI hint. */
export function targetedOverrideCount(moduleId: string, grants: GrantRow[]): number {
  return grants.filter(
    (g) => g.module_id === moduleId && (g.profile_id !== null || g.shop_id !== null)
  ).length;
}
