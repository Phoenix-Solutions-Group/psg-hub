"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";

// Per-user security-profile assignment grid (v1.1 / PSG-39). Superadmin-only.
// Each ops staff user gets a row; toggling a profile chip assigns/unassigns it
// via the audited /api/ops/security-profiles/assignments route.

export type StaffUser = {
  profileId: string;
  displayName: string;
  email: string | null;
  role: string;
};

export type ProfileOption = { id: string; name: string };

export function UserProfileAssigner({
  users,
  profiles,
  assignments,
}: {
  users: StaffUser[];
  profiles: ProfileOption[];
  /** [profileId(user), securityProfileId] pairs currently assigned. */
  assignments: Array<{ profileId: string; securityProfileId: string }>;
}) {
  const initial = new Set(assignments.map((a) => `${a.profileId}:${a.securityProfileId}`));

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">Staff assignments</h2>
        <p className="text-sm text-muted-foreground">
          Assign named profiles to ops staff. A user&apos;s effective capabilities are the union of
          every profile assigned to them.
        </p>
      </div>

      {users.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          No ops staff users found.
        </p>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <UserRow
              key={u.profileId}
              user={u}
              profiles={profiles}
              assignedSet={initial}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UserRow({
  user,
  profiles,
  assignedSet,
}: {
  user: StaffUser;
  profiles: ProfileOption[];
  assignedSet: Set<string>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(securityProfileId: string, currentlyAssigned: boolean) {
    setError(null);
    setPending(securityProfileId);
    try {
      const res = await fetch("/api/ops/security-profiles/assignments", {
        method: currentlyAssigned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: user.profileId, securityProfileId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update assignment");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{user.displayName}</span>
          {user.email && <span className="ml-2 text-sm text-muted-foreground">{user.email}</span>}
        </div>
        <Badge variant="secondary">{user.role}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {profiles.map((p) => {
          const assigned = assignedSet.has(`${user.profileId}:${p.id}`);
          return (
            <button
              key={p.id}
              type="button"
              disabled={pending === p.id}
              onClick={() => toggle(p.id, assigned)}
              className={
                "rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50 " +
                (assigned
                  ? "border-ember bg-ember/10 text-ember"
                  : "border-border text-muted-foreground hover:border-foreground/40")
              }
            >
              {assigned ? "✓ " : "+ "}
              {p.name}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-ember">{error}</p>}
    </div>
  );
}
