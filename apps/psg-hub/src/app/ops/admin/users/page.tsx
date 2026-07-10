import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess } from "@/lib/auth/ops-access";
import {
  UserAccessManager,
  type ManagedShop,
  type ManagedUser,
} from "@/components/ops/user-access-manager";
import {
  ADMIN_APP_ROLES,
  ADMIN_TIERS,
  SHOP_MEMBER_ROLES,
  type AdminAppRole,
  type AdminTier,
  type ShopMemberRole,
} from "@/lib/ops/user-management";

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

export default async function UsersAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">User Access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const [
    authUsersResult,
    { data: profiles },
    { data: roleRows },
    { data: memberships },
    { data: shopsRaw },
    { data: subscriptions },
  ] = await Promise.all([
    service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    service.from("profiles").select("id, display_name"),
    service.from("app_user_roles").select("profile_id, role"),
    service.from("shop_users").select("user_id, shop_id, role"),
    service.from("shops").select("id, name, slug").order("name", { ascending: true }),
    service.from("subscriptions").select("shop_id, tier, status"),
  ]);

  const profileNameById = new Map<string, string>();
  for (const p of profiles ?? []) {
    profileNameById.set(p.id as string, (p.display_name as string) ?? "");
  }

  const roleByProfileId = new Map<string, AdminAppRole | null>();
  for (const r of roleRows ?? []) {
    roleByProfileId.set(r.profile_id as string, cleanRole(r.role));
  }

  const subByShopId = new Map<string, { tier: AdminTier | null; status: string | null }>();
  for (const s of subscriptions ?? []) {
    subByShopId.set(s.shop_id as string, {
      tier: cleanTier(s.tier),
      status: (s.status as string | null) ?? null,
    });
  }

  const shops: ManagedShop[] = (shopsRaw ?? []).map((s) => {
    const id = s.id as string;
    const sub = subByShopId.get(id);
    return {
      id,
      name: ((s.name as string | null) ?? (s.slug as string | null) ?? id).trim(),
      slug: (s.slug as string | null) ?? null,
      tier: sub?.tier ?? null,
      subscriptionStatus: sub?.status ?? null,
    };
  });

  const shopNameById = new Map(shops.map((s) => [s.id, s.name]));
  const membershipsByUserId = new Map<string, ManagedUser["memberships"]>();
  for (const m of memberships ?? []) {
    const userId = m.user_id as string;
    const rows = membershipsByUserId.get(userId) ?? [];
    rows.push({
      shopId: m.shop_id as string,
      shopName: shopNameById.get(m.shop_id as string) ?? (m.shop_id as string),
      role: cleanShopRole(m.role),
    });
    membershipsByUserId.set(userId, rows);
  }

  const authUsers = authUsersResult.data?.users ?? [];
  const authUsersById = new Map(authUsers.map((u) => [u.id, u]));
  const profileIds = new Set<string>([
    ...authUsers.map((u) => u.id),
    ...(profiles ?? []).map((p) => p.id as string),
  ]);

  const users: ManagedUser[] = [...profileIds]
    .map((profileId) => {
      const authUser = authUsersById.get(profileId);
      const email = authUser?.email ?? null;
      const displayName = profileNameById.get(profileId) || email || profileId.slice(0, 8);
      return {
        profileId,
        displayName,
        email,
        role: roleByProfileId.get(profileId) ?? null,
        memberships: membershipsByUserId.get(profileId) ?? [],
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <a href="/ops/admin" className="text-sm text-muted-foreground hover:text-ember">
          Back to Superadmin
        </a>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">User Access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage user roles, shop assignments, and shop tiers. Every saved change writes to the
          access audit.
        </p>
      </div>

      <UserAccessManager users={users} shops={shops} />
    </div>
  );
}
