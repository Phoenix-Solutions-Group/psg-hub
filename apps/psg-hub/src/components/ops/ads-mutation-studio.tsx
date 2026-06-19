"use client";

// v1.2 / PSG-26a — Ads Mutation Studio (build-local).
// Surfaces the mutation registry + a real before/after JSON diff computed from fixtures
// (lib/ads-mutations/preview.ts) WITHOUT the live Vercel Sandbox Python-worker — that
// execute path stays board-gated. Governance is visible: a target (customer-id /
// container-id) is required before a preview shows, and high-risk mutations show a
// superadmin-approval requirement. No live execution happens here (UI + state only).

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { diffJson, type DryRunPreview, type Json, type JsonDiffEntry } from "@/lib/ads-mutations/preview";
import { runMutation, type LiveMode, type LiveRunOutcome } from "@/lib/ads-mutations/client";
import type { AdsPlatform, MutationRiskLevel } from "@/lib/ads-mutations/types";

type Props = {
  previews: DryRunPreview[];
  sandboxEnabled: boolean;
};

const PLATFORM_LABELS: Record<AdsPlatform, string> = {
  google_ads: "Google Ads",
  gtm: "Google Tag Manager",
};

const RISK_VARIANT: Record<MutationRiskLevel, "success" | "warning" | "destructive"> = {
  low: "success",
  medium: "warning",
  high: "destructive",
};

const TARGET_LABEL: Record<string, string> = {
  google_ads_customer_id: "Customer ID",
  gtm_container_id: "Container ID",
};

function pretty(value: Json): string {
  return JSON.stringify(value, null, 2);
}

function DiffSummary({ changes }: { changes: JsonDiffEntry[] }) {
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">No changes — before and after are identical.</p>;
  }
  return (
    <ul className="space-y-1 font-mono text-xs">
      {changes.map((c, i) => (
        <li key={`${c.path}-${i}`} className="flex flex-wrap items-baseline gap-2">
          <span
            className={cn(
              "inline-block w-16 shrink-0 font-semibold uppercase tracking-wide",
              c.kind === "added" && "text-success",
              c.kind === "removed" && "text-destructive",
              c.kind === "changed" && "text-warning"
            )}
          >
            {c.kind}
          </span>
          <span className="text-foreground">{c.path}</span>
          {c.kind === "changed" && (
            <span className="text-muted-foreground">
              {JSON.stringify(c.before)} → {JSON.stringify(c.after)}
            </span>
          )}
          {c.kind === "added" && (
            <span className="text-muted-foreground">+ {JSON.stringify(c.after)}</span>
          )}
          {c.kind === "removed" && (
            <span className="text-muted-foreground">− {JSON.stringify(c.before)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Render the normalized outcome of a live dry-run/execute call. */
function LiveOutcome({ outcome }: { outcome: LiveRunOutcome }) {
  if (outcome.status === "gated") {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
        <p className="font-semibold text-warning">Live execution is gated</p>
        <p className="mt-1 text-muted-foreground">{outcome.message}</p>
      </div>
    );
  }
  if (outcome.status === "invalid") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="font-semibold text-destructive">Rejected by governance</p>
        <p className="mt-1 text-muted-foreground">{outcome.message}</p>
      </div>
    );
  }
  if (outcome.status === "rate_limited") {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
        <p className="font-semibold text-warning">Rate limited</p>
        <p className="mt-1 text-muted-foreground">{outcome.message}</p>
      </div>
    );
  }
  if (outcome.status === "error") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="font-semibold text-destructive">Run failed</p>
        <p className="mt-1 text-muted-foreground">{outcome.message}</p>
      </div>
    );
  }

  // ok — the live before/after diff returned by the Python worker.
  const { result } = outcome;
  const changes = diffJson(result.before as Json, result.after as Json);
  return (
    <div className="space-y-3 rounded-lg border border-success/40 bg-success/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-success">Live result</p>
        {result.jobId && <Badge variant="outline">job {result.jobId}</Badge>}
      </div>
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Changes ({changes.length})
        </h4>
        <DiffSummary changes={changes} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Before</h4>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
            {pretty(result.before as Json)}
          </pre>
        </div>
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">After</h4>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
            {pretty(result.after as Json)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function AdsMutationStudio({ previews, sandboxEnabled }: Props) {
  const [selectedKey, setSelectedKey] = useState<string>(previews[0]?.mutationKey ?? "");
  const selected = useMemo(
    () => previews.find((p) => p.mutationKey === selectedKey),
    [previews, selectedKey]
  );

  // Governance state (UI only): operator must confirm a target before the preview shows;
  // high-risk mutations require an approval ref before any (gated) execute is offered.
  const [targetRef, setTargetRef] = useState<string>(selected?.targetRef ?? "");
  const [approvalId, setApprovalId] = useState<string>("");

  // Live-run state: the outcome of the most recent dry-run/execute call to the API, plus
  // which call (if any) is in flight. Reset whenever the selected mutation changes.
  const [liveBusy, setLiveBusy] = useState<LiveMode | null>(null);
  const [outcome, setOutcome] = useState<LiveRunOutcome | null>(null);

  // Re-seed the target when the selection changes (prefill the fixture target).
  const [lastKey, setLastKey] = useState<string>(selectedKey);
  if (lastKey !== selectedKey) {
    setLastKey(selectedKey);
    setTargetRef(selected?.targetRef ?? "");
    setApprovalId("");
    setOutcome(null);
    setLiveBusy(null);
  }

  async function runLive(mode: LiveMode) {
    if (!selected) return;
    setLiveBusy(mode);
    setOutcome(null);
    const result = await runMutation(mode, {
      mutationKey: selected.mutationKey,
      targetRef: targetRef.trim(),
      // Params come from the registry fixture's representative request — the live diff is
      // computed against the real account state by the Python worker, not these values.
      params: selected.params,
      approvalId: approvalId.trim() || undefined,
    });
    setOutcome(result);
    setLiveBusy(null);
  }

  const grouped = useMemo(() => {
    const byPlatform = new Map<AdsPlatform, DryRunPreview[]>();
    for (const p of previews) {
      const list = byPlatform.get(p.def.platform) ?? [];
      list.push(p);
      byPlatform.set(p.def.platform, list);
    }
    return [...byPlatform.entries()];
  }, [previews]);

  const targetMissing = targetRef.trim() === "";
  const highRisk = selected?.governance.requiresApproval ?? false;
  const approvalMissing = highRisk && approvalId.trim() === "";

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      {/* Mutation picker */}
      <nav className="space-y-5" aria-label="Mutations">
        {grouped.map(([platform, list]) => (
          <div key={platform}>
            <h2 className="mb-2 font-heading text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {PLATFORM_LABELS[platform]}
            </h2>
            <ul className="space-y-1">
              {list.map((p) => (
                <li key={p.mutationKey}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(p.mutationKey)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      p.mutationKey === selectedKey
                        ? "border-ember bg-accent/50"
                        : "border-border hover:border-ember/60 hover:bg-accent/30"
                    )}
                  >
                    <span className="truncate">{p.def.label}</span>
                    <Badge variant={RISK_VARIANT[p.def.riskLevel]} className="shrink-0">
                      {p.def.riskLevel}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Detail + dry-run preview */}
      {selected && (
        <section className="min-w-0 space-y-5">
          <header className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-xl font-semibold tracking-tight">{selected.def.label}</h2>
              <Badge variant={RISK_VARIANT[selected.def.riskLevel]}>{selected.def.riskLevel} risk</Badge>
              <Badge variant="outline">{selected.def.pythonModule}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{selected.def.description}</p>
          </header>

          {/* Governance: target required */}
          <div className="space-y-2 rounded-lg border border-border p-4">
            <Label htmlFor="target-ref">
              {TARGET_LABEL[selected.governance.targetKind] ?? "Target"}{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="target-ref"
              value={targetRef}
              onChange={(e) => setTargetRef(e.target.value)}
              placeholder={
                selected.governance.targetKind === "gtm_container_id" ? "GTM-XXXXXXX" : "123-456-7890"
              }
              aria-invalid={targetMissing}
              className="max-w-xs font-mono"
            />
            {targetMissing && (
              <p className="text-xs text-destructive">
                Target required — refusing to preview &ldquo;{selected.def.key}&rdquo; without a{" "}
                {TARGET_LABEL[selected.governance.targetKind] ?? "target"}.
              </p>
            )}
          </div>

          {/* Governance: high-risk approval */}
          {highRisk && (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">Superadmin approval required</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                This is a high-risk mutation (direct spend / bidding / measurement or live-publishing
                impact). A superadmin/board approval ref is required before it can be executed.
              </p>
              <Label htmlFor="approval-id">Approval ref</Label>
              <Input
                id="approval-id"
                value={approvalId}
                onChange={(e) => setApprovalId(e.target.value)}
                placeholder="approval-id"
                aria-invalid={approvalMissing}
                className="max-w-xs font-mono"
              />
            </div>
          )}

          {/* Live run — calls the real /api/ads-mutations routes. Fail-closed: dry-run is
              always offered (the route returns a clean 503 `gated` when the Sandbox is off);
              execute is only enabled once the Sandbox is on AND governance passes. */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Live run
              </h3>
              {!sandboxEnabled && <Badge variant="warning">Sandbox off · execution gated</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={targetMissing || liveBusy !== null}
                onClick={() => runLive("dry-run")}
              >
                {liveBusy === "dry-run" ? "Running dry-run…" : "Run live dry-run"}
              </Button>
              <Button
                type="button"
                variant="accent"
                size="sm"
                disabled={!sandboxEnabled || targetMissing || approvalMissing || liveBusy !== null}
                onClick={() => runLive("execute")}
              >
                {liveBusy === "execute" ? "Executing…" : "Execute"}
              </Button>
            </div>
            {!sandboxEnabled && (
              <p className="text-xs text-muted-foreground">
                Execute is disabled until the operator enables the Vercel Sandbox (PSG-26 gate).
                Dry-run is still callable and returns the gated state cleanly.
              </p>
            )}
            {sandboxEnabled && approvalMissing && (
              <p className="text-xs text-destructive">
                High-risk mutation — enter an approval ref above before executing.
              </p>
            )}
            {outcome && <LiveOutcome outcome={outcome} />}
          </div>

          {/* Expected diff — computed locally from the registry fixture (no Sandbox). This
              is the reference the live dry-run should match once the bridge is enabled. */}
          {targetMissing ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Enter a {TARGET_LABEL[selected.governance.targetKind] ?? "target"} to preview the expected diff.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Expected diff
                </h3>
                <Badge variant="secondary">fixture data · no live execution</Badge>
              </div>

              <div className="rounded-lg border border-border p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Changes ({selected.changes.length})
                </h4>
                <DiffSummary changes={selected.changes} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="min-w-0">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Before
                  </h4>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
                    {pretty(selected.diff.before as Json)}
                  </pre>
                </div>
                <div className="min-w-0">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    After
                  </h4>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
                    {pretty(selected.diff.after as Json)}
                  </pre>
                </div>
              </div>

              <div className="min-w-0">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Requested input (params)
                </h4>
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
                  {pretty(selected.diff.requestedChanges as Json)}
                </pre>
              </div>

              <p className="text-xs text-muted-foreground">
                {sandboxEnabled
                  ? "Vercel Sandbox is enabled — live dry-run/execute is wired through the Python bridge."
                  : "Live dry-run/execute runs the shipped Python via Vercel Sandbox, which is board-gated (PSG-26). Until then this preview is computed locally from fixtures."}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
