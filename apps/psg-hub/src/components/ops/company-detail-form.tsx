"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CompanyAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
};

type Company = {
  id: string;
  name: string;
  phone: string | null;
  contact: string | null;
  status: "active" | "inactive" | "prospect";
  address: CompanyAddress | null;
};

const STATUSES: Company["status"][] = ["active", "inactive", "prospect"];

// Company detail editor (v1.1 / PSG-33). PATCHes /api/companies/[id]; DELETE
// behind a confirm. Both are gated server-side by manage_companies.
export function CompanyDetailForm({ company }: { company: Company }) {
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [contact, setContact] = useState(company.contact ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [status, setStatus] = useState<Company["status"]>(company.status);
  const addr = company.address ?? {};
  const [line1, setLine1] = useState(addr.line1 ?? "");
  const [city, setCity] = useState(addr.city ?? "");
  const [state, setState] = useState(addr.state ?? "");
  const [postal, setPostal] = useState(addr.postal_code ?? "");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          contact: contact.trim() || null,
          phone: phone.trim() || null,
          status,
          address: {
            line1: line1.trim() || undefined,
            city: city.trim() || undefined,
            state: state.trim() || undefined,
            postal_code: postal.trim() || undefined,
          },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/companies/${company.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      router.push("/ops/companies");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-lg border border-border p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Company name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Company["status"])}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Contact</span>
          <Input value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Phone</span>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="space-y-1 sm:col-span-4">
          <span className="text-xs font-medium text-muted-foreground">Address</span>
          <Input
            placeholder="Street"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
          />
        </label>
        <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
        <Input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
        <Input
          placeholder="Postal code"
          value={postal}
          onChange={(e) => setPostal(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-ember">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}

      <div className="flex items-center justify-between">
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save changes"}
        </Button>

        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Delete this company?</span>
            <Button type="button" variant="destructive" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmDelete(true)}
          >
            Delete company
          </Button>
        )}
      </div>
    </form>
  );
}
