// v1.6 / Wave 1B follow-on (PSG-241) — G5-gated competitor DISCOVERY.
//
// PSG-226 brought Providence's continuous competitor monitor to BSM, but the monitor only
// reports on shops that ALREADY have `competitors` rows. This module is the missing seam: it
// finds a real shop's nearby/relevant body-shop competitors and upserts them into
// `competitors`, so the existing scoring (sync.ts) + report/monitor (run.ts / run-monitor.ts)
// engines then have something to work on. It does NOT fork scoring — it only seeds the table
// the rest of the engine already consumes.
//
// GROUNDED-ONLY, DEGRADE-TO-NOTHING (the safety property): discovery WRITES rows to the DB, so
// unlike the report's narrative/research seams it must never fabricate. The web_grounded router
// profile has an ungrounded Anthropic tail that is fine for prose but would HALLUCINATE fake
// shops here. So this module persists a competitor ONLY when the producing model was genuinely
// grounded (Perplexity / Gemini). Until G5 clears (no grounded provider enabled) it degrades to
// nothing: zero spend, zero rows. This is the build-now / activate-at-G5 posture the issue asks
// for, and the reason Ada reviews the service-role write path.
//
// TENANT ISOLATION (the gating risk): every discovered row carries the owning `shop_id`, the
// upsert is keyed on UNIQUE(shop_id, normalized_name), and per-shop work is clamped to one
// shopId at a time — identical to sync.ts / run-monitor.ts. The service-role client bypasses
// RLS, so this per-shop scoping in code IS the isolation boundary on the write path; the table
// RLS policies guard the customer read path. A single shop's failure is contained.
//
// BUDGET: the grounded call routes through the same 16-01 router + budget-reader as the report,
// so the G5 month-to-date spend cap applies. A per-shop cap (default $25, lower than the report's
// $200) is enforced against the SHARED ledger, so a whole discovery pass is bounded too — once
// the ceiling is crossed, later shops degrade to nothing and spend $0.

import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { route } from "../router";
import { gatewayGenerate } from "../gateway";
import { resolveEnabledProviders, makeRouterLogger } from "../server";
import { monthToDateSpendUsd as readMonthToDateSpend } from "../budget-reader";
import { MODEL_CATALOG } from "../catalog";
import type { Provider } from "../types";
import { classifyConsolidator } from "./consolidators";
import { haversineMiles } from "./scoring";
import type { CompetitorSource } from "./types";

/**
 * Per-shop spend ceiling for a discovery pass, in USD. Lower than the on-demand report's $200
 * because discovery is a one-shot seed, not a deep narrative. Overridable via
 * `INTEL_DISCOVERY_SPEND_CAP_USD`. Enforced against the SHARED month-to-date intel ledger, so it
 * also bounds the cumulative spend of a whole multi-shop pass.
 */
export const DEFAULT_DISCOVERY_SPEND_CAP_USD = 25;

/** Hard ceiling on rows persisted per shop per pass — bounds DB writes and prompt size. */
export const MAX_COMPETITORS_PER_SHOP = 25;

/** Models in the web_grounded chain that can actually ground on live web data. */
const GROUNDED_MODELS: ReadonlySet<string> = new Set(
  MODEL_CATALOG.web_grounded.filter((m) => m.grounded).map((m) => m.model),
);

/** Providers that own at least one grounded candidate in the web_grounded chain. */
const GROUNDED_PROVIDERS: ReadonlySet<Provider> = new Set(
  MODEL_CATALOG.web_grounded.filter((m) => m.grounded).map((m) => m.provider),
);

/**
 * True when at least one grounded provider is in the enabled allowlist. This is the discovery
 * gate: with only Anthropic enabled (G5 not cleared) there is no grounded provider, so discovery
 * degrades to nothing rather than fabricating competitors via the ungrounded Anthropic tail.
 * Exported for the activation readiness check + tests.
 */
export function groundedDiscoveryEnabled(enabled: readonly Provider[]): boolean {
  return enabled.some((p) => GROUNDED_PROVIDERS.has(p));
}

/** Stable dedup key for UNIQUE(shop_id, normalized_name): lowercase, alnum-collapsed, trimmed. */
export function normalizeCompetitorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Owning-shop context discovery needs to ground its search + geolocate candidates. */
export type DiscoveryShop = {
  id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  searchRadiusMiles: number | null;
};

/** A raw competitor candidate as returned by a discovery provider (pre-normalization). */
export type CompetitorCandidate = {
  name: string;
  website?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  placeId?: string | null;
};

/**
 * A discovery provider turns a shop into a list of grounded candidates. The default is the
 * web_grounded LLM router (makeGroundedDiscoveryProvider); a Yext-backed provider can be slotted
 * in later behind the same seam (shops already carry `yext_entity_id`). Returns [] to mean
 * "found nothing / not grounded / over budget" — never throws for those (fail-soft).
 */
export type DiscoveryProvider = (shop: DiscoveryShop) => Promise<CompetitorCandidate[]>;

/** The columns we upsert into `public.competitors` (snake_case mirror of the table). */
type CompetitorUpsertRow = {
  shop_id: string;
  name: string;
  normalized_name: string;
  type: "independent" | "consolidator";
  consolidator_group: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_miles: number | null;
  rating: number | null;
  review_count: number | null;
  website: string | null;
  place_id: string | null;
  source: CompetitorSource;
  raw: unknown;
  discovered_at: string;
  updated_at: string;
};

/**
 * Map one grounded candidate to an upsert row for a given shop. Pure (exported for tests):
 * normalizes the dedup key, classifies consolidator type via the registry, and geolocates the
 * straight-line distance from the shop when both coordinates are known.
 */
export function candidateToRow(
  shop: DiscoveryShop,
  candidate: CompetitorCandidate,
  source: CompetitorSource,
  discoveredAt: string,
): CompetitorUpsertRow {
  const { isConsolidator, group } = classifyConsolidator(candidate.name);
  const lat = candidate.latitude ?? null;
  const lon = candidate.longitude ?? null;
  const distanceMiles = haversineMiles(
    { latitude: shop.latitude, longitude: shop.longitude },
    { latitude: lat, longitude: lon },
  );
  return {
    shop_id: shop.id,
    name: candidate.name.trim(),
    normalized_name: normalizeCompetitorName(candidate.name),
    type: isConsolidator ? "consolidator" : "independent",
    consolidator_group: group,
    latitude: lat,
    longitude: lon,
    distance_miles: distanceMiles,
    rating: candidate.rating ?? null,
    review_count: candidate.reviewCount ?? null,
    website: candidate.website ?? null,
    place_id: candidate.placeId ?? null,
    source,
    raw: candidate,
    discovered_at: discoveredAt,
    updated_at: discoveredAt,
  };
}

/**
 * Dedup candidates by normalized name (keeping the first occurrence) and drop any with an empty
 * normalized key. A single provider response can repeat a shop; the DB unique key would collapse
 * them on conflict, but de-duping in-memory keeps the upsert batch clean + deterministic.
 */
export function dedupeCandidates(candidates: CompetitorCandidate[]): CompetitorCandidate[] {
  const seen = new Set<string>();
  const out: CompetitorCandidate[] = [];
  for (const c of candidates) {
    const key = normalizeCompetitorName(c.name ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// --- Default provider: the web_grounded LLM router -------------------------------------------

const discoverySchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string().min(1),
        website: z.string().nullable().optional(),
        latitude: z.number().nullable().optional(),
        longitude: z.number().nullable().optional(),
        rating: z.number().nullable().optional(),
        reviewCount: z.number().nullable().optional(),
        placeId: z.string().nullable().optional(),
      }),
    )
    .max(MAX_COMPETITORS_PER_SHOP),
});

const DISCOVERY_SYSTEM =
  "You are a competitive-intelligence researcher for an auto-body / collision-repair marketing " +
  "platform. Given one of our client shops and its location, find REAL competing body / collision " +
  "shops operating near it. Only return shops you can ground in a real, current public source " +
  "(maps listing, business directory, the shop's own site). Never invent shops, addresses, or " +
  "ratings; if you cannot ground a field, leave it null. If you find nothing credible, return an " +
  "empty list. Do not use em dashes.";

function buildDiscoveryPrompt(shop: DiscoveryShop): string {
  const where = [shop.city, shop.state].filter(Boolean).join(", ");
  const coords =
    shop.latitude != null && shop.longitude != null
      ? `coordinates ${shop.latitude}, ${shop.longitude}`
      : null;
  const radius = shop.searchRadiusMiles ?? 15;
  const lines = [
    `Our client shop: ${shop.name ?? "(unnamed body shop)"}.`,
    where ? `Location: ${where}.` : null,
    coords,
    `Find competing auto-body / collision-repair shops within about ${radius} miles.`,
    `Return up to ${MAX_COMPETITORS_PER_SHOP} competitors. For each, give the business name and, ` +
      "when grounded, its website, latitude, longitude, public rating (0-5), review count, and " +
      "maps place id. Exclude our own shop. Prefer the closest, most active competitors.",
  ].filter((l): l is string => Boolean(l));
  return lines.join("\n");
}

/**
 * Build the default grounded discovery provider. Routes the web_grounded profile through the
 * 16-01 router (G5 gate + month-to-date spend cap both apply). CRITICAL: it persists results only
 * when the WINNING model was genuinely grounded; if the router fell through to the ungrounded
 * Anthropic tail (e.g. the grounded vendor failed, or none was enabled), it returns [] so no
 * fabricated shop is ever written. Any router error degrades to [] as well.
 */
export function makeGroundedDiscoveryProvider(opts: {
  spendCapUsd?: number;
  monthToDateSpendUsd?: () => Promise<number> | number;
  userId?: string | null;
}): DiscoveryProvider {
  return async (shop: DiscoveryShop): Promise<CompetitorCandidate[]> => {
    try {
      const result = await route<z.infer<typeof discoverySchema>>(
        "web_grounded",
        { system: DISCOVERY_SYSTEM, prompt: buildDiscoveryPrompt(shop), schema: discoverySchema },
        {
          generate: gatewayGenerate,
          enabledProviders: resolveEnabledProviders(),
          logCall: makeRouterLogger({ shopId: shop.id, userId: opts.userId ?? null }),
          spendCapUsd: opts.spendCapUsd,
          monthToDateSpendUsd: opts.monthToDateSpendUsd,
        },
      );
      // Refuse anything that did not come from a genuinely grounded model — no fabrication.
      if (!GROUNDED_MODELS.has(result.model)) return [];
      const parsed = discoverySchema.safeParse(result.output);
      if (!parsed.success) return [];
      return parsed.data.competitors;
    } catch {
      // NoEnabledProviderError / AllCandidatesFailedError / SpendCapExceededError → degrade.
      return [];
    }
  };
}

// --- Orchestration -----------------------------------------------------------------------------

export type ShopDiscoveryOutcome = {
  shopId: string;
  /** "discovered": rows upserted. "empty": grounded but found nothing. "gated": no grounded
   *  provider (degrade-to-nothing). "failed": an error was contained. */
  status: "discovered" | "empty" | "gated" | "failed";
  candidatesFound: number;
  upserted: number;
  error?: string;
};

export type DiscoveryResult = {
  shopsProcessed: number;
  shopsWithDiscoveries: number;
  competitorsUpserted: number;
  gated: number;
  failed: number;
  outcomes: ShopDiscoveryOutcome[];
};

export type DiscoveryOptions = {
  /** Injected "now" (ISO) for deterministic discovered_at/updated_at stamping. */
  now?: string;
  /** Per-shop spend ceiling; defaults to env `INTEL_DISCOVERY_SPEND_CAP_USD` or $25. */
  spendCapUsd?: number;
  /** Source label for persisted rows. Default "web_grounded"; a Yext provider passes "yext". */
  source?: CompetitorSource;
};

/** Injectable seams so the orchestrator is unit-testable without a live router / DB. */
export type DiscoveryDeps = {
  /** Override the discovery provider (default: the grounded LLM router). */
  provider?: DiscoveryProvider;
  /** Override the enabled-provider read (default: resolveEnabledProviders from env). */
  enabledProviders?: readonly Provider[];
  /** Override the month-to-date spend reader (default: budget-reader over the service client). */
  monthToDateSpendUsd?: () => Promise<number> | number;
};

function resolveSpendCapUsd(opts: DiscoveryOptions): number {
  if (typeof opts.spendCapUsd === "number") return opts.spendCapUsd;
  const env = process.env.INTEL_DISCOVERY_SPEND_CAP_USD;
  const parsed = env == null ? NaN : Number(env);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DISCOVERY_SPEND_CAP_USD;
}

type ShopRow = {
  id: string;
  name: string | null;
  address_locality: string | null;
  address_region: string | null;
  latitude: number | null;
  longitude: number | null;
  search_radius_miles: number | null;
};

const SHOP_COLUMNS =
  "id, name, address_locality, address_region, latitude, longitude, search_radius_miles";

function rowToDiscoveryShop(row: ShopRow): DiscoveryShop {
  return {
    id: row.id,
    name: row.name,
    city: row.address_locality,
    state: row.address_region,
    latitude: row.latitude,
    longitude: row.longitude,
    searchRadiusMiles: row.search_radius_miles,
  };
}

/**
 * Discover + upsert competitors for a SINGLE shop. Service-role client (RLS bypassed); the
 * caller (cron/activation) must gate access. Tenant-scoped: every row carries this `shopId` and
 * the upsert conflict key is (shop_id, normalized_name). Never throws on a provider miss — only
 * propagates a DB error so the batch wrapper can contain it.
 */
export async function discoverCompetitorsForShop(
  service: SupabaseClient,
  shop: DiscoveryShop,
  provider: DiscoveryProvider,
  opts: { now: string; source: CompetitorSource },
): Promise<ShopDiscoveryOutcome> {
  const candidates = dedupeCandidates(await provider(shop)).slice(0, MAX_COMPETITORS_PER_SHOP);
  if (candidates.length === 0) {
    return { shopId: shop.id, status: "empty", candidatesFound: 0, upserted: 0 };
  }

  const rows = candidates.map((c) => candidateToRow(shop, c, opts.source, opts.now));
  const { error } = await service
    .from("competitors")
    .upsert(rows, { onConflict: "shop_id,normalized_name" });
  if (error) {
    throw new Error(`[competitor-discovery] upsert failed for shop ${shop.id}: ${error.message}`);
  }
  return {
    shopId: shop.id,
    status: "discovered",
    candidatesFound: candidates.length,
    upserted: rows.length,
  };
}

/**
 * Run one discovery pass across every shop. Service-role client (RLS bypassed); gate the CALLER
 * (cron secret / superadmin). When no grounded provider is enabled (G5 not cleared) the whole
 * pass degrades to nothing: zero spend, zero rows, every shop marked "gated". Otherwise each shop
 * is discovered under the per-shop spend cap (re-read per shop against the shared ledger, so the
 * pass total is bounded). A single shop's failure is contained; the batch continues.
 */
export async function runCompetitorDiscovery(
  service: SupabaseClient,
  opts: DiscoveryOptions = {},
  deps: DiscoveryDeps = {},
): Promise<DiscoveryResult> {
  const now = opts.now ?? new Date().toISOString();
  const source = opts.source ?? "web_grounded";
  const enabled = deps.enabledProviders ?? resolveEnabledProviders();
  const spendCapUsd = resolveSpendCapUsd(opts);

  const result: DiscoveryResult = {
    shopsProcessed: 0,
    shopsWithDiscoveries: 0,
    competitorsUpserted: 0,
    gated: 0,
    failed: 0,
    outcomes: [],
  };

  const { data: shops, error: shopsErr } = await service.from("shops").select(SHOP_COLUMNS);
  if (shopsErr) {
    throw new Error(`[competitor-discovery] shop load failed: ${shopsErr.message}`);
  }

  // Degrade-to-nothing gate: without a grounded provider we never dispatch a metered call and
  // never write a row. Record each shop as "gated" so the run is observable, but spend stays $0.
  if (!groundedDiscoveryEnabled(enabled)) {
    for (const row of (shops ?? []) as ShopRow[]) {
      result.shopsProcessed += 1;
      result.gated += 1;
      result.outcomes.push({
        shopId: row.id,
        status: "gated",
        candidatesFound: 0,
        upserted: 0,
      });
    }
    return result;
  }

  const provider =
    deps.provider ??
    makeGroundedDiscoveryProvider({
      spendCapUsd,
      monthToDateSpendUsd: deps.monthToDateSpendUsd ?? (() => readMonthToDateSpend(service)),
    });

  for (const row of (shops ?? []) as ShopRow[]) {
    const shop = rowToDiscoveryShop(row);
    let outcome: ShopDiscoveryOutcome;
    try {
      outcome = await discoverCompetitorsForShop(service, shop, provider, { now, source });
    } catch (err) {
      outcome = {
        shopId: shop.id,
        status: "failed",
        candidatesFound: 0,
        upserted: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    result.shopsProcessed += 1;
    result.outcomes.push(outcome);
    if (outcome.status === "discovered") {
      result.shopsWithDiscoveries += 1;
      result.competitorsUpserted += outcome.upserted;
    } else if (outcome.status === "failed") {
      result.failed += 1;
    }
  }

  return result;
}
