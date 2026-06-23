// CCC Secure Share — data-scope / consent panel (spec §4 C, surface C).
// PSG-266. Shared, presentational, and fully DATA-DRIVEN: it renders whatever `dataScope`
// it is handed (the documented CCC ONE export scope as a fixture today; the real
// `ccc_accounts.data_scope` once Phase 0/1 seed it). No hooks, no I/O — safe to render inside
// the shop card (A), the step list (A′), and the PSG approval queue (B) alike.

import type { CccDataScope } from "@/lib/ccc/connection-state";

export function CccDataScopePanel({
  dataScope,
  className,
}: {
  dataScope: CccDataScope;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-muted/20 p-4 text-sm ${className ?? ""}`}
    >
      <p className="font-semibold text-foreground">What BSM receives from your CCC ONE</p>
      <p className="mt-1 text-muted-foreground">{dataScope.summary}</p>

      <ul className="mt-3 space-y-1.5">
        {dataScope.received.map((field) => (
          <li key={field.label} className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 text-success">
              ✓
            </span>
            <span>
              <span className="text-foreground">{field.label}</span>
              {field.note && (
                <span className="ml-1 text-muted-foreground">({field.note})</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {dataScope.excluded.length > 0 && (
        <p className="mt-3 text-muted-foreground">
          <span aria-hidden className="text-destructive">
            ✗
          </span>{" "}
          We never receive: {dataScope.excluded.join(", ")}.
        </p>
      )}

      {dataScope.assurance && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          {dataScope.assurance}
        </p>
      )}
    </div>
  );
}
