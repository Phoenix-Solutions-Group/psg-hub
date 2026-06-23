"use client";

// CCC Secure Share — per-shop "Connect BSM" card (spec §4 A / A′ / A″, surface A).
// PSG-266 (child 1/3 of PSG-256). Spec: docs/ops/ccc/phase3-onboarding-consent-ux.md.
//
// Presentational + state-driven, FIXTURE-DRIVEN — no live `ccc_accounts` wiring (that's child 3).
// It renders all five states from the §2 state machine via the pure CONNECTION_PRESENTATION
// mapping, surfaces the "Get connection steps" list (A′) and the "Last update…" line, and embeds
// the shared data-scope panel (C). The mutating CTAs (cancel / disconnect / reconnect / request
// again) are optional callbacks so child 3 can bind them to server actions without touching the
// presentation. Mirrors competitor-intel.tsx / access-audit-viewer.tsx conventions.

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CccDataScopePanel } from "@/components/ops/ccc-data-scope-panel";
import {
  CCC_CONNECTION_STEPS,
  CONNECTION_PRESENTATION,
  CTA_LABELS,
  errorHint,
  formatLastEvent,
  type CccConnectionView,
  type CtaKey,
} from "@/lib/ccc/connection-state";

// Optional action callbacks — child 3 binds these to server actions. The card stays fully
// usable without them (presentational/fixture mode): step-list + scope toggles are local.
export type CccConnectionActions = {
  onGetSteps?: () => void;
  onCancelRequest?: () => void;
  onDisconnect?: () => void;
  onReconnect?: () => void;
  onRequestAgain?: () => void;
};

// CTAs that (re)open the connection step list — spec §3.3 reconnect & §3.2 request-again both
// "re-run / return to the step list".
const OPENS_STEPS: ReadonlySet<CtaKey> = new Set<CtaKey>([
  "get_steps",
  "reconnect",
  "request_again",
]);

function ctaVariant(cta: CtaKey, index: number): "default" | "outline" | "ghost" {
  if (cta === "disconnect") return "ghost";
  if (cta === "view_scope" || cta === "cancel_request") return "outline";
  return index === 0 ? "default" : "outline";
}

export function CccConnectionCard({
  view,
  actions = {},
  now = new Date(),
}: {
  view: CccConnectionView;
  actions?: CccConnectionActions;
  /** Injected for deterministic relative-time rendering in tests. */
  now?: Date;
}) {
  const pres = CONNECTION_PRESENTATION[view.status];
  const [stepsOpen, setStepsOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const lastEvent =
    view.status === "connected" ? formatLastEvent(view, now) : null;

  function handleCta(cta: CtaKey) {
    if (OPENS_STEPS.has(cta)) setStepsOpen(true);
    switch (cta) {
      case "get_steps":
        actions.onGetSteps?.();
        break;
      case "view_scope":
        setScopeOpen((v) => !v);
        break;
      case "cancel_request":
        actions.onCancelRequest?.();
        break;
      case "disconnect":
        setConfirmingDisconnect(true);
        break;
      case "reconnect":
        actions.onReconnect?.();
        break;
      case "request_again":
        actions.onRequestAgain?.();
        break;
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      {/* Header: title + status badge (spec §4 A/A″) */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading text-base font-medium text-foreground">
            <span aria-hidden className="mr-1.5 text-muted-foreground">
              {pres.glyph}
            </span>
            CCC Secure Share
          </p>
          <p className="mt-0.5 text-muted-foreground">{pres.summary}</p>
        </div>
        <Badge variant={pres.badgeVariant}>{pres.label}</Badge>
      </div>

      {/* State-specific detail lines */}
      <div className="mt-3 space-y-1">
        {view.status === "pending_review" && view.enabledAt && (
          <p className="text-muted-foreground">
            Enabled in CCC on {new Date(view.enabledAt).toLocaleString()}.
          </p>
        )}
        {view.status === "connected" && lastEvent && (
          <p className="text-muted-foreground">
            {/* "Last update" reads friendlier than "Last event" (designer P2, PSG-275);
                the value still carries CCC's own term ("Workfile saved"). */}
            <span className="text-foreground">Last update:</span> {lastEvent}
          </p>
        )}
        {view.status === "error" && (
          <p className="text-destructive">{errorHint(view.errorReason)}</p>
        )}
        {view.status === "declined" && (
          <p className="text-muted-foreground">
            <span className="text-foreground">Reason:</span>{" "}
            {view.declinedReason?.trim()
              ? view.declinedReason
              : "No reason was provided."}
          </p>
        )}
      </div>

      {/* "What we'll receive ▸" affordance on not_connected (spec §4 A) */}
      {view.status === "not_connected" && (
        <button
          type="button"
          aria-expanded={scopeOpen}
          onClick={() => setScopeOpen((v) => !v)}
          className="mt-3 text-sm text-primary underline-offset-4 hover:underline"
        >
          What we&rsquo;ll receive {scopeOpen ? "▾" : "▸"}
        </button>
      )}

      {/* CTAs (spec §2 table / §4 A″) */}
      <div className="mt-4 flex flex-wrap gap-2">
        {pres.ctas.map((cta, i) => (
          <Button
            key={cta}
            type="button"
            size="sm"
            variant={ctaVariant(cta, i)}
            aria-expanded={
              cta === "view_scope"
                ? scopeOpen
                : OPENS_STEPS.has(cta)
                  ? stepsOpen
                  : undefined
            }
            onClick={() => handleCta(cta)}
          >
            {CTA_LABELS[cta]}
          </Button>
        ))}
      </div>

      {/* Inline disconnect confirm (spec §3.4 — confirm + "this stops the data feed") */}
      {confirmingDisconnect && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-destructive">
            Disconnect CCC Secure Share? This stops the data feed immediately. No data already
            received is deleted.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => {
                setConfirmingDisconnect(false);
                actions.onDisconnect?.();
              }}
            >
              Yes, disconnect
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmingDisconnect(false)}
            >
              Keep connected
            </Button>
          </div>
        </div>
      )}

      {/* Connection step list (spec §4 A′) — embeds the data-scope panel inline */}
      {stepsOpen && (
        <div className="mt-4 rounded-lg border border-border bg-muted/10 p-4">
          <p className="font-semibold text-foreground">
            Connect {view.shopName} to BSM via CCC Secure Share
          </p>
          <p className="mt-1 text-muted-foreground">
            Do this in your CCC ONE Total Repair Platform:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-foreground">
            {/* TODO(child 3): step 1 carries the ⚠ PHASE-0 FIRM-UP placeholder
                ("[exact menu path confirmed in Phase 0]"). Before this reaches a real shop,
                gate it on the real menu path and render a human fallback (e.g. "your PSG rep
                will confirm the exact menu path") rather than the bracketed token (designer
                P1, PSG-275). */}
            {CCC_CONNECTION_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            After you enable it in CCC, this card will show &ldquo;Waiting on PSG&rdquo; and our
            team approves within 1 business day.
          </p>
          <div className="mt-4">
            <CccDataScopePanel dataScope={view.dataScope} />
          </div>
          {/* Close affordance (wireframe A′ "[Close]") — on not_connected, "Get connection
              steps" is the only CTA, so without this a shop that opens the list can't dismiss
              it and the standalone scope toggle stays gated on !stepsOpen (designer P1, PSG-275). */}
          <div className="mt-4">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setStepsOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Standalone scope panel toggle (not_connected "What we'll receive", connected/error
          "View scope") — only when the step list isn't already showing it. */}
      {scopeOpen && !stepsOpen && (
        <div className="mt-4">
          <CccDataScopePanel dataScope={view.dataScope} />
        </div>
      )}
    </div>
  );
}
