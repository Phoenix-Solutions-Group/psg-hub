"use client";

// Wave 1A / PSG-258 + PSG-376 — Sitemap & Content Architecture ops surface (client).
//
// A shop picker + "Run" that POSTs the superadmin route (POST /api/ops/sitemap { shopId })
// and drives the gated pipeline to a client-ready deliverable ENTIRELY in the browser — no
// SQL. The pipeline pauses at two human gates (clusters_page_types → package_handoff); at each
// one the operator makes a trust decision IN-UI and the studio auto-advances:
//
//   • Approve & continue → POST /api/ops/sitemap/checkpoints {decision:"approved"} then auto
//     re-runs the pipeline so it moves to the next gate (clusters → package → complete).
//   • Request changes    → records a note on the checkpoint and hands the partial back.
//
// Built to Lee's UX direction (PSG-377): a 3-step stepper for "where am I / what's left",
// human-readable KPI chips + a proposed-pages table at each gate (NEVER raw JSON), and a
// framed deliverable on complete. The four run outcomes map to designed stage cards below.

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type SitemapShopOption = { id: string; name: string };

const INITIAL_FRAME_HEIGHT = 480;
/** Cap visible page rows at gate 1; the rest collapse into a "+N more" line. */
const MAX_VISIBLE_ROWS = 12;

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
  | { kind: "loading"; phase?: string }
  | { kind: "complete"; html: string }
  | { kind: "awaiting"; phase: string; summary: CheckpointSummary; contentHash: string }
  | { kind: "changes"; phase: string; notes: string | null }
  | { kind: "error"; message: string; phase?: string };

/* -------------------------------------------------------------------------- */
/* Pure helpers (unit-tested — no React)                                       */
/* -------------------------------------------------------------------------- */

const PHASE_LABEL: Record<string, string> = {
  clusters_page_types: "Clusters & page types",
  package_handoff: "Final package",
};

/** Friendly, Title-Case label for a raw cluster page-type enum (PSG-259 CR-2: never raw). */
const PAGE_TYPE_LABEL: Record<string, string> = {
  service: "Service",
  local: "Local (city)",
  transactional: "Convert",
  informational: "Inform",
  home: "Home",
};

export function pageTypeLabel(raw: unknown): string {
  const key = String(raw ?? "").trim();
  if (!key) return "—";
  if (PAGE_TYPE_LABEL[key]) return PAGE_TYPE_LABEL[key];
  return key
    .split(/[\s_-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Tint the page-type pill by commercial-intent hierarchy so the Type column reads as a
 * hierarchy instead of a wall of identical `outline` pills (Lee's PSG-381 CR-1).
 *
 * We deliberately map to the *existing* semantic Badge tokens — not a new hex palette — so the
 * studio stays "one system" with the rest of /ops (the very thing the §6 sign-off praised). The
 * deliverable's literal `.pill` palette colors *disposition* (new/keep/improve), which the gate-1
 * summary doesn't carry, so mirroring it 1:1 would be semantically wrong here. The ordering echoes
 * the seo-audit opportunity ranking (transactional closest-to-booked → informational lowest):
 *   • Convert  (transactional) — solid `default`  → flagship intent, pops
 *   • Service / Home           — `secondary`      → core, neutral fill
 *   • Local (city)             — `secondary`
 *   • Inform   (informational) — quiet `outline`  → lowest intent, recedes
 * Unknown types fall back to `outline`.
 */
const PAGE_TYPE_VARIANT: Record<string, React.ComponentProps<typeof Badge>["variant"]> = {
  transactional: "default",
  service: "secondary",
  home: "secondary",
  local: "secondary",
  informational: "outline",
};

export function pageTypeVariant(raw: unknown): React.ComponentProps<typeof Badge>["variant"] {
  const key = String(raw ?? "").trim();
  return PAGE_TYPE_VARIANT[key] ?? "outline";
}

/** The 3 fixed stepper nodes, mapping the engine's two gate phases + the terminal complete. */
export type StepKey = "clusters_page_types" | "package_handoff" | "complete";
export type StepStatus =
  | "not_started"
  | "running"
  | "in_review"
  | "changes_requested"
  | "done";
export interface StepView {
  key: StepKey;
  label: string;
  status: StepStatus;
}

const STEP_DEFS: { key: StepKey; label: string }[] = [
  { key: "clusters_page_types", label: "Clusters & page types" },
  { key: "package_handoff", label: "Final package" },
  { key: "complete", label: "Complete" },
];

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  not_started: "Not started",
  running: "Running",
  in_review: "In review",
  changes_requested: "Changes requested",
  done: "Approved",
};

/**
 * Derive the 3-node stepper from the current run state (pure). Nodes before the active phase
 * are `done` (they were approved to get here); the active phase reflects the live state; later
 * nodes are `not_started`. `complete` greens the whole spine.
 */
export function deriveSteps(state: { kind: string; phase?: string }): StepView[] {
  const indexOf = (k: string) => STEP_DEFS.findIndex((s) => s.key === k);
  return STEP_DEFS.map((def, i) => {
    let status: StepStatus = "not_started";
    if (state.kind === "complete") {
      status = "done";
    } else if (state.kind === "awaiting") {
      const a = indexOf(state.phase ?? "");
      status = i < a ? "done" : i === a ? "in_review" : "not_started";
    } else if (state.kind === "changes") {
      const c = indexOf(state.phase ?? "");
      status = i < c ? "done" : i === c ? "changes_requested" : "not_started";
    } else if (state.kind === "loading") {
      const l = state.phase ? indexOf(state.phase) : 0;
      status = i < l ? "done" : i === l ? "running" : "not_started";
    } else if (state.kind === "error") {
      const e = state.phase ? indexOf(state.phase) : -1;
      status = e >= 0 && i < e ? "done" : e === i ? "in_review" : "not_started";
    }
    return { key: def.key, label: def.label, status };
  });
}

/** Map a POST /api/ops/sitemap response to the next RunState (pure). `complete` is signalled
 * separately because the caller must then fetch the rendered HTML; every other outcome maps
 * directly. Mirrors competitor-intel's runStateFromResponse. */
export type RunResponseResult =
  | { kind: "complete" }
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
    return {
      kind: "changes",
      phase: String(body.phase ?? ""),
      notes: (body.notes as string | null) ?? null,
    };
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

/** Gate-1 (clusters & page types) summary → human-readable view (pure, degrades quietly). */
export interface Gate1Row {
  label: string;
  pageType: string;
  /** Raw page-type enum kept alongside the friendly label so the pill can be tinted by intent. */
  pageTypeKey: string;
  keywords: number;
}
export interface Gate1View {
  clusterCount: number;
  proposedPages: number;
  inventoryCount: number;
  rows: Gate1Row[];
}
export function readGate1Summary(summary: CheckpointSummary): Gate1View {
  const rawClusters = Array.isArray(summary.clusters) ? summary.clusters : [];
  const rows: Gate1Row[] = rawClusters.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return {
      label: typeof o.label === "string" && o.label.trim() ? o.label : "—",
      pageType: pageTypeLabel(o.pageType),
      pageTypeKey: String(o.pageType ?? "").trim(),
      keywords: typeof o.keywords === "number" ? o.keywords : Number(o.keywords) || 0,
    };
  });
  return {
    clusterCount: Number(summary.clusterCount) || 0,
    proposedPages: rows.length,
    inventoryCount: Number(summary.inventoryCount) || 0,
    rows,
  };
}

/** Gate-2 (final package) summary → human-readable view (pure, degrades quietly). */
export interface Gate2View {
  businessName: string;
  pageCount: number;
  calendarEntries: number;
  validationOk: boolean;
}
export function readGate2Summary(summary: CheckpointSummary): Gate2View {
  return {
    businessName:
      typeof summary.businessName === "string" && summary.businessName.trim()
        ? summary.businessName
        : "—",
    pageCount: Number(summary.pageCount) || 0,
    calendarEntries: Number(summary.calendarEntries) || 0,
    validationOk: summary.validationOk === true,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentational pieces                                                       */
/* -------------------------------------------------------------------------- */

const STEP_CHIP_VARIANT: Record<StepStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  not_started: "outline",
  running: "secondary",
  in_review: "warning",
  changes_requested: "warning",
  done: "success",
};

function Stepper({ steps }: { steps: StepView[] }) {
  return (
    <ol className="flex flex-wrap items-stretch gap-2 rounded-lg border border-border bg-card p-3">
      {steps.map((step, i) => (
        <li
          key={step.key}
          className="flex min-w-[10rem] flex-1 flex-col gap-1 rounded-md border border-border/60 bg-background px-3 py-2"
        >
          <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
          <span className="text-sm font-semibold leading-tight">{step.label}</span>
          <Badge variant={STEP_CHIP_VARIANT[step.status]} className="mt-0.5 w-fit">
            {STEP_STATUS_LABEL[step.status]}
          </Badge>
        </li>
      ))}
    </ol>
  );
}

function KpiChip({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex min-w-[7rem] flex-col rounded-lg border border-border bg-background px-4 py-3">
      <span className="text-2xl font-semibold leading-none text-primary">{value}</span>
      <span className="mt-1 text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Studio                                                                      */
/* -------------------------------------------------------------------------- */

export function SitemapStudio({ shops }: { shops: SitemapShopOption[] }) {
  const [shopId, setShopId] = useState<string>(shops[0]?.id ?? "");
  const [state, setState] = useState<RunState>({ kind: "idle" });
  // In-UI checkpoint decision (PSG-376): which decision is in flight (drives button spinners),
  // any decision-specific error, and the note attached to a "request changes".
  const [deciding, setDeciding] = useState<null | "approved" | "changes_requested">(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [changeNotes, setChangeNotes] = useState("");

  const run = useCallback(
    async (loadingPhase?: string) => {
      if (!shopId) return;
      setDecideError(null);
      setState({ kind: "loading", phase: loadingPhase });
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
          const html = await fetch(
            `/api/ops/sitemap?shopId=${encodeURIComponent(shopId)}&format=html`,
          ).then((r) => (r.ok ? r.text() : ""));
          setState({ kind: "complete", html });
          return;
        }
        if (result.kind === "awaiting") setChangeNotes("");
        setState(result);
      } catch {
        setState({
          kind: "error",
          message: "Network error running the sitemap pipeline.",
          phase: loadingPhase,
        });
      }
    },
    [shopId],
  );

  // Decide the queued checkpoint in-UI, then auto-advance: an APPROVE re-runs the pipeline so
  // it moves to the next gate (clusters → package → complete) without a manual second "Run";
  // a REQUEST-CHANGES records the note and hands the partial back. The contentHash anchors the
  // decision to the queued plan (stale-guard server-side).
  const decide = useCallback(
    async (decision: "approved" | "changes_requested") => {
      if (state.kind !== "awaiting" || !shopId) return;
      if (decision === "changes_requested" && !changeNotes.trim()) {
        setDecideError("Please describe what should change before requesting changes.");
        return;
      }
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
          // Auto-advance: re-run toward the NEXT node (package gate, or complete).
          const next = state.phase === "clusters_page_types" ? "package_handoff" : "complete";
          await run(next);
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
  const steps = deriveSteps(state);
  const isLoading = state.kind === "loading";

  return (
    <div className="space-y-5">
      <p className="rounded-md border border-warning/40 bg-warning/5 px-4 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-warning">Two human sign-offs · paid enrichment.</span>{" "}
        The pipeline pauses at each gate for your approval, in-browser — no SQL. Keyword
        enrichment uses a metered AI service (a few cents) against the monthly budget cap.
      </p>

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
            disabled={isLoading}
            className="h-9 w-72 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.id}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={isLoading || !shopId}>
          {isLoading ? "Running…" : state.kind === "idle" ? "Run pipeline" : "Start over"}
        </Button>
      </form>

      <Stepper steps={steps} />

      {state.kind === "idle" && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm">
          <p className="font-semibold">Ready to build a content architecture.</p>
          <p className="mt-1 text-muted-foreground">
            The pipeline builds a keyword universe, audits the current site, clusters keywords
            into pages, drafts the site architecture and content calendar, and produces a branded
            client deliverable. You&rsquo;ll approve two gates along the way. Pick a shop and run.
          </p>
        </div>
      )}

      {state.kind === "loading" && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm">
          <p className="font-semibold">
            {state.phase === "package_handoff"
              ? "Assembling the full site plan & calendar…"
              : state.phase === "complete"
                ? "Generating the client deliverable…"
                : "Building keyword universe & clustering pages…"}
          </p>
          <p className="mt-1 text-muted-foreground">
            This can take a moment and uses metered enrichment. Hang tight — don&rsquo;t re-run.
          </p>
        </div>
      )}

      {state.kind === "awaiting" && state.phase === "clusters_page_types" && (
        <Gate1Card
          view={readGate1Summary(state.summary)}
          deciding={deciding}
          decideError={decideError}
          changeNotes={changeNotes}
          onChangeNotes={setChangeNotes}
          onDecide={decide}
        />
      )}

      {state.kind === "awaiting" && state.phase === "package_handoff" && (
        <Gate2Card
          view={readGate2Summary(state.summary)}
          deciding={deciding}
          decideError={decideError}
          changeNotes={changeNotes}
          onChangeNotes={setChangeNotes}
          onDecide={decide}
        />
      )}

      {state.kind === "changes" && (
        <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          <p className="font-semibold text-warning">
            Changes requested — {PHASE_LABEL[state.phase] ?? state.phase}
          </p>
          <p className="text-muted-foreground">
            The run stopped on purpose. Your note is recorded on the checkpoint and shown if the
            plan is rebuilt.
          </p>
          {state.notes && (
            <blockquote className="rounded border-l-2 border-warning/60 bg-background px-3 py-2 text-muted-foreground">
              You asked: {state.notes}
            </blockquote>
          )}
          <Button type="button" variant="outline" onClick={() => run()}>
            Re-run pipeline
          </Button>
        </div>
      )}

      {state.kind === "error" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <p className="font-semibold">Couldn&rsquo;t run the pipeline — please try again.</p>
          <p className="mt-1 text-destructive/80">{state.message}</p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => run(state.phase)}>
            Retry
          </Button>
        </div>
      )}

      {state.kind === "complete" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/5 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <Badge variant="success">Deliverable ready</Badge>
              {selectedName}
            </p>
            <a
              href={`/api/ops/sitemap?shopId=${encodeURIComponent(shopId)}&format=html`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Open in new tab ↗
            </a>
          </div>
          {state.html ? (
            <AutoHeightFrame title={`Sitemap deliverable — ${selectedName}`} html={state.html} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Package saved. Preview unavailable — open in a new tab to view.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Gate stage cards                                                            */
/* -------------------------------------------------------------------------- */

type DecideProps = {
  deciding: null | "approved" | "changes_requested";
  decideError: string | null;
  changeNotes: string;
  onChangeNotes: (v: string) => void;
  onDecide: (decision: "approved" | "changes_requested") => void;
};

function DecisionControls({
  approveLabel,
  deciding,
  decideError,
  changeNotes,
  onChangeNotes,
  onDecide,
}: DecideProps & { approveLabel: string }) {
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="sitemap-change-notes" className="text-xs">
          What should change? (recorded on the checkpoint and shown if the plan is rebuilt)
        </Label>
        <textarea
          id="sitemap-change-notes"
          aria-label="Decision notes"
          value={changeNotes}
          onChange={(e) => onChangeNotes(e.target.value)}
          rows={2}
          disabled={deciding !== null}
          className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          placeholder="Optional on approve · required to request changes."
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => onDecide("approved")} disabled={deciding !== null}>
          {deciding === "approved" ? "Approving…" : approveLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onDecide("changes_requested")}
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
  );
}

function Gate1Card({ view, ...decide }: { view: Gate1View } & DecideProps) {
  const visible = view.rows.slice(0, MAX_VISIBLE_ROWS);
  const hidden = view.rows.length - visible.length;
  return (
    <div className="space-y-4 rounded-lg border border-warning/40 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">Step 1 · Clusters &amp; page types</p>
        <Badge variant="warning">In review</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        We grouped the keyword research into the pages this shop should have. Review the proposed
        pages, then approve to build the full site plan.
      </p>

      <div className="flex flex-wrap gap-3">
        <KpiChip value={view.clusterCount} label="keyword clusters" />
        <KpiChip value={view.proposedPages} label="proposed pages" />
        <KpiChip value={view.inventoryCount} label="existing URLs" />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Proposed pages</p>
        {view.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No proposed pages in this plan.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Keywords</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r, i) => (
                  <TableRow key={`${r.label}-${i}`}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell>
                      <Badge variant={pageTypeVariant(r.pageTypeKey)}>{r.pageType}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.keywords}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {hidden > 0 && (
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                +{hidden} more page{hidden === 1 ? "" : "s"}
              </p>
            )}
          </div>
        )}
      </div>

      <p className="rounded border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        ⚠ Deterministic baseline (no live keyword seat yet) — counts reflect the zero-cost source.
      </p>

      <DecisionControls approveLabel="Approve & continue" {...decide} />
    </div>
  );
}

function Gate2Card({ view, ...decide }: { view: Gate2View } & DecideProps) {
  return (
    <div className="space-y-4 rounded-lg border border-warning/40 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">Step 2 · Final package</p>
        <Badge variant="warning">In review</Badge>
      </div>
      {/* Standalone "which shop am I signing off" anchor (Lee's PSG-381 CR-2) — surfaced as a
          labeled trust-check line rather than buried in prose. */}
      <div className="rounded-md border border-border bg-background px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Signing off for</span>
        <p className="text-sm font-semibold leading-tight">{view.businessName}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        The full site plan is ready. Review the shape, then approve to generate the client
        deliverable.
      </p>

      <div className="flex flex-wrap gap-3">
        <KpiChip value={view.pageCount} label="pages" />
        <KpiChip value={view.calendarEntries} label="calendar entries" />
        <KpiChip
          value={view.validationOk ? "✓" : "⚠"}
          label={view.validationOk ? "validation passed" : "validation needs review"}
        />
      </div>

      {!view.validationOk && (
        <p className="rounded border border-warning/50 bg-warning/5 px-3 py-2 text-xs text-warning">
          Validation flagged issues — consider Request changes before generating the deliverable.
        </p>
      )}

      <DecisionControls approveLabel="Approve & generate deliverable" {...decide} />
    </div>
  );
}
