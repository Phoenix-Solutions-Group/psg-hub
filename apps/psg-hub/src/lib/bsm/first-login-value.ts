import type { ShopAuditReport } from "@/lib/seo-audit/types";

export type FirstLoginValueState = {
  eyebrow: string;
  title: string;
  detail: string;
  nextStepLabel: string;
  nextStepHref: string;
  status: "ready" | "pending" | "found";
};

export function buildFirstLoginValueState(
  report: ShopAuditReport | null,
): FirstLoginValueState {
  if (!report) {
    return {
      eyebrow: "Online presence check",
      title: "Your first check has not run yet.",
      detail:
        "Run a quick, free shop check first. This does not connect Google, publish anything, or change your public listing.",
      nextStepLabel: "Start free check",
      nextStepHref: "/dashboard/onboarding",
      status: "pending",
    };
  }

  if (report.mode === "greenfield") {
    return {
      eyebrow: "First finding",
      title: "BSM did not find a live website to score.",
      detail:
        "That is an honest starting point: add the shop website or connect Google so BSM can compare real public signals.",
      nextStepLabel: "Connect Google",
      nextStepHref: "/dashboard/analytics",
      status: "found",
    };
  }

  const improveCount = report.summary.improveCount;
  const pagesCrawled = report.summary.pagesCrawled;

  if (improveCount > 0) {
    return {
      eyebrow: "First finding",
      title: `${improveCount} page${improveCount === 1 ? "" : "s"} need${improveCount === 1 ? "s" : ""} attention.`,
      detail: `BSM checked ${pagesCrawled} page${pagesCrawled === 1 ? "" : "s"} for ${report.businessName} and found a real place to improve.`,
      nextStepLabel: "Connect Google",
      nextStepHref: "/dashboard/analytics",
      status: "found",
    };
  }

  return {
    eyebrow: "First finding",
    title: "Your website check is clean for now.",
    detail: `BSM checked ${pagesCrawled} page${pagesCrawled === 1 ? "" : "s"} for ${report.businessName}. Connect Google next so BSM can review the listing and reviews too.`,
    nextStepLabel: "Connect Google",
    nextStepHref: "/dashboard/analytics",
    status: "ready",
  };
}
