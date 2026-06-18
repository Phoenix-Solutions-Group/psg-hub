import type { Tier } from "@/lib/tier/gate";
import { tierMeets } from "@/lib/tier/gate";

/**
 * Module access-matrix resolution (v1.5, PSG-29 phase 2).
 *
 * Decides whether a module is visible to a given user/shop. Precedence,
 * highest to lowest (PLANNING.md): explicit profile grant > shop grant >
 * role grant > tier default. At each level a `deny` beats an `allow`; the
 * first level that has any grant wins outright (lower levels are not
 * consulted). With no grants, the module's tier floor + default_visibility
 * decide.
 *
 * Pure (no I/O) so it is fully unit-testable; the DB read of modules + grants
 * happens in the caller, which passes the already-scoped rows in here.
 */

export type GrantScope = "profile" | "shop" | "role";
export type GrantEffect = "allow" | "deny";

export type ModuleAccessGrant = {
  scope: GrantScope;
  effect: GrantEffect;
};

export type ModuleDefinition = {
  slug: string;
  /** null => no tier floor. */
  minTier: Tier | null;
  defaultVisibility: "visible" | "hidden";
};

export type ModuleAccessInput = {
  module: ModuleDefinition;
  /**
   * Grants already filtered to THIS user (their profile id, their shop ids,
   * their role). Order does not matter — precedence is applied here.
   */
  grants: ModuleAccessGrant[];
  /** The shop's effective tier (null for staff / no subscription). */
  shopTier: Tier | null;
  /** True for psg_internal / psg_superadmin — tier floors do not apply to staff. */
  isStaff: boolean;
};

export type ModuleAccessResult = {
  visible: boolean;
  reason:
    | "grant:profile"
    | "grant:shop"
    | "grant:role"
    | "tier:below-floor"
    | "default";
};

const PRECEDENCE: GrantScope[] = ["profile", "shop", "role"];

/**
 * Resolve effective visibility of one module for one user.
 */
export function resolveModuleAccess(input: ModuleAccessInput): ModuleAccessResult {
  // 1. Explicit grants, highest precedence first. A deny beats an allow at the
  //    same level; the first level with any grant is decisive.
  for (const scope of PRECEDENCE) {
    const atLevel = input.grants.filter((g) => g.scope === scope);
    if (atLevel.length === 0) continue;
    const denied = atLevel.some((g) => g.effect === "deny");
    return { visible: !denied, reason: `grant:${scope}` as ModuleAccessResult["reason"] };
  }

  // 2. No grants — tier floor applies to customers only.
  if (!input.isStaff && input.module.minTier) {
    if (!tierMeets(input.shopTier, input.module.minTier)) {
      return { visible: false, reason: "tier:below-floor" };
    }
  }

  // 3. Fall back to the module's default.
  return { visible: input.module.defaultVisibility === "visible", reason: "default" };
}
