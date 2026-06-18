"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// v1.3 / PSG-27 (PSG-41) — interactive print queue + document actions. Client
// surface over the existing gated POST routes: print a whole batch
// (/api/production/batches/[id]/print, moves it printing→historical), print a
// single not-yet-submitted document (/documents/[id]/print), and reprint with a
// recorded reason (/documents/[id]/reprint → production_reprint_log audit row).
// Server data is re-fetched via router.refresh() after each action.

export type QueueBatchRow = {
  id: string;
  name: string;
  status: string;
  vendor: string | null;
  document_count: number;
  printed_at: string | null;
};

export type ActionDocRow = {
  id: string;
  status: string;
  piece_type: string;
  vendor: string | null;
  external_id: string | null;
  expected_delivery_date: string | null;
};

async function postJson(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? `Request failed (${res.status})`);
  }
}

export function ProductionQueueTable({ rows }: { rows: QueueBatchRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function printBatch(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await postJson(`/api/production/batches/${id}/print`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to print batch");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-ember">{error}</p>}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Documents</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No active batches.
                </td>
              </tr>
            ) : (
              rows.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{b.name}</td>
                  <td className="px-4 py-3">{b.status}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.vendor ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.document_count}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === b.id}
                      onClick={() => printBatch(b.id)}
                    >
                      {busyId === b.id ? "Printing…" : "Print batch"}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProductionDocumentsTable({ rows }: { rows: ActionDocRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reprintFor, setReprintFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function printDoc(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await postJson(`/api/production/documents/${id}/print`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to print document");
    } finally {
      setBusyId(null);
    }
  }

  async function reprintDoc(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await postJson(`/api/production/documents/${id}/reprint`, {
        reason: reason.trim() || null,
      });
      setReprintFor(null);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reprint document");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-ember">{error}</p>}
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Print ID</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Expected</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No documents yet.
                </td>
              </tr>
            ) : (
              rows.map((d) => {
                const printed = Boolean(d.external_id);
                const busy = busyId === d.id;
                return (
                  <tr key={d.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-mono text-xs">{d.external_id ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.piece_type}</td>
                    <td className="px-4 py-3">{d.status}</td>
                    <td className="px-4 py-3 text-muted-foreground">{d.vendor ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {d.expected_delivery_date ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-end gap-2">
                        {!printed ? (
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy}
                            onClick={() => printDoc(d.id)}
                          >
                            {busy ? "Printing…" : "Print"}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              setReprintFor(reprintFor === d.id ? null : d.id);
                              setReason("");
                            }}
                          >
                            Reprint
                          </Button>
                        )}
                        {reprintFor === d.id && (
                          <div className="flex w-64 flex-col gap-2 rounded-md border border-border p-2">
                            <Input
                              placeholder="Reason (optional, audited)"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => setReprintFor(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={busy}
                                onClick={() => reprintDoc(d.id)}
                              >
                                {busy ? "Reprinting…" : "Confirm reprint"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
