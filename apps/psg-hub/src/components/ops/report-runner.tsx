"use client";

// v1.4 / PSG-28 — Operational report runner UI.
// Renders the date-range + filter form, runs the report through the shared API
// (/api/ops/reports/{slug}), shows the result table, and offers CSV / Excel /
// PDF export (the export links carry the same query string as the run).

import { useCallback, useEffect, useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCell } from "@/lib/ops/reports/export";
import type {
  ReportColumn,
  ReportFilterSpec,
  ReportRow,
} from "@/lib/ops/reports/types";

type RunnerProps = {
  slug: string;
  hasDateRange: boolean;
  filters: ReportFilterSpec[];
  columns: ReportColumn[];
  defaultStart: string;
  defaultEnd: string;
  sample: boolean;
};

type RunState = {
  loading: boolean;
  error: string | null;
  rows: ReportRow[];
  sample: boolean;
  ranAt: string | null;
};

function isNumeric(c: ReportColumn) {
  return c.type === "number" || c.type === "currency" || c.type === "percent";
}

export function ReportRunner({
  slug,
  hasDateRange,
  filters,
  columns,
  defaultStart,
  defaultEnd,
  sample,
}: RunnerProps) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<RunState>({
    loading: true,
    error: null,
    rows: [],
    sample,
    ranAt: null,
  });

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (hasDateRange) {
      if (start) sp.set("start", start);
      if (end) sp.set("end", end);
    }
    for (const [k, v] of Object.entries(filterValues)) {
      if (v) sp.set(k, v);
    }
    return sp.toString();
  }, [hasDateRange, start, end, filterValues]);

  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`/api/ops/reports/${slug}?${queryString}`, {
        headers: { Accept: "application/json" },
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(body?.details)
          ? body.details.join("; ")
          : body?.error ?? "Failed to run report";
        setState((s) => ({ ...s, loading: false, error: detail }));
        return;
      }
      setState({
        loading: false,
        error: null,
        rows: body.rows ?? [],
        sample: Boolean(body.sample),
        ranAt: body.generatedAt ?? null,
      });
    } catch {
      setState((s) => ({
        ...s,
        loading: false,
        error: "Network error running report",
      }));
    }
  }, [slug, queryString]);

  // Initial run on mount.
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportHref = (format: string) =>
    `/api/ops/reports/${slug}?${queryString}${queryString ? "&" : ""}format=${format}`;
  const printHref = `/ops/reports/${slug}/print?${queryString}`;

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        {hasDateRange && (
          <>
            <div className="space-y-1">
              <Label htmlFor="start">Start</Label>
              <Input
                id="start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end">End</Label>
              <Input
                id="end"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-40"
              />
            </div>
          </>
        )}

        {filters.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={f.key}>{f.label}</Label>
            {f.type === "enum" && f.options ? (
              <select
                id={f.key}
                value={filterValues[f.key] ?? ""}
                onChange={(e) =>
                  setFilterValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
                className="h-9 w-44 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">All</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={f.key}
                value={filterValues[f.key] ?? ""}
                placeholder={f.type === "shop" ? "Shop id (optional)" : ""}
                onChange={(e) =>
                  setFilterValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
                className="w-44"
              />
            )}
          </div>
        ))}

        <button
          type="submit"
          className={cn(buttonVariants({ variant: "default" }))}
          disabled={state.loading}
        >
          {state.loading ? "Running…" : "Run report"}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <a className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={exportHref("csv")}>
            CSV
          </a>
          <a className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={exportHref("xls")}>
            Excel
          </a>
          <a
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            href={printHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            PDF
          </a>
        </div>
      </form>

      {state.sample && (
        <p className="text-xs text-muted-foreground">
          <Badge variant="secondary">Sample data</Badge> Illustrative rows — this
          report&apos;s backing ops data is not yet live.
        </p>
      )}

      {state.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead
                    key={c.key}
                    className={isNumeric(c) ? "text-right" : undefined}
                  >
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.rows.length === 0 && !state.loading ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                    No rows for the selected parameters.
                  </TableCell>
                </TableRow>
              ) : (
                state.rows.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={isNumeric(c) ? "text-right tabular-nums" : undefined}
                      >
                        {formatCell(row[c.key] ?? null, c.type)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {state.ranAt && (
        <p className="text-xs text-muted-foreground">
          {state.rows.length} row{state.rows.length === 1 ? "" : "s"} ·
          generated {state.ranAt}
        </p>
      )}
    </div>
  );
}
