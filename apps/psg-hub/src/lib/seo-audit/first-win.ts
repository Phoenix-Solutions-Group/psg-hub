// PSG-767 — Launch blocker B2: first-win dashboard.
//
// Pure projection of the shop's latest SEO audit into the "Your first result is
// ready" card the dashboard shows ABOVE the metrics on first load. Kept pure (no
// I/O) so it is node-testable and invents nothing — every number is read straight
// off the persisted audit summary. When no audit has landed yet, the card reads as
// PENDING (honest) rather than fabricating a result.

import type { AuditSummary } from "./types";

/** The audit slice the card needs (mirror of the dashboard/audit page shape). */
export type FirstWinAudit = {
  mode: "audited" | "greenfield";
  healthScore: number | null;
  grade: string;
  summary: AuditSummary;
} | null;

export type FirstWinCard =
  | {
      state: "pending";
      /** One plain line explaining why the result isn't here yet. */
      detail: string;
    }
  | {
      state: "ready";
      badge: string;
      headline: string;
      detail: string;
    };

/**
 * Build the first-win card view-model from the latest audit.
 * - No audit yet  → pending ("your check is still running").
 * - greenfield    → no score to show; frame the build plan (grounded in plan.pagesToBuild).
 * - audited       → health score + count of quick fixes (grounded in summary.improveCount).
 */
export function buildFirstWinCard(audit: FirstWinAudit): FirstWinCard {
  if (!audit) {
    return {
      state: "pending",
      detail:
        "Your free website health check is running — your first result will appear here in a moment.",
    };
  }

  if (audit.mode === "greenfield") {
    const pages = audit.summary.plan?.pagesToBuild ?? 0;
    return {
      state: "ready",
      badge: "Your first result is ready",
      headline: "Free website health check complete.",
      detail:
        pages > 0
          ? `We mapped a plan of ${pages} ${pages === 1 ? "page" : "pages"} to help more local drivers find you.`
          : "We mapped a plan to help more local drivers find you.",
    };
  }

  // audited — a live site was scored.
  const score = audit.healthScore ?? 0;
  const fixes = audit.summary.improveCount;
  return {
    state: "ready",
    badge: "Your first result is ready",
    headline: `Free website health check — score ${score}/100.`,
    detail:
      fixes > 0
        ? `We found ${fixes} quick ${fixes === 1 ? "fix" : "fixes"} that help more local drivers find you.`
        : "Your site is in good shape — no urgent fixes found.",
  };
}
