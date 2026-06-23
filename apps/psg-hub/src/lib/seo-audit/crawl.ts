// Wave 1C / PSG-227 — Site crawl seam (firecrawl-map), with graceful degradation.
//
// Stage input for the auditor: discover a shop's existing URLs (+ per-page SEO
// signals) so the deterministic auditor can flag Keep/Improve. This is the SAME
// "firecrawl-map / URL inventory" plumbing Wave 1A names as the shared dependency
// (PSG-215 review §4, §7 1C "shares architecture/firecrawl plumbing").
//
// The live provider routes through Firecrawl (`/v1/map` for the URL set, `/v1/scrape`
// for per-page metrics on a capped sample). It is selected ONLY when FIRECRAWL_API_KEY
// is present; otherwise the registry degrades to the no-op provider (mirrors the
// onboarding discovery provider's "degrade-when-unconfigured" posture) so an audit
// never fails — it just runs as greenfield. `fetch` is injected so the live provider
// is node-testable with no network.

import { crawledPageSchema, type CrawledPage } from "./types";

/** The crawl seam: a domain in, discovered pages (with SEO signals) out. */
export type SiteCrawlProvider = {
  readonly name: string;
  isConfigured?(): boolean;
  crawl(domain: string): Promise<CrawledPage[]>;
};

/** Greenfield-safe default: no live crawl, so the audit runs as a build plan. */
export const noopCrawlProvider: SiteCrawlProvider = {
  name: "noop",
  isConfigured: () => true,
  crawl: async () => [],
};

/* -------------------------------------------------------------------------- */
/* Firecrawl provider                                                          */
/* -------------------------------------------------------------------------- */

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type FirecrawlDeps = {
  apiKey: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  /** Max pages to scrape for metrics (cost cap). Default 25. */
  scrapeLimit?: number;
};

/** Normalize a bare domain to an https origin URL. */
export function normalizeDomain(domain: string): string {
  const trimmed = domain.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

type ScrapeMetadata = {
  statusCode?: number;
  title?: string;
  description?: string;
};

/** Pull SEO signals out of a Firecrawl scrape result (defensive: shape varies). */
export function scrapeResultToPage(url: string, result: unknown): CrawledPage {
  const r = (result ?? {}) as Record<string, unknown>;
  const meta = (r.metadata ?? {}) as ScrapeMetadata & Record<string, unknown>;
  const markdown = typeof r.markdown === "string" ? r.markdown : "";
  const html = typeof r.html === "string" ? r.html : "";
  const wordCount = markdown ? markdown.split(/\s+/).filter(Boolean).length : undefined;
  const h1Count = html ? (html.match(/<h1[\s>]/gi) ?? []).length : undefined;
  const statusCode = typeof meta.statusCode === "number" ? meta.statusCode : undefined;

  const page: CrawledPage = {
    url,
    title: typeof meta.title === "string" ? meta.title : "",
    metaDescription: typeof meta.description === "string" ? meta.description : "",
    ...(statusCode != null ? { statusCode } : {}),
    ...(wordCount != null ? { wordCount } : {}),
    ...(h1Count != null ? { h1Count } : {}),
  };
  return crawledPageSchema.parse(page);
}

/**
 * Firecrawl-backed crawl provider. `/v1/map` enumerates the site's URLs; then a
 * capped sample is `/v1/scrape`d for per-page SEO metrics. Any per-page scrape
 * failure degrades that page to a URL-only row (no manufactured defect) rather
 * than failing the whole crawl.
 */
export function createFirecrawlProvider(deps: FirecrawlDeps): SiteCrawlProvider {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const baseUrl = deps.baseUrl ?? "https://api.firecrawl.dev";
  const scrapeLimit = deps.scrapeLimit ?? 25;

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${deps.apiKey}`,
  };

  return {
    name: "firecrawl",
    isConfigured: () => Boolean(deps.apiKey),
    async crawl(domain: string): Promise<CrawledPage[]> {
      const origin = normalizeDomain(domain);

      const mapRes = await fetchImpl(`${baseUrl}/v1/map`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: origin }),
      });
      if (!mapRes.ok) {
        throw new Error(`firecrawl map failed: HTTP ${mapRes.status}`);
      }
      const mapJson = (await mapRes.json()) as { links?: unknown };
      const links = Array.isArray(mapJson.links)
        ? mapJson.links.filter((l): l is string => typeof l === "string")
        : [];
      // Dedupe + cap the scrape set; the rest are inventory rows with no metrics.
      const unique = Array.from(new Set(links));
      const toScrape = unique.slice(0, scrapeLimit);

      const scraped = await Promise.all(
        toScrape.map(async (url) => {
          try {
            const res = await fetchImpl(`${baseUrl}/v1/scrape`, {
              method: "POST",
              headers,
              body: JSON.stringify({ url, formats: ["markdown", "html"] }),
            });
            if (!res.ok) return { url } as CrawledPage;
            const body = (await res.json()) as { data?: unknown };
            return scrapeResultToPage(url, body.data);
          } catch {
            return { url } as CrawledPage;
          }
        }),
      );

      // URL-only rows for everything past the scrape cap.
      const remainder = unique.slice(scrapeLimit).map((url) => ({ url }) as CrawledPage);
      return [...scraped, ...remainder];
    },
  };
}

/**
 * Select the active crawl provider from the environment. Firecrawl when its key
 * is present; otherwise the no-op provider (audit runs greenfield). Never throws.
 */
export function selectCrawlProvider(
  env: Record<string, string | undefined> = process.env,
): SiteCrawlProvider {
  if (env.FIRECRAWL_API_KEY) {
    return createFirecrawlProvider({ apiKey: env.FIRECRAWL_API_KEY });
  }
  return noopCrawlProvider;
}
