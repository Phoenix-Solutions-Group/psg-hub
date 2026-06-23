"use client";

// Wave 1A / PSG-258 — Sitemap & Content Architecture ops surface (client).
// Mirrors the Competitor Intel studio: a shop picker + "Run" that POSTs the superadmin route
// (POST /api/ops/sitemap { shopId }) and surfaces the four outcomes the gated pipeline can
// produce. On the two human checkpoints the run STOPS and queues the gate for sign-off; once
// approved, re-running advances. When the run completes, the persisted client deliverable is
// fetched (GET …&format=html) and rendered inline in an isolated, auto-height iframe.
//
//   complete           — package persisted + audited; the branded deliverable renders below
//   awaiting_approval  — a checkpoint (clusters / package) is queued for superadmin sign-off
//   changes_requested  — a human asked for changes; the run handed the partial back
//   error              — 400/401/403/5xx, a plain-language line over the route's { error }

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type SitemapShopOption = { id: string; name: string };

const INITIAL_FRAME_HEIGHT = 480;

function AutoHeightFrame({ title, html }: { title: string; html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(INITIAL_FRAME_HEIGHT);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentWindow?.document;
    const h = doc?.documentElement?.scrollHeight ?? 0;
    if (h > 0) setHeight(h + 8);
  }, []);

  const handleLoad = useCallback(() => {
    measure();
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

type CheckpointSummary = Record<string, unknown>;

type RunState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "complete"; html: string }
  | { kind: "awaiting"; phase: string; summary: CheckpointSummary }
  | { kind: "changes"; phase: string; notes: string | null }
  | { kind: "error"; message: string };

const PHASE_LABEL: Record<string, string> = {
  clusters_page_types: "Clusters & page types",
  package_handoff: "Final package hand-off",
};

export function SitemapStudio({ shops }: { shops: SitemapShopOption[] }) {
  const [shopId, setShopId] = useState<string>(shops[0]?.id ?? "");
  const [state, setState] = useState<RunState>({ kind: "idle" });

  const run = useCallback(async () => {
    if (!shopId) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/ops/sitemap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shopId }),
      });
      let body: Record<string, unknown> | null = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (res.ok && body?.status === "complete") {
        // Fetch the persisted deliverable for inline preview.
        const html = await fetch(
          `/api/ops/sitemap?shopId=${encodeURIComponent(shopId)}&format=html`,
        ).then((r) => (r.ok ? r.text() : ""));
        setState({ kind: "complete", html });
        return;
      }
      if (res.status === 202 && body?.status === "awaiting_approval") {
        setState({
          kind: "awaiting",
          phase: String(body.phase ?? ""),
          summary: (body.summary as CheckpointSummary) ?? {},
        });
        return;
      }
      if (res.status === 409 && body?.status === "changes_requested") {
        setState({
          kind: "changes",
          phase: String(body.phase ?? ""),
          notes: (body.notes as string | null) ?? null,
        });
        return;
      }
      setState({
        kind: "error",
        message: (body?.error as string) ?? `Run failed (HTTP ${res.status}).`,
      });
    } catch {
      setState({ kind: "error", message: "Network error running the sitemap pipeline." });
    }
  }, [shopId]);

  if (shops.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No shops are available yet.
      </div>
    );
  }

  const selectedName = shops.find((s) => s.id === shopId)?.name ?? "";

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
        <p className="font-semibold text-warning">Two human sign-offs required</p>
        <p className="mt-1 text-muted-foreground">
          The pipeline pauses twice — once to approve the keyword clusters and page types, then
          to approve the finished package before client hand-off. Each pause queues an item for
          sign-off; approve it, then run again to continue. Keyword enrichment uses a paid AI
          service (a few cents) and counts against the monthly budget cap.
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
          <Label htmlFor="sitemap-shop">Shop</Label>
          <select
            id="sitemap-shop"
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
          {state.kind === "loading" ? "Running…" : "Run pipeline"}
        </Button>
      </form>

      {state.kind === "awaiting" && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <p className="font-semibold">
            Checkpoint queued — {PHASE_LABEL[state.phase] ?? state.phase}
          </p>
          <p className="mt-1 text-muted-foreground">
            This gate is waiting for a superadmin to approve it. Once approved, run the pipeline
            again to advance to the next stage.
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-xs text-muted-foreground">
            {JSON.stringify(state.summary, null, 2)}
          </pre>
        </div>
      )}

      {state.kind === "changes" && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          <p className="font-semibold text-warning">
            Changes requested — {PHASE_LABEL[state.phase] ?? state.phase}
          </p>
          {state.notes && <p className="mt-1 text-muted-foreground">{state.notes}</p>}
        </div>
      )}

      {state.kind === "error" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-semibold">Couldn&rsquo;t run the pipeline — please try again.</p>
          <p className="mt-1 text-destructive/80">{state.message}</p>
        </div>
      )}

      {state.kind === "complete" && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Deliverable</Badge>
            {selectedName}
          </p>
          {state.html ? (
            <AutoHeightFrame title={`Sitemap deliverable — ${selectedName}`} html={state.html} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Package saved. Preview unavailable — reload to view.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
