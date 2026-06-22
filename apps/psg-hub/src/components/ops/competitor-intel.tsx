"use client";

// v1.6 / PSG-210 — Competitor Intelligence ops surface (client).
// Mirrors the Ads Mutation Studio pattern: a shop picker + "Run report" that calls the
// existing superadmin API route (GET /api/ops/intel/competitor-report?shopId=<uuid>&format=html)
// and renders the returned self-contained HTML report inline (isolated in an <iframe srcdoc>
// so the report's own design tokens / @font-face never leak into the ops shell).
//
// The three states the route can produce are surfaced cleanly:
//   - rendered      — 200, the branded HTML report
//   - no-data       — 404, the shop has no scored competitor set (no metered call was made)
//   - error         — 401/403/5xx, shown verbatim from the route's { error } body
// A standing metered/cost notice is shown before any run: the grounded narrative calls a paid
// model (a few cents) and is G5/spend-cap-gated — this is the cost-aware superadmin surface.

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type IntelShopOption = { id: string; name: string };

type RunState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "rendered"; html: string }
  | { kind: "no-data"; message: string }
  | { kind: "error"; message: string };

/**
 * Pure: turn a non-OK report-route response into a RunState. 404 is the documented
 * "no competitor data for this shop" signal (no vendor spend happened); everything else
 * surfaces the route's { error } string (falling back to a status-derived message).
 */
export function runStateFromResponse(
  status: number,
  body: { error?: string } | null,
): RunState {
  if (status === 404) {
    return {
      kind: "no-data",
      message:
        body?.error ?? "No competitor data for this shop. Nothing to report on yet.",
    };
  }
  return {
    kind: "error",
    message: body?.error ?? `Report failed (HTTP ${status}).`,
  };
}

export function CompetitorIntel({ shops }: { shops: IntelShopOption[] }) {
  const [shopId, setShopId] = useState<string>(shops[0]?.id ?? "");
  const [state, setState] = useState<RunState>({ kind: "idle" });

  const run = useCallback(async () => {
    if (!shopId) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/ops/intel/competitor-report?shopId=${encodeURIComponent(shopId)}&format=html`,
        { headers: { Accept: "text/html" } },
      );
      if (res.ok) {
        setState({ kind: "rendered", html: await res.text() });
        return;
      }
      // Non-OK paths always return JSON { error } from the route.
      let body: { error?: string } | null = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      setState(runStateFromResponse(res.status, body));
    } catch {
      setState({ kind: "error", message: "Network error running the report." });
    }
  }, [shopId]);

  if (shops.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No shops have scored competitors yet. Run the competitor sync for a shop first,
        then its report will be selectable here.
      </div>
    );
  }

  const selectedName = shops.find((s) => s.id === shopId)?.name ?? "";

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
        <p className="font-semibold text-warning">Metered — runs a paid model</p>
        <p className="mt-1 text-muted-foreground">
          Running a report calls a grounded AI model (a few cents) and is enforced against the
          monthly spend cap. If the cap is hit or the gateway key is unset, the report still
          renders the deterministic score table and degrades the narrative fail-closed.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="intel-shop">Shop</Label>
          <select
            id="intel-shop"
            aria-label="Shop"
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            className="h-9 w-72 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.id}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={state.kind === "loading" || !shopId}>
          {state.kind === "loading" ? "Running…" : "Run report"}
        </Button>
      </form>

      {state.kind === "no-data" && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <p className="font-semibold">No competitor data</p>
          <p className="mt-1 text-muted-foreground">{state.message}</p>
        </div>
      )}

      {state.kind === "error" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {state.message}
        </p>
      )}

      {state.kind === "rendered" && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Report</Badge>
            {selectedName}
          </p>
          <iframe
            title={`Competitor report — ${selectedName}`}
            srcDoc={state.html}
            className="h-[1400px] w-full rounded-lg border border-border bg-white"
          />
        </div>
      )}
    </div>
  );
}
