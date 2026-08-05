"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ADMIN_APP_ROLE_LABELS,
  ADMIN_APP_ROLES,
  ADMIN_TIER_LABELS,
  ADMIN_TIERS,
  SHOP_MEMBER_ROLE_LABELS,
  SHOP_MEMBER_ROLES,
  type AdminAppRole,
  type AdminTier,
  type ShopMemberRole,
} from "@/lib/ops/user-management";

const NO_TIER_VALUE = "__no_tier__";

type InviteUserResponse = {
  user?: {
    id?: string;
    email?: string;
    role?: AdminAppRole;
    shopId?: string | null;
    shopRole?: ShopMemberRole | null;
  };
  error?: string;
};

export type ManagedShop = {
  id: string;
  name: string;
  slug: string | null;
  tier: AdminTier | null;
  tierLabel: string;
  subscriptionStatus: string | null;
};

export type ManagedUser = {
  profileId: string;
  displayName: string;
  email: string | null;
  bannedUntil: string | null;
  isDeleted: boolean;
  isSuspended: boolean;
  role: AdminAppRole | null;
  memberships: Array<{
    shopId: string;
    shopName: string;
    role: ShopMemberRole;
  }>;
};

export function UserAccessManager({
  users,
  shops,
}: {
  users: ManagedUser[];
  shops: ManagedShop[];
}) {
  const [query, setQuery] = useState("");
  const [optimisticUsers, setOptimisticUsers] = useState<ManagedUser[]>([]);
  const visibleUserSource = useMemo(() => {
    const usersByProfileId = new Map(users.map((user) => [user.profileId, user]));
    for (const user of optimisticUsers) {
      usersByProfileId.set(user.profileId, usersByProfileId.get(user.profileId) ?? user);
    }
    return [...usersByProfileId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [optimisticUsers, users]);
  const filtered = useMemo(() => {
    const visibleUsers = visibleUserSource.filter((user) => !user.isDeleted);
    const q = query.trim().toLowerCase();
    if (!q) return visibleUsers;
    return visibleUsers.filter((u) =>
      [u.displayName, u.email ?? "", u.profileId]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [query, visibleUserSource]);

  return (
    <section className="space-y-6">
      <InviteUserForm
        shops={shops}
        onInvited={(user) => {
          setOptimisticUsers((current) => [user, ...current]);
          setQuery(user.email ?? user.displayName);
        }}
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold">Users and shop access</h2>
            <p className="text-sm text-muted-foreground">
              Search by name or email. Users with an invite but no profile are still listed when
              Supabase Auth returns them.
            </p>
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users"
            className="sm:max-w-xs"
          />
        </div>

        <div className="space-y-3">
          {filtered.map((user) => (
            <UserAccessCard key={user.profileId} user={user} shops={shops} />
          ))}
          {filtered.length === 0 && (
            <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              No users match that search. If an invited person is missing, search their email,
              then check Supabase Auth if the invite was sent from outside this page.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function InviteUserForm({
  shops,
  onInvited,
}: {
  shops: ManagedShop[];
  onInvited: (user: ManagedUser) => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminAppRole>("customer");
  const [shopId, setShopId] = useState("");
  const [shopRole, setShopRole] = useState<ShopMemberRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/ops/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role,
          shopId: shopId || null,
          shopRole: shopId ? shopRole : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as InviteUserResponse;
      if (!res.ok) {
        throw new Error(data.error ?? `Invite failed (${res.status})`);
      }
      const invitedUser = data.user;
      if (invitedUser?.id && invitedUser.email) {
        const invitedShop = invitedUser.shopId
          ? shops.find((shop) => shop.id === invitedUser.shopId)
          : null;
        onInvited({
          profileId: invitedUser.id,
          displayName: invitedUser.email,
          email: invitedUser.email,
          bannedUntil: null,
          isDeleted: false,
          isSuspended: false,
          role: invitedUser.role ?? role,
          memberships: invitedShop && invitedUser.shopId
            ? [{
                shopId: invitedUser.shopId,
                shopName: invitedShop.name,
                role: invitedUser.shopRole ?? shopRole,
              }]
            : [],
        });
      }

      setEmail("");
      setRole("customer");
      setShopId("");
      setShopRole("viewer");
      setMessage("Invite sent. The new user has been added to this list.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submitInvite} className="rounded-lg border border-border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">Invite user</h2>
          <p className="text-sm text-muted-foreground">
            Send the login email, choose the starting role, and optionally attach the first shop.
          </p>
        </div>
        <Button type="submit" size="sm" disabled={busy || !email.trim()}>
          {busy ? "Sending..." : "Send invite"}
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <div className="space-y-2 lg:col-span-2">
          <label className="text-sm font-medium" htmlFor="invite-email">
            Email
          </label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="person@example.com"
            disabled={busy}
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="invite-role">
            Global role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as AdminAppRole)}
            disabled={busy}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {ADMIN_APP_ROLES.map((r) => (
              <option key={r} value={r}>
                {ADMIN_APP_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="invite-shop">
            Starting shop
          </label>
          <select
            id="invite-shop"
            value={shopId}
            onChange={(event) => setShopId(event.target.value)}
            disabled={busy}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">No shop assignment</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} - {s.tierLabel}
              </option>
            ))}
          </select>
          <Link href="/ops/companies" className="text-xs text-muted-foreground hover:text-ember">
            Need a new shop? Create it in Companies first.
          </Link>
        </div>
      </div>

      {shopId && (
        <div className="mt-4 max-w-xs space-y-2">
          <label className="text-sm font-medium" htmlFor="invite-shop-role">
            Shop role
          </label>
          <select
            id="invite-shop-role"
            value={shopRole}
            onChange={(event) => setShopRole(event.target.value as ShopMemberRole)}
            disabled={busy}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {SHOP_MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>
                {SHOP_MEMBER_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      )}

      {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
      {error && <p className="mt-3 text-sm text-ember">{error}</p>}
    </form>
  );
}

function UserAccessCard({ user, shops }: { user: ManagedUser; shops: ManagedShop[] }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? "");
  const [role, setRole] = useState<AdminAppRole>(user.role ?? "customer");
  const [shopId, setShopId] = useState(shops[0]?.id ?? "");
  const [shopRole, setShopRole] = useState<ShopMemberRole>("viewer");
  const [tierShopId, setTierShopId] = useState(shops[0]?.id ?? "");
  const [tier, setTier] = useState<AdminTier | null>(shops[0]?.tier ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callApi(url: string, init: RequestInit, busyKey: string) {
    setError(null);
    setBusy(busyKey);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const tierShop = shops.find((s) => s.id === tierShopId);
  const accountStatus = user.isDeleted ? "Deleted" : user.isSuspended ? "Suspended" : "Active";
  const profileChanged =
    displayName.trim() !== user.displayName || email.trim().toLowerCase() !== (user.email ?? "");

  return (
    <article className="rounded-lg border border-border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-heading font-semibold">{user.displayName}</div>
          <div className="text-sm text-muted-foreground">{user.email ?? user.profileId}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {user.role ? ADMIN_APP_ROLE_LABELS[user.role] : "No role"}
          </Badge>
          <Badge variant={user.isSuspended || user.isDeleted ? "destructive" : "outline"}>
            {accountStatus}
          </Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`display-name-${user.profileId}`}>
            Display name
          </label>
          <Input
            id={`display-name-${user.profileId}`}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy !== null || user.isDeleted}
          />
          <label className="text-sm font-medium" htmlFor={`email-${user.profileId}`}>
            Email
          </label>
          <Input
            id={`email-${user.profileId}`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy !== null || user.isDeleted}
          />
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || user.isDeleted || !profileChanged || !displayName.trim()}
            onClick={() =>
              callApi(
                `/api/ops/admin/users/${user.profileId}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    displayName: displayName.trim(),
                    email: email.trim() || undefined,
                  }),
                },
                "profile"
              )
            }
          >
            Save user
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`role-${user.profileId}`}>
            Global role
          </label>
          <select
            id={`role-${user.profileId}`}
            value={role}
            onChange={(e) => setRole(e.target.value as AdminAppRole)}
            disabled={user.isDeleted}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {ADMIN_APP_ROLES.map((r) => (
              <option key={r} value={r}>
                {ADMIN_APP_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || user.isDeleted || role === user.role}
            onClick={() =>
              callApi(
                `/api/ops/admin/users/${user.profileId}/role`,
                { method: "PATCH", body: JSON.stringify({ role }) },
                "role"
              )
            }
          >
            Save role
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`shop-${user.profileId}`}>
            Add shop access
          </label>
          <select
            id={`shop-${user.profileId}`}
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            disabled={shops.length === 0 || user.isDeleted}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} - {s.tierLabel}
              </option>
            ))}
          </select>
          <select
            value={shopRole}
            onChange={(e) => setShopRole(e.target.value as ShopMemberRole)}
            disabled={shops.length === 0 || user.isDeleted}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {SHOP_MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>
                {SHOP_MEMBER_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || user.isDeleted || !shopId}
            onClick={() =>
              callApi(
                `/api/ops/admin/users/${user.profileId}/shops`,
                { method: "POST", body: JSON.stringify({ shopId, role: shopRole }) },
                "shop"
              )
            }
          >
            Add shop access
          </Button>
          <p className="text-xs text-muted-foreground">
            One login can have access to multiple shops. Re-adding a listed shop updates that
            shop role.
          </p>
          <Link href="/ops/companies" className="text-xs text-muted-foreground hover:text-ember">
            Create or edit shops in Companies.
          </Link>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`tier-${user.profileId}`}>
            Shop to update
          </label>
          <select
            id={`tier-${user.profileId}`}
            value={tierShopId}
            onChange={(e) => {
              const nextShop = shops.find((s) => s.id === e.target.value);
              setTierShopId(e.target.value);
              setTier(nextShop?.tier ?? null);
            }}
            disabled={user.isDeleted}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="text-sm font-medium" htmlFor={`tier-value-${user.profileId}`}>
            Tier for selected shop
          </label>
          <select
            id={`tier-value-${user.profileId}`}
            value={tier ?? NO_TIER_VALUE}
            onChange={(e) => {
              const value = e.target.value;
              setTier(value === NO_TIER_VALUE ? null : (value as AdminTier));
            }}
            disabled={user.isDeleted}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value={NO_TIER_VALUE}>No subscription tier</option>
            {ADMIN_TIERS.map((t) => (
              <option key={t} value={t}>
                {ADMIN_TIER_LABELS[t]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || user.isDeleted || !tierShopId || tierShop?.tier === tier}
            onClick={() =>
              callApi(
                `/api/ops/admin/shops/${tierShopId}/tier`,
                { method: "PATCH", body: JSON.stringify({ tier }) },
                "tier"
              )
            }
          >
            Save tier
          </Button>
          <p className="text-xs text-muted-foreground">
            Current tier: {tierShop?.tierLabel ?? "Choose a shop"}
          </p>
          {tierShop?.subscriptionStatus && (
            <p className="text-xs text-muted-foreground">Status: {tierShop.subscriptionStatus}</p>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <div className="text-sm font-medium">Current shop access</div>
        {user.memberships.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No shop access assigned.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {user.memberships.map((m) => (
              <span
                key={m.shopId}
                className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm"
              >
                {m.shopName}
                <span className="text-muted-foreground">({SHOP_MEMBER_ROLE_LABELS[m.role]})</span>
                <button
                  type="button"
                  disabled={busy !== null || user.isDeleted}
                  onClick={() =>
                    callApi(
                      `/api/ops/admin/users/${user.profileId}/shops`,
                      { method: "DELETE", body: JSON.stringify({ shopId: m.shopId }) },
                      `revoke-${m.shopId}`
                    )
                  }
                  className="text-ember disabled:opacity-50"
                >
                  Remove
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null || user.isDeleted}
          onClick={() => {
            const status = user.isSuspended ? "active" : "suspended";
            const action = user.isSuspended ? "reactivate" : "suspend";
            if (!window.confirm(`Are you sure you want to ${action} ${user.displayName}?`)) return;
            callApi(
              `/api/ops/admin/users/${user.profileId}/lifecycle`,
              { method: "PATCH", body: JSON.stringify({ status }) },
              "lifecycle"
            );
          }}
        >
          {user.isSuspended ? "Reactivate user" : "Suspend user"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={busy !== null || user.isDeleted}
          onClick={() => {
            if (
              !window.confirm(
                `Delete ${user.displayName}? This removes login access and shop assignments.`
              )
            ) {
              return;
            }
            callApi(
              `/api/ops/admin/users/${user.profileId}`,
              { method: "DELETE" },
              "delete"
            );
          }}
        >
          Delete user
        </Button>
        {user.bannedUntil && user.isSuspended && (
          <p className="basis-full text-xs text-muted-foreground">
            Suspended until {new Date(user.bannedUntil).toLocaleDateString()}.
          </p>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-ember">{error}</p>}
    </article>
  );
}
