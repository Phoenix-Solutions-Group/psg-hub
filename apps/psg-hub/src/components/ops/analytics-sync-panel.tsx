"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// PSG-645: superadmin "Sync now" panel. Fires POST /api/ops/admin/analytics/sync and
// renders the per-source result (rows written / errors). A single run is in flight at a
// time — every button is disabled while one runs, so overlapping manual runs can't be
// launched from the UI. There is no toast system in this app; results render inline.

type SourceStatus = "success" | "error" | "skipped";
type SourceOutcome = {
  source: string;
  status: SourceStatus;
  rows_written: number;
  error?: string;
  detail?: Record<string, unknown>;
};
type SyncResponse = {
  cadence: "daily" | "monthly";
  scope: string;
  period?: string;
  results: SourceOutcome[];
};

type DailySource = "all" | "ga4" | "gsc" | "gbp" | "gbp_reviews" | "google_ads" | "semrush";

const DAILY_BUTTONS: { source: DailySource; label: string }[] = [
  { source: "all", label: "All daily sources" },
  { source: "ga4", label: "GA4" },
  { source: "gsc", label: "Search Console" },
  { source: "gbp", label: "Business Profile" },
  { source: "gbp_reviews", label: "GBP reviews" },
  { source: "google_ads", label: "Google Ads" },
  { source: "semrush", label: "SEMrush" },
];

const STATUS_STYLES: Record<SourceStatus, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
  skipped: "text-muted-foreground",
};

function summarize(res: SyncResponse): string {
  const ok = res.results.filter((r) => r.status === "success").length;
  const err = res.results.filter((r) => r.status === "error").length;
  const skip = res.results.filter((r) => r.status === "skipped").length;
  const rows = res.results.reduce((n, r) => n + r.rows_written, 0);
  const parts = [`${ok} ok`, `${rows} rows written`];
  if (err) parts.push(`${err} failed`);
  if (skip) parts.push(`${skip} skipped`);
  return parts.join(" · ");
}

function detailSummary(detail?: Record<string, unknown>): string | null {
  if (!detail) return null;
  const parts = ["sent", "skipped", "held", "failed"]
    .map((key) => {
      const value = detail[key];
      return typeof value === "number" ? `${key}: ${value}` : null;
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function AnalyticsSyncPanel() {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [force, setForce] = useState(false);

  const busy = running !== null;

  async function run(label: string, body: Record<string, unknown>) {
    setRunning(label);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ops/admin/analytics/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as SyncResponse | { error?: string };
      if (!("results" in data)) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult(data);
      if (!res.ok) {
        // 502/503 still carry a results body; surface a top-line note too.
        setError(
          res.status === 503
            ? "Nothing ran — none of the selected sources are configured yet."
            : "The sync finished with errors — see the per-source detail below."
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Daily ingest sources */}
      <section className="rounded-lg border border-border p-5">
        <h2 className="font-heading text-base font-semibold">Daily ingest</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pull the latest analytics snapshots on demand. Runs the same sync the daily cron
          runs, across all shops.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {DAILY_BUTTONS.map((b) => (
            <Button
              key={b.source}
              size="sm"
              variant={b.source === "all" ? "default" : "outline"}
              disabled={busy}
              onClick={() => run(`daily:${b.source}`, { cadence: "daily", source: b.source })}
            >
              {running === `daily:${b.source}` ? "Syncing…" : b.label}
            </Button>
          ))}
        </div>
      </section>

      {/* Monthly set + report */}
      <section className="rounded-lg border border-border p-5">
        <h2 className="font-heading text-base font-semibold">Monthly report</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs the monthly data set (dimensions, performance, presence) and then generates
          &amp; emails the monthly report for the just-completed month.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={force}
            disabled={busy}
            onChange={(e) => setForce(e.target.checked)}
            className="size-4 rounded border-border"
          />
          Re-send even if a report was already delivered (force)
        </label>
        <div className="mt-4">
          <Button
            variant="default"
            disabled={busy}
            onClick={() => run("monthly", { cadence: "monthly", force })}
          >
            {running === "monthly" ? "Generating…" : "Run monthly report now"}
          </Button>
        </div>
      </section>

      {/* Result */}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded-lg border border-border p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="font-heading text-sm font-semibold">
              Result
              {result.period ? ` · ${result.period}` : ""}
            </h3>
            <span className="text-xs text-muted-foreground">{summarize(result)}</span>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {result.results.map((r) => {
              const detail = detailSummary(r.detail);
              return (
                <li key={r.source} className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs">{r.source}</span>
                  <span className={`text-right ${STATUS_STYLES[r.status]}`}>
                    {r.status === "success"
                      ? `${r.rows_written} rows${detail ? ` (${detail})` : ""}`
                      : r.status === "skipped"
                        ? `skipped (${r.error ?? "not run"}${detail ? `; ${detail}` : ""})`
                        : `error: ${r.error ?? "unknown"}${detail ? ` (${detail})` : ""}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
