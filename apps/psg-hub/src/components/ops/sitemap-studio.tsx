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
  | { kind: "awaiting"; phase: string; summary: CheckpointSummary; contentHash: string }
  | { kind: "changes"; phase: string; notes: string | null }
  | { kind: "error"; message: string };

const PHASE_LABEL: Record<string, string> = {
  clusters_page_types: "Clusters & page types",
  package_handoff: "Final package hand-off",
};

/**
 * Map a POST /api/ops/sitemap response to the next RunState (pure, unit-tested). `complete`
 * is signalled separately because the caller must then fetch the rendered HTML; every other
 * outcome maps directly. Mirrors competitor-intel's runStateFromResponse.
 */
export type RunResponseResult =
  | { kind: "complete" } // caller fetches &format=html, then sets { kind: "complete", html }
  | { kind: "awaiting"; phase: string; summary: CheckpointSummary; contentHash: string }
  | { kind: "changes"; phase: string; notes: string | null }
  | { kind: "error"; message: string };

export function parseRunResponse(
  status: number,
  ok: boolean,
  body: Record<string, unknown> | null,
): RunResponseResult {
  if (ok && body?.status === "complete") return { kind: "complete" };
  if (status === 202 && body?.status === "awaiting_approval") {
    return {
      kind: "awaiting",
      phase: String(body.phase ?? ""),
      summary: (body.summary as CheckpointSummary) ?? {},
      contentHash: String(body.contentHash ?? ""),
    };
  }
  if (status === 409 && body?.status === "changes_requested") {
    return { kind: "changes", phase: String(body.phase ?? ""), notes: (body.notes as string | null) ?? null };
  }
  return { kind: "error", message: (body?.error as string) ?? `Run failed (HTTP ${status}).` };
}

/** Request body for POST /api/ops/sitemap/checkpoints (pure). Notes only ride a change request. */
export function buildDecisionPayload(opts: {
  shopId: string;
  phase: string;
  contentHash: string;
  decision: "approved" | "changes_requested";
  changeNotes: string;
}): { shopId: string; phase: string; contentHash: string; decision: string; notes: string | null } {
  return {
    shopId: opts.shopId,
    phase: opts.phase,
    contentHash: opts.contentHash,
    decision: opts.decision,
    notes: opts.decision === "changes_requested" ? opts.changeNotes.trim() || null : null,
  };
}

/** Plain-language failure line for a non-OK decision response (pure). */
export function decisionErrorMessage(status: number, body: Record<string, unknown> | null): string {
  return (
    (body?.message as string) ??
    (body?.error as string) ??
    `Couldn’t record the decision (HTTP ${status}).`
  );
}

export function SitemapStudio({ shops }: { shops: SitemapShopOption[] }) {
  const [shopId, setShopId] = useState<string>(shops[0]?.id ?? "");
  const [state, setState] = useState<RunState>({ kind: "idle" });
  // In-UI checkpoint decision (PSG-376): which decision is in flight (drives button spinners),
  // any decision-specific error, and the optional note attached to a "request changes".
  const [deciding, setDeciding] = useState<null | "approved" | "changes_requested">(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [changeNotes, setChangeNotes] = useState("");

  const run = useCallback(async () => {
    if (!shopId) return;
    setDecideError(null);
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

      const result = parseRunResponse(res.status, res.ok, body);
      if (result.kind === "complete") {
        // Fetch the persisted deliverable for inline preview.
        const html = await fetch(
          `/api/ops/sitemap?shopId=${encodeURIComponent(shopId)}&format=html`,
        ).then((r) => (r.ok ? r.text() : ""));
        setState({ kind: "complete", html });
        return;
      }
      if (result.kind === "awaiting") setChangeNotes("");
      setState(result);
    } catch {
      setState({ kind: "error", message: "Network error running the sitemap pipeline." });
    }
  }, [shopId]);

  // Decide the queued checkpoint in-UI, then auto-advance: an APPROVE re-runs the pipeline so
  // it moves to the next gate (clusters → package → complete) without a manual second "Run";
  // a REQUEST-CHANGES records the note and hands the partial back (re-running would just stop
  // at the same gate again). The contentHash anchors the decision to the queued plan.
  const decide = useCallback(
    async (decision: "approved" | "changes_requested") => {
      if (state.kind !== "awaiting" || !shopId) return;
      setDeciding(decision);
      setDecideError(null);
      const payload = buildDecisionPayload({
        shopId,
        phase: state.phase,
        contentHash: state.contentHash,
        decision,
        changeNotes,
      });
      try {
        const res = await fetch("/api/ops/sitemap/checkpoints", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        let body: Record<string, unknown> | null = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        if (!res.ok) {
          setDecideError(decisionErrorMessage(res.status, body));
          return;
        }
        if (decision === "approved") {
          await run(); // auto-advance to the next gate (or complete)
        } else {
          setState({ kind: "changes", phase: state.phase, notes: payload.notes });
        }
      } catch {
        setDecideError("Network error recording the decision.");
      } finally {
        setDeciding(null);
      }
    },
    [shopId, state, changeNotes, run],
  );

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
            Review the plan below, then approve to advance — the pipeline re-runs automatically
            and moves to the next stage. Request changes to hand the partial back with a note.
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-xs text-muted-foreground">
            {JSON.stringify(state.summary, null, 2)}
          </pre>

          <div className="mt-3 space-y-2">
            <div>
              <Label htmlFor="sitemap-change-notes" className="text-xs">
                Notes (required context for a change request)
              </Label>
              <textarea
                id="sitemap-change-notes"
                aria-label="Decision notes"
                value={changeNotes}
                onChange={(e) => setChangeNotes(e.target.value)}
                rows={2}
                disabled={deciding !== null}
                className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="Optional on approve; describe what to change when requesting changes."
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => decide("approved")} disabled={deciding !== null}>
                {deciding === "approved" ? "Approving…" : "Approve"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => decide("changes_requested")}
                disabled={deciding !== null}
              >
                {deciding === "changes_requested" ? "Submitting…" : "Request changes"}
              </Button>
            </div>
            {decideError && (
              <p className="text-sm text-destructive" role="alert">
                {decideError}
              </p>
            )}
          </div>
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
