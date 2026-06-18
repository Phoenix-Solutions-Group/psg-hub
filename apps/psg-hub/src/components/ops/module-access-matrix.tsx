"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  GRANT_ROLES,
  GRANT_ROLE_LABELS,
  MODULE_AUDIENCES,
  MODULE_AUDIENCE_LABELS,
  MODULE_TIERS,
  roleMatrixFor,
  targetedOverrideCount,
  type GrantRole,
  type GrantRow,
  type ModuleRow,
  type RoleEffect,
} from "@/lib/ops/modules";

// Module Access Matrix editor (v1.5 / PSG-29). Superadmin-only surface for the
// module registry: create modules, edit their tier floor / audience / default
// visibility, and toggle the per-role allow/deny/inherit grid. Each mutation
// hits the audited /api/ops/modules surface and refreshes server state.

const TRI: { value: RoleEffect; label: string }[] = [
  { value: "inherit", label: "Inherit" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
];

export function ModuleAccessMatrix({
  modules,
  grants,
}: {
  modules: ModuleRow[];
  grants: GrantRow[];
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">Modules</h2>
          <p className="text-sm text-muted-foreground">
            Each module resolves as: explicit profile/shop grant &gt; role grant &gt; tier floor &gt;
            default. The grid below edits role grants; per-user and per-shop overrides resolve at
            read time.
          </p>
        </div>
        <NewModuleForm />
      </div>

      {modules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No modules registered yet. Create one to start building the access matrix.
        </div>
      ) : (
        <div className="space-y-3">
          {modules.map((m) => (
            <ModuleCard key={m.id} module={m} grants={grants} />
          ))}
        </div>
      )}
    </section>
  );
}

function NewModuleForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [audience, setAudience] = useState<string>("customer");
  const [minTier, setMinTier] = useState<string>("");
  const [defaultVisibility, setDefaultVisibility] = useState<string>("visible");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/ops/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          displayName: displayName.trim(),
          audience,
          minTier: minTier === "" ? null : minTier,
          defaultVisibility,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setSlug("");
      setDisplayName("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create module");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + New module
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-lg border border-border p-4">
      <Input placeholder="Slug (e.g. ads-studio)" value={slug} onChange={(e) => setSlug(e.target.value)} required />
      <Input
        placeholder="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        required
      />
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Audience
        </span>
        <select
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        >
          {MODULE_AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {MODULE_AUDIENCE_LABELS[a]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tier floor
        </span>
        <select
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={minTier}
          onChange={(e) => setMinTier(e.target.value)}
        >
          <option value="">No floor</option>
          {MODULE_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Default visibility
        </span>
        <select
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={defaultVisibility}
          onChange={(e) => setDefaultVisibility(e.target.value)}
        >
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
        </select>
      </label>
      {error && <p className="text-sm text-ember">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !slug.trim() || !displayName.trim()}>
          {saving ? "Saving…" : "Create"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ModuleCard({ module, grants }: { module: ModuleRow; grants: GrantRow[] }) {
  const router = useRouter();
  const [busyRole, setBusyRole] = useState<GrantRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matrix = roleMatrixFor(module.id, grants);
  const overrides = targetedOverrideCount(module.id, grants);

  async function setRole(role: GrantRole, next: RoleEffect) {
    setError(null);
    setBusyRole(role);
    try {
      const res =
        next === "inherit"
          ? await fetch("/api/ops/modules/grants", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ moduleId: module.id, role }),
            })
          : await fetch("/api/ops/modules/grants", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ moduleId: module.id, role, effect: next }),
            });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update grant");
    } finally {
      setBusyRole(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete module "${module.display_name}"? Its access grants are removed too.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/ops/modules/${module.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete module");
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-heading font-semibold">{module.display_name}</span>
          <code className="text-xs text-muted-foreground">{module.slug}</code>
          <Badge variant="outline">{MODULE_AUDIENCE_LABELS[module.audience]}</Badge>
          {module.min_tier_slug && <Badge variant="secondary">≥ {module.min_tier_slug}</Badge>}
          <Badge variant={module.default_visibility === "visible" ? "default" : "secondary"}>
            default {module.default_visibility}
          </Badge>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={remove}>
          Delete
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {GRANT_ROLES.map((role) => (
          <div key={role} className="flex items-center justify-between gap-3">
            <span className="text-sm">{GRANT_ROLE_LABELS[role]}</span>
            <div className="flex gap-1">
              {TRI.map((opt) => {
                const active = matrix[role] === opt.value;
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    disabled={busyRole === role}
                    onClick={() => !active && setRole(role, opt.value)}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {overrides > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {overrides} per-user/shop override{overrides === 1 ? "" : "s"} active (resolved at read
          time).
        </p>
      )}
      {error && <p className="mt-2 text-sm text-ember">{error}</p>}
    </div>
  );
}
