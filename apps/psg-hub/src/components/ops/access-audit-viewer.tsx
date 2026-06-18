"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AUDIT_CATEGORY_LABELS,
  auditActionLabel,
  auditCategory,
  summarizePayload,
  type AuditCategory,
} from "@/lib/audit/audit-view";

// Access Audit viewer (v1.5 / PSG-29). Read-only — the access_audit table is
// append-only (DB trigger + REVOKE) and superadmin-read via RLS. The server
// page resolves actor/target display names; this component filters + renders.

export type AuditEntry = {
  id: string;
  ts: string;
  action: string;
  actorName: string;
  targetName: string | null;
  payload: Record<string, unknown>;
};

const CATEGORIES: (AuditCategory | "all")[] = [
  "all",
  "users",
  "modules",
  "profiles",
  "superadmin",
  "other",
];

export function AccessAuditViewer({ entries }: { entries: AuditEntry[] }) {
  const [category, setCategory] = useState<AuditCategory | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (category !== "all" && auditCategory(e.action) !== category) return false;
      if (!q) return true;
      const hay = `${auditActionLabel(e.action)} ${e.actorName} ${e.targetName ?? ""} ${summarizePayload(
        e.payload
      )}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, category, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (category === c
                  ? "border-ember bg-ember/10 text-ember"
                  : "border-border text-muted-foreground hover:border-ember/50")
              }
            >
              {c === "all" ? "All" : AUDIT_CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {entries.length === 0
            ? "No audit events recorded yet. Privileged admin actions will appear here."
            : "No events match the current filter."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(e.ts).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{auditActionLabel(e.action)}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{e.actorName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.targetName ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                    {summarizePayload(e.payload) || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {entries.length} event{entries.length === 1 ? "" : "s"}. This
        log is append-only and cannot be edited or deleted.
      </p>
    </div>
  );
}
