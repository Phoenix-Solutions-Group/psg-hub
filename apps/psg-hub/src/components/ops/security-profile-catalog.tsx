"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Security-profile catalog editor (v1.1 / PSG-39). Superadmin-only surface for
// creating named profiles and editing their capability (function) flags.
// Built-in profiles (Administrator) render read-only — the always-on safety net.

export type CapabilityOption = { key: string; label: string };

export type ProfileDef = {
  id: string;
  name: string;
  is_builtin: boolean;
  functions_jsonb: Record<string, unknown>;
};

function grantedKeys(def: ProfileDef, capabilities: CapabilityOption[]): Set<string> {
  return new Set(capabilities.filter((c) => Boolean(def.functions_jsonb?.[c.key])).map((c) => c.key));
}

export function SecurityProfileCatalog({
  profiles,
  capabilities,
}: {
  profiles: ProfileDef[];
  capabilities: CapabilityOption[];
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">Security profiles</h2>
          <p className="text-sm text-muted-foreground">
            Reusable capability bundles. Assign them to ops staff below.
          </p>
        </div>
        <NewProfileForm capabilities={capabilities} />
      </div>

      <div className="space-y-3">
        {profiles.map((p) => (
          <ProfileCard key={p.id} profile={p} capabilities={capabilities} />
        ))}
      </div>
    </section>
  );
}

function NewProfileForm({ capabilities }: { capabilities: CapabilityOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/ops/security-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), functions: [...selected] }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setName("");
      setSelected(new Set());
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + New profile
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-lg border border-border p-4">
      <Input placeholder="Profile name" value={name} onChange={(e) => setName(e.target.value)} required />
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Capabilities
        </legend>
        {capabilities.map((c) => (
          <label key={c.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
            {c.label}
            <code className="text-xs text-muted-foreground">{c.key}</code>
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-ember">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Create"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ProfileCard({
  profile,
  capabilities,
}: {
  profile: ProfileDef;
  capabilities: CapabilityOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => grantedKeys(profile, capabilities));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/ops/security-profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ functions: [...selected] }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete profile "${profile.name}"? Assigned users lose this grant.`)) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/ops/security-profiles/${profile.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setBusy(false);
    }
  }

  const granted = grantedKeys(profile, capabilities);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-heading font-semibold">{profile.name}</span>
          {profile.is_builtin && <Badge variant="secondary">Built-in</Badge>}
        </div>
        {!profile.is_builtin && !editing && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
              Delete
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          {capabilities.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
              {c.label}
              <code className="text-xs text-muted-foreground">{c.key}</code>
            </label>
          ))}
          {error && <p className="text-sm text-ember">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(grantedKeys(profile, capabilities));
                setEditing(false);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {capabilities
            .filter((c) => granted.has(c.key))
            .map((c) => (
              <Badge key={c.key} variant="outline">
                {c.label}
              </Badge>
            ))}
          {granted.size === 0 && (
            <span className="text-sm text-muted-foreground">No capabilities granted</span>
          )}
          {error && <p className="w-full text-sm text-ember">{error}</p>}
        </div>
      )}
    </div>
  );
}
