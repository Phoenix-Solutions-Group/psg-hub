"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Minimal create form for the Companies vertical (v1.1 / PSG-25). POSTs to the
// manage_companies-gated /api/companies route, then refreshes the server list.
export function NewCompanyForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          contact: contact.trim() || null,
          phone: phone.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setName("");
      setContact("");
      setPhone("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + New company
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Input placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input placeholder="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
        <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {error && <p className="text-sm text-ember">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting || !name.trim()}>
          {submitting ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
