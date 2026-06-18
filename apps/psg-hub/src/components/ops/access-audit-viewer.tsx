"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  formatPayloadDetail,
  hasPayloadDetail,
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <Button
              key={c}
              type="button"
              size="xs"
              variant={category === c ? "accent" : "outline"}
              className="rounded-full"
              onClick={() => setCategory(c)}
            >
              {c === "all" ? "All" : AUDIT_CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>
        <Input
          type="search"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto w-48"
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
              {filtered.map((e) => {
                const summary = summarizePayload(e.payload) || "—";
                const drillable = hasPayloadDetail(e.payload);
                const isOpen = expanded.has(e.id);
                return [
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
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span className="max-w-xs truncate" title={summary}>
                          {summary}
                        </span>
                        {drillable && (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            aria-expanded={isOpen}
                            onClick={() => toggle(e.id)}
                          >
                            {isOpen ? "Hide" : "Details"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>,
                  drillable && isOpen ? (
                    <TableRow key={`${e.id}-detail`}>
                      <TableCell colSpan={5} className="bg-muted/30">
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 text-xs text-foreground">
                          {formatPayloadDetail(e.payload)}
                        </pre>
                      </TableCell>
                    </TableRow>
                  ) : null,
                ];
              })}
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
