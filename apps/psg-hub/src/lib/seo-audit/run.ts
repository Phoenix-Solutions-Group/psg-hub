// Wave 1C / PSG-227 — Shop SEO audit orchestrator (server-only).
//
// The single server-only entry point that turns a shopId into a persisted,
// rendered audit. It wires the pure builder/renderer to the live seams: reads the
// shop's profile (name/url/locality) via the service client, runs the selected
// crawl provider (firecrawl-map when configured, else greenfield), builds + renders
// the report, and appends an immutable row to `shop_seo_audits`. Re-runnable: each
// call appends a new audit (history), so "re-run on demand" is just a second call.
//
// Degrades, never throws on a crawl/provider outage: a crawl failure falls back to
// a greenfield report rather than failing the request (fail-open on enrichment,
// fail-closed only on the shop read / DB write). The crawl provider + clock are
// injected so this is testable without network.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildShopAuditReport } from "./report";
import { renderShopAuditReportHtml } from "./render";
import { selectCrawlProvider, type SiteCrawlProvider } from "./crawl";
import { shopBriefSchema, type ShopAuditReport, type ShopBrief } from "./types";

/** The shops columns the audit needs (mirror of the onboarding insert shape). */
type ShopRow = {
  id: string;
  name: string | null;
  url: string | null;
  address_locality: string | null;
  address_region: string | null;
};

export type RunShopAuditDeps = {
  service: SupabaseClient;
  shopId: string;
  /** Actor id stamped as created_by on the audit row (and audit trail upstream). */
  userId?: string;
  /** Crawl seam. Defaults to env-selected (firecrawl when keyed, else greenfield). */
  crawlProvider?: SiteCrawlProvider;
  /** ISO timestamp (injected for testability; defaults to now). */
  now?: string;
  /** Persist the audit row? Default true; false for a dry-run preview. */
  persist?: boolean;
};

export type RunShopAuditResult = {
  report: ShopAuditReport;
  html: string;
  /** The id of the persisted audit row, or null when persist=false. */
  auditId: string | null;
};

type AuditOutcome = {
  status: "completed" | "failed";
  outcome: "audited" | "no_live_site" | "crawl_failed";
  errorReason: string | null;
};

export class ShopAuditPersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopAuditPersistError";
  }
}

/** Build the engine's ShopBrief from a shops row. */
export function shopRowToBrief(row: ShopRow): ShopBrief {
  const city = row.address_locality?.trim() || "";
  const state = row.address_region?.trim() || "";
  const locations = city
    ? [{ city, state: state || city, primary: true }]
    : [];
  return shopBriefSchema.parse({
    shopId: row.id,
    businessName: row.name?.trim() || "Your shop",
    domain: row.url?.trim() || null,
    // Collision-repair is BSM's ICP; the auditor's vertical seeds stay on-target.
    vertical: "collision_repair",
    services: [],
    locations,
    competitors: [],
  });
}

/**
 * Run (or re-run) the baseline SEO audit for one shop and persist it.
 * Throws only on a shop-read failure (fail-closed); a crawl/provider outage
 * degrades to a greenfield report.
 */
export async function runShopAudit(deps: RunShopAuditDeps): Promise<RunShopAuditResult> {
  const { service, shopId } = deps;
  const now = deps.now ?? new Date().toISOString();
  const persist = deps.persist ?? true;

  const { data: shop, error } = await service
    .from("shops")
    .select("id, name, url, address_locality, address_region")
    .eq("id", shopId)
    .single<ShopRow>();

  if (error || !shop) {
    throw new Error(`shop_seo_audit: shop ${shopId} not found`);
  }

  const brief = shopRowToBrief(shop);

  // Crawl the live site (capped + cost-aware). Any crawl failure ⇒ greenfield.
  const provider = deps.crawlProvider ?? selectCrawlProvider();
  let pages: Awaited<ReturnType<SiteCrawlProvider["crawl"]>> = [];
  let auditOutcome: AuditOutcome = brief.domain
    ? { status: "completed", outcome: "audited", errorReason: null }
    : { status: "completed", outcome: "no_live_site", errorReason: null };
  if (brief.domain) {
    try {
      pages = await provider.crawl(brief.domain);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown crawl error";
      console.error(
        "[seo-audit] crawl failed, degrading to greenfield:",
        reason,
      );
      auditOutcome = {
        status: "failed",
        outcome: "crawl_failed",
        errorReason: reason.slice(0, 240),
      };
      pages = [];
    }
  }

  const report = buildShopAuditReport(brief, { generatedAt: now, pages });
  const html = renderShopAuditReportHtml(report);

  let auditId: string | null = null;
  if (persist) {
    const { data: row, error: insErr } = await service
      .from("shop_seo_audits")
      .insert({
        shop_id: shopId,
        domain: report.domain,
        mode: report.mode,
        health_score: report.healthScore,
        grade: report.grade,
        summary: report.summary,
        report,
        audit_status: auditOutcome.status,
        audit_outcome: auditOutcome.outcome,
        error_reason: auditOutcome.errorReason,
        created_by: deps.userId ?? null,
        generated_at: now,
      })
      .select("id")
      .single<{ id: string }>();
    if (insErr) {
      console.error("[seo-audit] persist failed:", insErr.message);
      throw new ShopAuditPersistError(
        "shop_seo_audit: audit completed but could not be saved",
      );
    } else {
      auditId = row?.id ?? null;
    }
  }

  return { report, html, auditId };
}

/** The latest persisted audit for a shop (for the GET / dashboard surface). */
export async function getLatestShopAudit(
  service: SupabaseClient,
  shopId: string,
): Promise<{ report: ShopAuditReport; generatedAt: string } | null> {
  const { data, error } = await service
    .from("shop_seo_audits")
    .select("report, generated_at")
    .eq("shop_id", shopId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ report: ShopAuditReport; generated_at: string }>();
  if (error || !data) return null;
  return { report: data.report, generatedAt: data.generated_at };
}
