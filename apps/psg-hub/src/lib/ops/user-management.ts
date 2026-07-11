import type { AppRole } from "@/lib/auth/shop-access";

/**
 * Pure helpers for the Superadmin user-management surface (PSG-1128).
 * DB writes live in the API routes; this file keeps validation and labels
 * dependency-free so route and UI behavior share one vocabulary.
 */

export const ADMIN_APP_ROLES = ["customer", "psg_internal", "psg_superadmin"] as const;
export type AdminAppRole = (typeof ADMIN_APP_ROLES)[number];

export const SHOP_MEMBER_ROLES = ["owner", "manager", "viewer"] as const;
export type ShopMemberRole = (typeof SHOP_MEMBER_ROLES)[number];

export const ADMIN_TIERS = ["essentials", "growth", "performance"] as const;
export type AdminTier = (typeof ADMIN_TIERS)[number];

export const ADMIN_APP_ROLE_LABELS: Record<AdminAppRole, string> = {
  customer: "Customer",
  psg_internal: "PSG Internal",
  psg_superadmin: "Superadmin",
};

export const SHOP_MEMBER_ROLE_LABELS: Record<ShopMemberRole, string> = {
  owner: "Owner",
  manager: "Manager",
  viewer: "Viewer",
};

export const ADMIN_TIER_LABELS: Record<AdminTier, string> = {
  essentials: "Essentials",
  growth: "Growth",
  performance: "Performance",
};

export function asAdminAppRole(raw: unknown): AdminAppRole | null {
  return (ADMIN_APP_ROLES as readonly string[]).includes(raw as string)
    ? (raw as AdminAppRole)
    : null;
}

export function asShopMemberRole(raw: unknown): ShopMemberRole | null {
  return (SHOP_MEMBER_ROLES as readonly string[]).includes(raw as string)
    ? (raw as ShopMemberRole)
    : null;
}

export function asAdminTier(raw: unknown): AdminTier | null {
  return (ADMIN_TIERS as readonly string[]).includes(raw as string)
    ? (raw as AdminTier)
    : null;
}

export function auditActionForRoleChange(
  nextRole: AppRole,
  beforeRole: AppRole | null = null
): "role.grant" | "role.revoke" | "superadmin.add" | "superadmin.remove" {
  if (nextRole === "psg_superadmin" && beforeRole !== "psg_superadmin") {
    return "superadmin.add";
  }
  if (beforeRole === "psg_superadmin" && nextRole !== "psg_superadmin") {
    return "superadmin.remove";
  }
  return nextRole === "customer" ? "role.revoke" : "role.grant";
}
