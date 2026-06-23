"use client";

// Wave 1C / PSG-227 — Baseline SEO audit surface (onboarding deliverable).
//
// Customer-facing card that runs (or re-runs) the shop's baseline SEO audit and
// shows the headline result (health score / grade + Keep/Improve + keyword
// counts), with a link to the full branded report. First run is on demand; the
// "Re-run" button makes it re-runnable per the acceptance criteria. Greenfield
// (no live site) degrades cleanly to a "build plan" framing — no score, no scold.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AuditSummary = {
  pagesCrawled: number;
  keepCount: number;
  improveCount: number;
  keywordOpportunities: number;
};

type AuditResult = {
  mode: "audited" | "greenfield";
  healthScore: number | null;
  grade: string;
  summary: AuditSummary;
  generatedAt: string;
};

export function SeoAuditCard({ initial }: { initial?: AuditResult | null }) {
  const [result, setResult] = useState<AuditResult | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAudit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/audit", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Audit failed. Please try again.");
        return;
      }
      setResult((await res.json()) as AuditResult);
    } catch {
      setError("Audit failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const hasRun = result != null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>Baseline SEO audit</span>
          {hasRun && (
            <Button
              variant="outline"
              size="sm"
              onClick={runAudit}
              disabled={loading}
            >
              {loading ? "Re-running…" : "Re-run"}
            </Button>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A plain-language read of how your website is set up to win local search —
          what to keep, what to fix, and where the opportunity is.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!hasRun && (
          <Button onClick={runAudit} disabled={loading} className="w-full">
            {loading ? "Auditing your site…" : "Run my free SEO audit"}
          </Button>
        )}

        {hasRun && result && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric
                label={result.mode === "greenfield" ? "Status" : "Health score"}
                value={
                  result.mode === "greenfield"
                    ? "New"
                    : `${result.healthScore ?? "—"} (${result.grade})`
                }
              />
              <Metric label="Pages reviewed" value={String(result.summary.pagesCrawled)} />
              <Metric label="To keep" value={String(result.summary.keepCount)} />
              <Metric label="To improve" value={String(result.summary.improveCount)} />
            </div>
            {result.mode === "greenfield" && (
              <p className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                We couldn&apos;t find a live website to audit, so this is a build
                plan rather than a score. Add your website in settings and re-run
                for a graded baseline.
              </p>
            )}
            <a
              href="/api/onboarding/audit?format=html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm font-medium text-ember underline-offset-4 hover:underline"
            >
              View full report →
            </a>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
