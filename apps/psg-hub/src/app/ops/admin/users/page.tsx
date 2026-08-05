import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import {
  UserAccessManager,
  type ManagedShop,
  type ManagedUser,
} from "@/components/ops/user-access-manager";
import {
  ADMIN_APP_ROLES,
  ADMIN_TIERS,
  ADMIN_TIER_LABELS,
  SHOP_MEMBER_ROLES,
  type AdminAppRole,
  type AdminTier,
  type ShopMemberRole,
} from "@/lib/ops/user-management";
import {
  filterCleanDemoShopMemberships,
  filterCleanDemoShops,
  filterCleanDemoUsers,
} from "@/lib/ops/demo-user-filter";
import {
  emailFromInviteAuditPayload,
  listAllAdminRows,
  listAllAuthUsers,
} from "@/lib/ops/admin-user-list";

function cleanRole(role: unknown): AdminAppRole | null {
  return (ADMIN_APP_ROLES as readonly string[]).includes(role as string)
    ? (role as AdminAppRole)
    : null;
}

function cleanShopRole(role: unknown): ShopMemberRole {
  return (SHOP_MEMBER_ROLES as readonly string[]).includes(role as string)
    ? (role as ShopMemberRole)
    : "viewer";
}

function cleanTier(tier: unknown): AdminTier | null {
  return (ADMIN_TIERS as readonly string[]).includes(tier as string) ? (tier as AdminTier) : null;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default async function UsersAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_users")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">User Access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant access to manage users.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const [
    authUsers,
    profiles,
    roleRows,
    memberships,
    shopsRaw,
    subscriptions,
    inviteAuditRows,
  ] = await Promise.all([
    listAllAuthUsers(service),
    listAllAdminRows<{ id: string; display_name: string | null }>(() =>
      service.from("profiles").select("id, display_name").order("id", { ascending: true })
    ),
    listAllAdminRows<{ profile_id: string; role: string | null }>(() =>
      service.from("app_user_roles").select("profile_id, role").order("profile_id", { ascending: true })
    ),
    listAllAdminRows<{ user_id: string; shop_id: string; role: string | null }>(() =>
      service
        .from("shop_users")
        .select("user_id, shop_id, role")
        .order("user_id", { ascending: true })
        .order("shop_id", { ascending: true })
    ),
    listAllAdminRows<{ id: string; name: string | null; slug: string | null }>(() =>
      service.from("shops").select("id, name, slug").order("name", { ascending: true })
    ),
    listAllAdminRows<{ shop_id: string; tier: string | null; status: string | null }>(() =>
      service.from("subscriptions").select("shop_id, tier, status")
    ),
    listAllAdminRows<{ target_profile_id: string | null; payload_jsonb: unknown }>(() =>
      service
        .from("access_audit")
        .select("target_profile_id, payload_jsonb")
        .eq("action", "user.invite")
        .order("ts", { ascending: false })
    ),
  ]);

  const profileNameById = new Map<string, string>();
  for (const p of profiles) {
    profileNameById.set(p.id as string, (p.display_name as string) ?? "");
  }

  const roleByProfileId = new Map<string, AdminAppRole | null>();
  for (const r of roleRows) {
    roleByProfileId.set(r.profile_id as string, cleanRole(r.role));
  }

  const subByShopId = new Map<string, { tier: AdminTier | null; status: string | null }>();
  for (const s of subscriptions) {
    subByShopId.set(s.shop_id as string, {
      tier: cleanTier(s.tier),
      status: (s.status as string | null) ?? null,
    });
  }

  const shops: ManagedShop[] = filterCleanDemoShops(
    shopsRaw.map((s) => {
      const id = s.id as string;
      const sub = subByShopId.get(id);
      return {
        id,
        name: ((s.name as string | null) ?? (s.slug as string | null) ?? id).trim(),
        slug: (s.slug as string | null) ?? null,
        tier: sub?.tier ?? null,
        tierLabel: sub?.tier ? ADMIN_TIER_LABELS[sub.tier] : "No subscription tier set",
        subscriptionStatus: sub?.status ?? null,
      };
    }),
    user.email
  );

  const shopNameById = new Map(shops.map((s) => [s.id, s.name]));
  const membershipsByUserId = new Map<string, ManagedUser["memberships"]>();
  const visibleMemberships = filterCleanDemoShopMemberships(
    memberships.map((m) => ({
      userId: m.user_id as string,
      shopId: m.shop_id as string,
      role: m.role,
    })),
    shops,
    user.email
  );
  for (const m of visibleMemberships) {
    const userId = m.userId;
    const rows = membershipsByUserId.get(userId) ?? [];
    rows.push({
      shopId: m.shopId,
      shopName: shopNameById.get(m.shopId) ?? m.shopId,
      role: cleanShopRole(m.role),
    });
    membershipsByUserId.set(userId, rows);
  }

  const authUsersById = new Map(authUsers.map((u) => [u.id, u]));
  const invitedEmailByProfileId = new Map<string, string>();
  for (const row of inviteAuditRows) {
    if (typeof row.target_profile_id !== "string") continue;
    const email = emailFromInviteAuditPayload(row.payload_jsonb);
    if (email) invitedEmailByProfileId.set(row.target_profile_id, email);
  }
  const inviteCreatedProfileIds = new Set(
    inviteAuditRows
      .map((row) => row.target_profile_id)
      .filter((profileId): profileId is string => typeof profileId === "string")
  );
  const profileIds = new Set<string>([
    ...authUsers.map((u) => u.id),
    ...profiles.map((p) => p.id as string),
    ...roleRows.map((r) => r.profile_id as string),
    ...memberships.map((m) => m.user_id as string),
    ...inviteCreatedProfileIds,
  ]);

  const users: ManagedUser[] = filterCleanDemoUsers(
    [...profileIds]
      .map((profileId) => {
        const authUser = authUsersById.get(profileId);
        const profileName = profileNameById.get(profileId) ?? "";
        const email =
          authUser?.email ??
          (looksLikeEmail(profileName) ? profileName : null) ??
          invitedEmailByProfileId.get(profileId) ??
          null;
        const displayName =
          profileName || email || profileId.slice(0, 8);
        const isSuspended = Boolean(authUser?.banned_until);
        return {
          profileId,
          displayName,
          email,
          bannedUntil: authUser?.banned_until ?? null,
          isDeleted: Boolean(authUser?.deleted_at),
          isSuspended,
          role: roleByProfileId.get(profileId) ?? null,
          memberships: membershipsByUserId.get(profileId) ?? [],
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    user.email,
    undefined,
    inviteCreatedProfileIds
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <a href="/ops/admin" className="text-sm text-muted-foreground hover:text-ember">
          Back to Superadmin
        </a>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">User Access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite people, set their PSG-wide role, connect one login to one or more shops, and
          adjust each shop service tier. Every saved change is recorded in the access audit.
        </p>
      </div>

      <UserAccessManager users={users} shops={shops} />
    </div>
  );
}
