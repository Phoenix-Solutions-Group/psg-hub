// Wave 1A / PSG-236 — Live AuditProvider: firecrawl-map + agent-engine seo-auditor.
//
// Wires the engine's Stage-2 `AuditProvider` seam. Two injected live steps:
//
//   crawl  → firecrawl-map (or own-site GSC URL list): enumerate the live site's URLs
//   audit  → agent-engine seo-auditor: per-URL Keep/Improve baseline verdict
//
// Greenfield briefs (no `domain`) short-circuit to [] — there is nothing to audit, so
// every page in the produced architecture stays `new`. The per-URL audit is optional:
// without it every discovered URL is Keep (carry-forward), which is the safe default
// (the deliverable still shows what exists). An audit step that throws downgrades that
// URL to Improve with a note rather than dropping it — a flagged page beats a missing one.
// Pure + node-testable: crawl/audit are injected; this module only maps/dedupes/caps.

import type { AuditProvider } from "../pipeline";
import { inventoryUrlSchema, type InventoryUrl, type ShopBrief } from "../types";

/** One URL discovered by the crawl/map step (firecrawl-map / GSC). */
export type CrawledUrl = { url: string; title?: string | null };

/** The seo-auditor's baseline verdict for one URL. */
export type UrlAuditVerdict = { disposition: "keep" | "improve"; note?: string };

export type AuditProviderDeps = {
  /** Stage 2a: enumerate live URLs (firecrawl-map / GSC). */
  crawl: (brief: ShopBrief) => Promise<CrawledUrl[]>;
  /** Stage 2b: per-URL Keep/Improve verdict (seo-auditor). Omit ⇒ Keep all. */
  audit?: (url: CrawledUrl, brief: ShopBrief) => Promise<UrlAuditVerdict>;
  /** Cap URLs audited (cost + payload guard). Default 200. */
  maxUrls?: number;
  /** Called on crawl/audit failure (for logging); swallowed so the run continues. */
  onError?: (stage: "crawl" | "audit", err: unknown) => void;
};

/** Build a live AuditProvider from the crawl + per-URL audit steps. */
export function makeAuditProvider(deps: AuditProviderDeps): AuditProvider {
  const maxUrls = deps.maxUrls ?? 200;

  return async (brief) => {
    // Greenfield: no live site → no inventory.
    if (!brief.domain) return [];

    let urls: CrawledUrl[];
    try {
      urls = await deps.crawl(brief);
    } catch (err) {
      deps.onError?.("crawl", err);
      return [];
    }

    const out: InventoryUrl[] = [];
    const seen = new Set<string>();
    for (const u of urls) {
      if (out.length >= maxUrls) break; // cost cap counts UNIQUE audited URLs
      const url = u.url?.trim();
      if (!url) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      let verdict: UrlAuditVerdict = { disposition: "keep" };
      if (deps.audit) {
        try {
          verdict = await deps.audit(u, brief);
        } catch (err) {
          deps.onError?.("audit", err);
          verdict = { disposition: "improve", note: "audit unavailable — review manually" };
        }
      }

      const parsed = inventoryUrlSchema.safeParse({
        url,
        title: u.title ?? "",
        disposition: verdict.disposition,
        note: verdict.note,
      });
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  };
}
