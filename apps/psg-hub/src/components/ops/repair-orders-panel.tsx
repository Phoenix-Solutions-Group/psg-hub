"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Repair Orders panel for a customer detail page (v1.1 / PSG-34). Drives the
// Add-New-RO, Preview, Cancel, and Add-Additional-Document workflows against the
// /api/repair-orders[/id] + .../documents routes, then refreshes server data.

type Option = { id: string; name: string };
type VehicleOption = { id: string; make: string; model: string };
type RoStatus = "open" | "preview" | "cancelled" | "closed";

type OrderRow = {
  id: string;
  ro_number: string;
  status: RoStatus;
  total_loss_flag: boolean;
  vehicle_id: string | null;
  insurance_company_id: string | null;
  insurance_agent_id: string | null;
  payload_jsonb: { documents?: unknown[] } | null;
  created_at: string;
};

const STATUS_VARIANT: Record<RoStatus, "default" | "secondary" | "warning" | "destructive" | "success"> = {
  open: "secondary",
  preview: "warning",
  cancelled: "destructive",
  closed: "success",
};

export function RepairOrdersPanel({
  repairCustomerId,
  companyId,
  orders,
  vehicles,
  insuranceCompanies,
  insuranceAgents,
}: {
  repairCustomerId: string;
  companyId: string;
  orders: OrderRow[];
  vehicles: VehicleOption[];
  insuranceCompanies: Option[];
  insuranceAgents: Option[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New-RO form fields.
  const [roNumber, setRoNumber] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [insCompanyId, setInsCompanyId] = useState("");
  const [insAgentId, setInsAgentId] = useState("");
  const [totalLoss, setTotalLoss] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Add-document state, keyed by RO id.
  const [docFor, setDocFor] = useState<string | null>(null);
  const [docName, setDocName] = useState("");
  const [docKind, setDocKind] = useState("supplement");
  const [docUrl, setDocUrl] = useState("");

  async function createRo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/repair-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repair_customer_id: repairCustomerId,
          company_id: companyId,
          ro_number: roNumber.trim(),
          vehicle_id: vehicleId || null,
          insurance_company_id: insCompanyId || null,
          insurance_agent_id: insAgentId || null,
          total_loss_flag: totalLoss,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Request failed (${res.status})`);
      }
      setRoNumber("");
      setVehicleId("");
      setInsCompanyId("");
      setInsAgentId("");
      setTotalLoss(false);
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create RO");
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(ro: OrderRow, status: RoStatus) {
    setError(null);
    setBusyId(ro.id);
    try {
      const res = await fetch(`/api/repair-orders/${ro.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update RO");
    } finally {
      setBusyId(null);
    }
  }

  async function addDocument(roId: string, e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusyId(roId);
    try {
      const res = await fetch(`/api/repair-orders/${roId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: docName.trim(),
          kind: docKind.trim() || "other",
          url: docUrl.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Request failed (${res.status})`);
      }
      setDocFor(null);
      setDocName("");
      setDocUrl("");
      setDocKind("supplement");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add document");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">Repair Orders</h2>
        {!adding && (
          <Button type="button" onClick={() => setAdding(true)}>
            + Add new RO
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-ember">{error}</p>}

      {adding && (
        <form onSubmit={createRo} className="space-y-3 rounded-lg border border-border p-4">
          <Input placeholder="RO number" value={roNumber} onChange={(e) => setRoNumber(e.target.value)} required />
          <div className="grid gap-3 sm:grid-cols-3">
            <Select value={vehicleId} onChange={setVehicleId} placeholder="Vehicle (optional)">
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make} {v.model}
                </option>
              ))}
            </Select>
            <Select value={insCompanyId} onChange={setInsCompanyId} placeholder="Insurance co. (optional)">
              {insuranceCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select value={insAgentId} onChange={setInsAgentId} placeholder="Insurance agent (optional)">
              {insuranceAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={totalLoss} onChange={(e) => setTotalLoss(e.target.checked)} />
            Total loss
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting || !roNumber.trim()}>
              {submitting ? "Saving…" : "Create RO"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {orders.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          No repair orders yet for this customer.
        </p>
      ) : (
        <ul className="space-y-3">
          {orders.map((ro) => {
            const docs = Array.isArray(ro.payload_jsonb?.documents) ? ro.payload_jsonb!.documents! : [];
            const terminal = ro.status === "cancelled" || ro.status === "closed";
            return (
              <li key={ro.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{ro.ro_number}</span>
                    <Badge variant={STATUS_VARIANT[ro.status]}>{ro.status}</Badge>
                    {ro.total_loss_flag && <Badge variant="outline">total loss</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {docs.length} doc{docs.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ro.status === "open" && (
                      <Button type="button" size="sm" variant="outline" disabled={busyId === ro.id} onClick={() => setStatus(ro, "preview")}>
                        Preview
                      </Button>
                    )}
                    {ro.status === "preview" && (
                      <Button type="button" size="sm" variant="outline" disabled={busyId === ro.id} onClick={() => setStatus(ro, "open")}>
                        Back to open
                      </Button>
                    )}
                    {!terminal && (
                      <Button type="button" size="sm" variant="ghost" disabled={busyId === ro.id} onClick={() => setDocFor(docFor === ro.id ? null : ro.id)}>
                        Add document
                      </Button>
                    )}
                    {!terminal && (
                      <Button type="button" size="sm" variant="destructive" disabled={busyId === ro.id} onClick={() => setStatus(ro, "cancelled")}>
                        Cancel RO
                      </Button>
                    )}
                  </div>
                </div>

                {docs.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                    {docs.map((d, i) => {
                      const doc = d as { id?: string; name?: string; kind?: string; url?: string | null };
                      return (
                        <li key={doc.id ?? i} className="flex items-center gap-2 text-muted-foreground">
                          <span className="font-medium text-foreground">{doc.name}</span>
                          <span className="text-xs">({doc.kind})</span>
                          {doc.url && (
                            <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-ember hover:underline">
                              open
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {docFor === ro.id && (
                  <form onSubmit={(e) => addDocument(ro.id, e)} className="mt-3 space-y-2 border-t border-border pt-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input placeholder="Document name" value={docName} onChange={(e) => setDocName(e.target.value)} required />
                      <Select value={docKind} onChange={setDocKind} placeholder="Kind">
                        <option value="supplement">Supplement</option>
                        <option value="estimate">Estimate</option>
                        <option value="photo">Photo</option>
                        <option value="authorization">Authorization</option>
                        <option value="other">Other</option>
                      </Select>
                      <Input placeholder="URL (optional)" value={docUrl} onChange={(e) => setDocUrl(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={busyId === ro.id || !docName.trim()}>
                        {busyId === ro.id ? "Saving…" : "Add document"}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setDocFor(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Lightweight native select styled to match the Input primitive (no Select in ui/).
function Select({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  );
}
