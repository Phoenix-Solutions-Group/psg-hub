"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Employee = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
};

type Draft = { name: string; role: string; email: string; phone: string };

const EMPTY: Draft = { name: "", role: "", email: "", phone: "" };

// Employees CRUD for a company (v1.1 / PSG-33). Talks to
// /api/companies/[id]/employees (+ /[employeeId]); all manage_companies-gated.
export function EmployeesManager({
  companyId,
  initialEmployees,
}: {
  companyId: string;
  initialEmployees: Employee[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toPayload(d: Draft) {
    return {
      name: d.name.trim(),
      role: d.role.trim() || null,
      email: d.email.trim() || null,
      phone: d.phone.trim() || null,
    };
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(draft)),
      });
      if (!res.ok) throw new Error(await errText(res));
      setDraft(EMPTY);
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add employee");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/employees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(draft)),
      });
      if (!res.ok) throw new Error(await errText(res));
      setEditingId(null);
      setDraft(EMPTY);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save employee");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/employees/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await errText(res));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete employee");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(emp: Employee) {
    setEditingId(emp.id);
    setAdding(false);
    setDraft({
      name: emp.name,
      role: emp.role ?? "",
      email: emp.email ?? "",
      phone: emp.phone ?? "",
    });
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-ember">{error}</p>}

      {adding ? (
        <form onSubmit={create} className="space-y-3 rounded-lg border border-border p-4">
          <DraftFields draft={draft} setDraft={setDraft} />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !draft.name.trim()}>
              {busy ? "Saving…" : "Add employee"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
            setDraft(EMPTY);
          }}
        >
          + New employee
        </Button>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialEmployees.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No employees yet.
                </td>
              </tr>
            ) : (
              initialEmployees.map((emp) =>
                editingId === emp.id ? (
                  <tr key={emp.id} className="border-t border-border bg-muted/20">
                    <td colSpan={5} className="px-4 py-3">
                      <DraftFields draft={draft} setDraft={setDraft} />
                      <div className="mt-3 flex gap-2">
                        <Button
                          type="button"
                          onClick={() => saveEdit(emp.id)}
                          disabled={busy || !draft.name.trim()}
                        >
                          {busy ? "Saving…" : "Save"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null);
                            setDraft(EMPTY);
                          }}
                          disabled={busy}
                        >
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={emp.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{emp.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{emp.role ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{emp.email ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{emp.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(emp)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => remove(emp.id)}
                          disabled={busy}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DraftFields({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input
        placeholder="Name"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        required
      />
      <Input
        placeholder="Role"
        value={draft.role}
        onChange={(e) => setDraft({ ...draft, role: e.target.value })}
      />
      <Input
        placeholder="Email"
        type="email"
        value={draft.email}
        onChange={(e) => setDraft({ ...draft, email: e.target.value })}
      />
      <Input
        placeholder="Phone"
        value={draft.phone}
        onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
      />
    </div>
  );
}

async function errText(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `Request failed (${res.status})`;
}
