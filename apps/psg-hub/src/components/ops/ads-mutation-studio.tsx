"use client";

// v1.2 / PSG-26a — Ads Mutation Studio (build-local).
// Surfaces the mutation registry + a real before/after JSON diff computed from fixtures
// (lib/ads-mutations/preview.ts) WITHOUT the live Vercel Sandbox Python-worker — that
// execute path stays board-gated. Governance is visible: a target (customer-id /
// container-id) is required before a preview shows, and high-risk mutations show a
// superadmin-approval requirement. No live execution happens here (UI + state only).

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DryRunPreview, Json, JsonDiffEntry } from "@/lib/ads-mutations/preview";
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

  // Re-seed the target when the selection changes (prefill the fixture target).
  const [lastKey, setLastKey] = useState<string>(selectedKey);
  if (lastKey !== selectedKey) {
    setLastKey(selectedKey);
    setTargetRef(selected?.targetRef ?? "");
    setApprovalId("");
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

          {/* Dry-run preview */}
          {targetMissing ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Enter a {TARGET_LABEL[selected.governance.targetKind] ?? "target"} to preview the dry-run diff.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Dry-run preview
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
