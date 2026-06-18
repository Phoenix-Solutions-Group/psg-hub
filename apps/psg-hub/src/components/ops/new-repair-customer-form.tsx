"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Create form for the Repair Customers vertical (v1.1 / PSG-34). POSTs to the
// manage_companies-gated /api/repair-customers route, then refreshes the list.
type CompanyOption = { id: string; name: string };

export function NewRepairCustomerForm({
  companies,
  defaultCompanyId,
}: {
  companies: CompanyOption[];
  defaultCompanyId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/repair-customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      setFirstName("");
      setLastName("");
      setPhone("");
      setEmail("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create repair customer");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + New repair customer
      </Button>
    );
  }

  const ready = companyId && firstName.trim() && lastName.trim();

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-4">
      <select
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
        required
        className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
      >
        <option value="">Select company…</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <Input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p className="text-sm text-ember">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting || !ready}>
          {submitting ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
