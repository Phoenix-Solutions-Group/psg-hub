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
//   - error         — 401/403/5xx, a plain-language line over the route's { error } detail
// A standing cost notice is shown before any run (the report calls a paid AI service, a few
// cents, and counts against the monthly budget cap) — this is the cost-aware superadmin surface.

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type IntelShopOption = { id: string; name: string };

// The report HTML has an inherently variable height (one threat-table row per competitor,
// wrapping rationales, a wide-swinging executive summary). A fixed iframe height is wrong in
// both directions — too tall nests a double-scrollbar and pushes the "Not for external
// distribution" footer below the fold; too short leaves an empty white gap below it.
// Because `srcDoc` iframes are same-origin with the host, we can read the rendered document
// height directly: measure on load, then a ResizeObserver catches the post-@font-face-swap
// reflow. `INITIAL_REPORT_HEIGHT` is only the pre-measure first-paint height — once measured,
// the height tracks the report exactly (no floor), so a short report (e.g. Demo Body Shop)
// leaves no empty gap below the footer, which is the primary defect this fixes.
const INITIAL_REPORT_HEIGHT = 480;

function AutoHeightReportFrame({ title, html }: { title: string; html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(INITIAL_REPORT_HEIGHT);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentWindow?.document;
    const h = doc?.documentElement?.scrollHeight ?? 0;
    // +8px buffer absorbs sub-pixel rounding so no hairline inner scrollbar appears. No min
    // floor on the measured value — the iframe hugs the real report height in both directions.
    if (h > 0) setHeight(h + 8);
  }, []);

  const handleLoad = useCallback(() => {
    measure();
    // Re-measure on the post-@font-face-swap reflow. Use the iframe's OWN ResizeObserver so it
    // observes the report document's growth (the host Window type doesn't expose it).
    const win = frameRef.current?.contentWindow as (Window & typeof globalThis) | null;
    const root = win?.document?.documentElement;
    if (!win || !root || typeof win.ResizeObserver !== "function") return;
    observerRef.current?.disconnect();
    const ro = new win.ResizeObserver(() => measure());
    ro.observe(root);
    observerRef.current = ro;
  }, [measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return (
    <iframe
      ref={frameRef}
      title={title}
      srcDoc={html}
      onLoad={handleLoad}
      style={{ height }}
      className="w-full rounded-lg border border-border bg-white"
    />
  );
}

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
        <p className="font-semibold text-warning">Costs a few cents to run</p>
        <p className="mt-1 text-muted-foreground">
          Each report uses a paid AI service (a few cents) and counts against the monthly budget
          cap. If the budget is reached, the report still shows the full competitor scoreboard —
          only the written summary is skipped.
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
          <p className="mt-1 text-muted-foreground">
            Run the competitor sync for this shop to populate it.
          </p>
        </div>
      )}

      {state.kind === "error" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-semibold">Couldn&rsquo;t run the report — please try again.</p>
          <p className="mt-1 text-destructive/80">{state.message}</p>
        </div>
      )}

      {state.kind === "rendered" && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Report</Badge>
            {selectedName}
          </p>
          <AutoHeightReportFrame
            title={`Competitor report — ${selectedName}`}
            html={state.html}
          />
        </div>
      )}
    </div>
  );
}
