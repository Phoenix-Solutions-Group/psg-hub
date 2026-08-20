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

export type ManagedShop = {
  id: string;
  name: string;
  slug: string | null;
  clientId: string | null;
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
  initialShopId = null,
}: {
  users: ManagedUser[];
  shops: ManagedShop[];
  initialShopId?: string | null;
}) {
  const initialShop = shops.find((shop) => shop.id === initialShopId) ?? null;
  const suggestedUserIds = useMemo(() => {
    if (!initialShop?.clientId) return new Set<string>();
    const relatedShopIds = new Set(
      shops
        .filter(
          (shop) =>
            shop.clientId === initialShop.clientId && shop.id !== initialShop.id,
        )
        .map((shop) => shop.id),
    );
    return new Set(
      users
        .filter(
          (user) =>
            user.role === "customer" &&
            !user.memberships.some(
              (membership) => membership.shopId === initialShop.id,
            ) &&
            user.memberships.some((membership) =>
              relatedShopIds.has(membership.shopId),
            ),
        )
        .map((user) => user.profileId),
    );
  }, [initialShop, shops, users]);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter(
        (user) =>
          !q ||
          [user.displayName, user.email ?? "", user.profileId]
            .join(" ")
            .toLowerCase()
            .includes(q),
      )
      .sort(
        (left, right) =>
          Number(suggestedUserIds.has(right.profileId)) -
          Number(suggestedUserIds.has(left.profileId)),
      );
  }, [query, suggestedUserIds, users]);

  return (
    <section className="space-y-6">
      {initialShop ? (
        <div
          role="status"
          className="rounded-lg border border-warning/50 bg-warning/10 p-4"
        >
          <p className="font-heading font-semibold">
            Preparing customer access for {initialShop.name}
          </p>
          <p className="mt-1 text-sm leading-6 text-foreground/75">
            Invite the intended customer or add this shop to an existing user.
            The shop is preselected below; saved access changes are audited.
          </p>
          {suggestedUserIds.size ? (
            <p className="mt-1 text-sm leading-6 text-foreground/75">
              {suggestedUserIds.size} existing customer {suggestedUserIds.size === 1 ? "has" : "accounts have"}{" "}
              access to another shop under the same client account and {suggestedUserIds.size === 1 ? "is" : "are"}{" "}
              listed first. Confirm the intended audience before saving.
            </p>
          ) : null}
          <Link
            href="/dashboard/collision-intelligence/review#forecast-model-review"
            className="mt-2 inline-block text-sm text-muted-foreground hover:text-ember"
          >
            Return to forecast review
          </Link>
        </div>
      ) : null}

      <InviteUserForm shops={shops} initialShopId={initialShop?.id ?? null} />

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
            <UserAccessCard
              key={user.profileId}
              user={user}
              shops={shops}
              initialShopId={initialShop?.id ?? null}
              relatedShopAccess={suggestedUserIds.has(user.profileId)}
            />
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
  initialShopId,
}: {
  shops: ManagedShop[];
  initialShopId: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminAppRole>("customer");
  const [shopId, setShopId] = useState(initialShopId ?? "");
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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Invite failed (${res.status})`);
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

function UserAccessCard({
  user,
  shops,
  initialShopId,
  relatedShopAccess,
}: {
  user: ManagedUser;
  shops: ManagedShop[];
  initialShopId: string | null;
  relatedShopAccess: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? "");
  const [role, setRole] = useState<AdminAppRole>(user.role ?? "customer");
  const [shopId, setShopId] = useState(initialShopId ?? shops[0]?.id ?? "");
  const [shopRole, setShopRole] = useState<ShopMemberRole>("viewer");
  const [tierShopId, setTierShopId] = useState(
    initialShopId ?? shops[0]?.id ?? ""
  );
  const initialTierShop = shops.find((shop) => shop.id === initialShopId) ?? shops[0];
  const [tier, setTier] = useState<AdminTier | null>(initialTierShop?.tier ?? null);
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
          {relatedShopAccess ? (
            <Badge variant="outline">Related shop access</Badge>
          ) : null}
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
