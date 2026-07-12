"use client";

import { type FormEvent, useMemo, useState } from "react";
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

export type ManagedShop = {
  id: string;
  name: string;
  slug: string | null;
  tier: AdminTier | null;
  subscriptionStatus: string | null;
};

export type ManagedUser = {
  profileId: string;
  displayName: string;
  email: string | null;
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
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.displayName, u.email ?? "", u.profileId]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [query, users]);

  return (
    <section className="space-y-6">
      <InviteUserForm shops={shops} />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold">Users and shop access</h2>
            <p className="text-sm text-muted-foreground">
              Find a user, set their role, assign shops, and adjust a shop tier.
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
              No users match that search.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function InviteUserForm({ shops }: { shops: ManagedShop[] }) {
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
            Send an invite and set the starting role and optional shop access.
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
                {s.name}
              </option>
            ))}
          </select>
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
  const [role, setRole] = useState<AdminAppRole>(user.role ?? "customer");
  const [shopId, setShopId] = useState(shops[0]?.id ?? "");
  const [shopRole, setShopRole] = useState<ShopMemberRole>("viewer");
  const [tierShopId, setTierShopId] = useState(shops[0]?.id ?? "");
  const [tier, setTier] = useState<AdminTier>(shops[0]?.tier ?? "essentials");
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

  return (
    <article className="rounded-lg border border-border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-heading font-semibold">{user.displayName}</div>
          <div className="text-sm text-muted-foreground">{user.email ?? user.profileId}</div>
        </div>
        <Badge variant="secondary">{user.role ? ADMIN_APP_ROLE_LABELS[user.role] : "No role"}</Badge>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`role-${user.profileId}`}>
            Global role
          </label>
          <select
            id={`role-${user.profileId}`}
            value={role}
            onChange={(e) => setRole(e.target.value as AdminAppRole)}
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
            disabled={busy !== null || role === user.role}
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
            Assign shop
          </label>
          <select
            id={`shop-${user.profileId}`}
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={shopRole}
            onChange={(e) => setShopRole(e.target.value as ShopMemberRole)}
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
            disabled={busy !== null || !shopId}
            onClick={() =>
              callApi(
                `/api/ops/admin/users/${user.profileId}/shops`,
                { method: "POST", body: JSON.stringify({ shopId, role: shopRole }) },
                "shop"
              )
            }
          >
            Assign shop
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`tier-${user.profileId}`}>
            Shop tier
          </label>
          <select
            id={`tier-${user.profileId}`}
            value={tierShopId}
            onChange={(e) => {
              const nextShop = shops.find((s) => s.id === e.target.value);
              setTierShopId(e.target.value);
              setTier(nextShop?.tier ?? "essentials");
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as AdminTier)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {ADMIN_TIERS.map((t) => (
              <option key={t} value={t}>
                {ADMIN_TIER_LABELS[t]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={busy !== null || !tierShopId || tierShop?.tier === tier}
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
                  disabled={busy !== null}
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

      {error && <p className="mt-3 text-sm text-ember">{error}</p>}
    </article>
  );
}
