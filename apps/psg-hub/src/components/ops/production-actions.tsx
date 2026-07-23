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
  batch_id: string;
  batch_name: string | null;
  company_id: string;
  shop_name: string | null;
  repair_customer_id: string | null;
  customer_name: string | null;
  status: string;
  piece_type: string;
  vendor: string | null;
  external_id: string | null;
  proof_url: string | null;
  rendered_url: string | null;
  expected_delivery_date: string | null;
  created_at: string;
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

// Historical search filters (mirror the allow-listed /api/production/documents
// query params: print ID / company / product / repair customer / batch / status).
type DocFilters = {
  q: string;
  external_id: string;
  company_id: string;
  product_id: string;
  repair_customer_id: string;
  batch_id: string;
  status: string;
};

const EMPTY_FILTERS: DocFilters = {
  q: "",
  external_id: "",
  company_id: "",
  product_id: "",
  repair_customer_id: "",
  batch_id: "",
  status: "",
};

const searchableDocText = (row: ActionDocRow) =>
  [
    row.external_id,
    row.shop_name,
    row.customer_name,
    row.batch_name,
    row.piece_type,
    row.status,
    row.vendor,
    row.proof_url,
    row.rendered_url,
    row.company_id,
    row.repair_customer_id,
    row.batch_id,
    row.expected_delivery_date,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export function filterProductionDocumentRows(
  rows: ActionDocRow[],
  query: string
): ActionDocRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => searchableDocText(row).includes(q));
}

export function ProductionDocumentsTable({ rows: initialRows }: { rows: ActionDocRow[] }) {
  const [rows, setRows] = useState<ActionDocRow[]>(initialRows);
  const [filters, setFilters] = useState<DocFilters>(EMPTY_FILTERS);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reprintFor, setReprintFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const hasFilters = Object.values(filters).some((v) => v.trim() !== "");

  // Re-fetch the document list from the gated search API. With no filters this
  // returns the latest documents (mirrors the server-rendered "recent" list),
  // so it doubles as the post-action refresh.
  async function runSearch(active: DocFilters) {
    setError(null);
    setSearching(true);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(active)) {
        const v = value.trim();
        if (v) params.set(key, v);
      }
      const res = await fetch(`/api/production/documents?${params.toString()}`);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { documents: ActionDocRow[] };
      setRows(data.documents ?? []);
      setSearched(Object.values(active).some((v) => v.trim() !== ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function printDoc(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await postJson(`/api/production/documents/${id}/print`);
      await runSearch(filters);
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
      await runSearch(filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reprint document");
    } finally {
      setBusyId(null);
    }
  }

  const visibleRows = filterProductionDocumentRows(rows, filters.q);

  function setField(key: keyof DocFilters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  return (
    <details className="space-y-3 rounded-lg border border-border">
      <summary className="cursor-pointer list-none px-4 py-3 font-heading text-sm font-semibold">
        Search history
        <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
          {rows.length} recent {rows.length === 1 ? "document" : "documents"} · collapsed by default
        </span>
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(filters);
          }}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              aria-label="Search production history"
              placeholder="Search shop, customer, batch, print ID, status"
              value={filters.q}
              onChange={(e) => setField("q", e.target.value)}
            />
            <Input
              placeholder="Print ID"
              value={filters.external_id}
              onChange={(e) => setField("external_id", e.target.value)}
            />
            <Input
              placeholder="Company ID (optional)"
              value={filters.company_id}
              onChange={(e) => setField("company_id", e.target.value)}
            />
            <Input
              placeholder="Repair customer ID (optional)"
              value={filters.repair_customer_id}
              onChange={(e) => setField("repair_customer_id", e.target.value)}
            />
            <Input
              placeholder="Product ID (optional)"
              value={filters.product_id}
              onChange={(e) => setField("product_id", e.target.value)}
            />
            <Input
              placeholder="Batch ID (optional)"
              value={filters.batch_id}
              onChange={(e) => setField("batch_id", e.target.value)}
            />
            <select
              aria-label="Filter by status"
              value={filters.status}
              onChange={(e) => setField("status", e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="">Any status</option>
              <option value="created">created</option>
              <option value="rendered">rendered</option>
              <option value="mailed">mailed</option>
              <option value="in_transit">in_transit</option>
              <option value="delivered">delivered</option>
              <option value="returned_to_sender">returned_to_sender</option>
              <option value="failed">failed</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={searching}>
              {searching ? "Searching..." : "Search"}
            </Button>
            {(hasFilters || searched) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={searching}
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  runSearch(EMPTY_FILTERS);
                }}
              >
                Clear
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {visibleRows.length} visible {visibleRows.length === 1 ? "match" : "matches"}
            </span>
          </div>
        </form>

        {error && <p className="text-sm text-ember">{error}</p>}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Print ID</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Shop</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Expected</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    No documents yet.
                  </td>
                </tr>
              ) : (
                visibleRows.map((d) => {
                  const printed = Boolean(d.external_id);
                  const busy = busyId === d.id;
                  const proofHref = d.proof_url ?? d.rendered_url;
                  return (
                    <tr key={d.id} className="border-t border-border align-top">
                      <td className="px-4 py-3 font-mono text-xs">{d.external_id ?? "—"}</td>
                      <td className="px-4 py-3">{d.customer_name ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{d.shop_name ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{d.batch_name ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{d.piece_type}</td>
                      <td className="px-4 py-3">{d.status}</td>
                      <td className="px-4 py-3 text-muted-foreground">{d.vendor ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {d.expected_delivery_date ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-2">
                          {proofHref ? (
                            <a
                              href={proofHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 items-center rounded-md border border-primary px-2.5 font-heading text-[0.8rem] font-medium text-primary hover:bg-primary hover:text-primary-foreground"
                            >
                              View proof
                            </a>
                          ) : null}
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
    </details>
  );
}
