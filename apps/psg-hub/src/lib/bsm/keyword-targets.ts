// BSM Phase 0 / PSG-161 — SEO Auditor keyword-target loader + parser.
//
// Reads the shop's SEO-auditor output from `research_artifacts` and normalizes it
// into KeywordTarget[] for the Content Writer input path (PSG-153, QA defect
// PSG-145 item 6). The auditor persists to the SEMrush artifact_type family
// (`semrush_base | semrush_geo | semrush_competitor | semrush_gap`), `data` jsonb.
//
// Scoping / tenancy. `research_artifacts` has NO shop_id and FKs to the legacy
// `campaigns` table (campaign_id → campaigns.id), which carries `client_id`, not
// shop_id. So the finest scoping the schema allows is the SHOP'S CLIENT:
// shopId → shops.client_id → campaigns(client_id) → research_artifacts(campaign_id).
// Onboarding creates one client per shop (1:1), so this is shop-scoped in effect;
// the multi-location (one client → many shops) edge is flagged to Ada on PSG-153.
//
// `research_artifacts` is default-deny under RLS (the blanket policies were
// dropped in 20260603194623_close_blanket_allow_rls and no scoped SELECT policy
// replaced them), so a user-session client reads zero rows. The API route does
// the explicit shop_users membership gate and then hands this loader a
// service-role client (mirrors the onboarding service-role-after-auth pattern).
// The loader is client-agnostic and ALWAYS re-scopes by the shop's campaigns, so
// it cannot leak cross-tenant rows regardless of which client is passed.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  KeywordPriority,
  KeywordTarget,
} from "@/types/keyword-target";

/** The SEMrush/SEO-auditor artifact_type values in `research_artifacts`. */
export const SEO_AUDITOR_ARTIFACT_TYPES = [
  "semrush_base",
  "semrush_geo",
  "semrush_competitor",
  "semrush_gap",
] as const;

/** `semrush_gap` artifacts are, by definition, content-gap opportunities. */
const GAP_ARTIFACT_TYPE = "semrush_gap";

type ArtifactRow = {
  artifact_type: string;
  data: unknown;
};

/* -------------------------------------------------------------------------- */
/* Loader                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Load + normalize the SEO Auditor's keyword targets for a shop.
 *
 * @param supabase  A Supabase client. The API route passes a service-role client
 *                  AFTER an explicit shop membership gate; `research_artifacts`
 *                  is default-deny so a user-session client returns nothing.
 * @param shopId    The shop whose auditor artifacts to load (scoped via its client).
 * @param topic     Optional case-insensitive substring filter on the keyword.
 * @returns         KeywordTarget[] deduped by keyword (highest priority wins),
 *                  sorted priority desc then volume desc. `[]` when the shop has
 *                  no client / campaigns / auditor artifacts.
 */
export async function fetchKeywordTargets(
  supabase: SupabaseClient,
  shopId: string,
  topic?: string,
): Promise<KeywordTarget[]> {
  // 1. shop → client_id
  const { data: shop } = await supabase
    .from("shops")
    .select("client_id")
    .eq("id", shopId)
    .maybeSingle();
  const clientId = (shop as { client_id?: string } | null)?.client_id;
  if (!clientId) return [];

  // 2. client → campaign ids
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id")
    .eq("client_id", clientId);
  const campaignIds = (campaigns ?? [])
    .map((c) => (c as { id?: string }).id)
    .filter((id): id is string => typeof id === "string");
  if (campaignIds.length === 0) return [];

  // 3. campaigns → SEO-auditor artifacts
  const { data: artifacts } = await supabase
    .from("research_artifacts")
    .select("artifact_type, data")
    .in("campaign_id", campaignIds)
    .in("artifact_type", SEO_AUDITOR_ARTIFACT_TYPES as unknown as string[]);

  const rows = (artifacts ?? []) as ArtifactRow[];

  // 4. parse → normalize → dedupe → filter → sort
  const all: KeywordTarget[] = [];
  for (const row of rows) {
    all.push(...parseArtifact(row));
  }

  const deduped = dedupeByKeyword(all);
  const filtered = topic ? deduped.filter(matchesTopic(topic)) : deduped;

  filtered.sort(
    (a, b) =>
      PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
      b.search_volume - a.search_volume,
  );
  return filtered;
}

/* -------------------------------------------------------------------------- */
/* Parser                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Parse a single artifact row into KeywordTarget[]. Prefers structured jsonb;
 * falls back to parsing an embedded audit-markdown table ONLY when no structured
 * keyword rows are present (per the PSG-161 spec).
 *
 * Exported for unit testing of the parse/fallback branches.
 */
export function parseArtifact(row: ArtifactRow): KeywordTarget[] {
  const isGapArtifact = row.artifact_type === GAP_ARTIFACT_TYPE;
  const structured = extractKeywordRows(row.data);

  if (structured.length > 0) {
    return structured
      .map((r) => normalizeRow(r, isGapArtifact))
      .filter((t): t is KeywordTarget => t !== null);
  }

  // Fallback: markdown only when there is no structured keyword data at all.
  const md = extractMarkdown(row.data);
  return md ? parseMarkdownKeywords(md, isGapArtifact) : [];
}

/** Pull the array of raw keyword rows out of the many shapes `data` may take. */
function extractKeywordRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isObject);
  if (!isObject(data)) return [];
  // Common envelope keys the auditor may use.
  for (const key of ["keywords", "keyword_targets", "keywordTargets", "rows", "targets"]) {
    const v = (data as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v.filter(isObject);
  }
  return [];
}

/** Normalize a raw structured row into a KeywordTarget, or null if unusable. */
function normalizeRow(
  r: Record<string, unknown>,
  isGapArtifact: boolean,
): KeywordTarget | null {
  const keyword = str(r.keyword ?? r.phrase ?? r.term ?? r.query)?.trim();
  if (!keyword) return null;

  const search_volume = nonNegInt(
    r.search_volume ?? r.searchVolume ?? r.volume ?? r.search_vol,
  );
  const competitor_presence = nonNegInt(
    r.competitor_presence ??
      r.competitorPresence ??
      r.competitors ??
      r.competitor_count,
  );
  const gap_opportunity =
    bool(r.gap_opportunity ?? r.gapOpportunity ?? r.gap ?? r.is_gap) ||
    isGapArtifact;

  const priority = normalizePriority(
    r.priority,
    search_volume,
    gap_opportunity,
  );

  return {
    keyword,
    search_volume,
    competitor_presence,
    gap_opportunity,
    priority,
    source: "seo-auditor",
  };
}

/* -------------------------------------------------------------------------- */
/* Markdown fallback                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Parse keyword rows out of an audit-report markdown table. Recognizes a table
 * whose header contains a "keyword" column; reads optional "volume",
 * "competitor", "gap", and "priority" columns by header name. Defensive: skips
 * the header/separator and any row without a keyword cell.
 */
export function parseMarkdownKeywords(
  markdown: string,
  isGapArtifact: boolean,
): KeywordTarget[] {
  const lines = markdown.split("\n");
  const tableRows = lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableRows.length < 2) return [];

  const header = splitRow(tableRows[0]).map((h) => h.toLowerCase());
  const col = (needle: string) => header.findIndex((h) => h.includes(needle));
  const kwCol = col("keyword");
  if (kwCol === -1) return [];
  const volCol = col("volume");
  const compCol = col("competitor");
  const gapCol = col("gap");
  const prioCol = col("priority");

  const out: KeywordTarget[] = [];
  for (const line of tableRows.slice(1)) {
    const cells = splitRow(line);
    // Skip the markdown separator row (---|---).
    if (cells.every((c) => /^-+$/.test(c.replace(/:/g, "")))) continue;
    const keyword = cells[kwCol]?.trim();
    if (!keyword) continue;

    const search_volume = volCol >= 0 ? nonNegInt(cells[volCol]) : 0;
    const competitor_presence = compCol >= 0 ? nonNegInt(cells[compCol]) : 0;
    const gap_opportunity =
      (gapCol >= 0 ? bool(cells[gapCol]) : false) || isGapArtifact;
    const priority = normalizePriority(
      prioCol >= 0 ? cells[prioCol] : undefined,
      search_volume,
      gap_opportunity,
    );

    out.push({
      keyword,
      search_volume,
      competitor_presence,
      gap_opportunity,
      priority,
      source: "seo-auditor",
    });
  }
  return out;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const PRIORITY_RANK: Record<KeywordPriority, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * Coerce a priority value to a bucket. Accepts explicit HIGH/MEDIUM/LOW (any
 * case), a numeric 0–100 score, or derives one from volume + gap when absent.
 */
function normalizePriority(
  raw: unknown,
  searchVolume: number,
  gapOpportunity: boolean,
): KeywordPriority {
  if (typeof raw === "string") {
    const u = raw.trim().toUpperCase();
    if (u === "HIGH" || u === "MEDIUM" || u === "LOW") return u;
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && (typeof raw === "number" || String(raw).trim() !== "")) {
    if (n >= 67) return "HIGH";
    if (n >= 34) return "MEDIUM";
    return "LOW";
  }
  // Derive: a content gap with real volume is the highest-value pursue.
  if (gapOpportunity && searchVolume >= 1000) return "HIGH";
  if (gapOpportunity || searchVolume >= 500) return "MEDIUM";
  return "LOW";
}

/** Keep the highest-priority instance of each keyword (case-insensitive). */
function dedupeByKeyword(targets: KeywordTarget[]): KeywordTarget[] {
  const best = new Map<string, KeywordTarget>();
  for (const t of targets) {
    const key = t.keyword.toLowerCase();
    const prev = best.get(key);
    if (!prev || PRIORITY_RANK[t.priority] > PRIORITY_RANK[prev.priority]) {
      best.set(key, t);
    }
  }
  return [...best.values()];
}

function matchesTopic(topic: string): (t: KeywordTarget) => boolean {
  const needle = topic.toLowerCase();
  return (t) => t.keyword.toLowerCase().includes(needle);
}

function extractMarkdown(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (isObject(data)) {
    for (const key of ["markdown", "report", "audit_markdown", "md", "text"]) {
      const v = (data as Record<string, unknown>)[key];
      if (typeof v === "string") return v;
    }
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function nonNegInt(v: unknown): number {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string"
        ? Number(v.replace(/[,\s]/g, ""))
        : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const u = v.trim().toLowerCase();
    return u === "true" || u === "yes" || u === "y" || u === "1" || u === "✓";
  }
  return false;
}
