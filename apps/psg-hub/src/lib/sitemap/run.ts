// Wave 1A / PSG-258 — Production entry point for the sitemap & content-architecture run.
//
// The single server-only orchestrator that turns a shopId into a finished SitemapPackage
// (or a queued checkpoint). It mirrors intel/report/run.ts: read the shop's persisted row +
// competitors, build a ShopBrief, wire the engine's pure seams (pipeline.ts) to the live
// providers (PSG-236), and run the gated pipeline. The two human gates are bound to the
// poll-based approval queue (checkpoint.ts); on a fully-approved run the package is persisted
// to research_artifacts and an audit row is written.
//
// METERING / G5: the content-gap + cluster-refine seams call the intel multi-LLM router via
// an injected `complete` (StructuredCompletion), so they inherit the SAME budget/G5 gating as
// the competitor report — pre-G5 they degrade to null (no spend) and the run is fully
// deterministic (deterministic keyword baseline + deterministic clusterer). That determinism
// is what makes the poll-gate's content hash stable across the approval round-trip.
//
// KEYWORD SOURCE (open question for Ada, resolved to the safe default): Semrush
// keyword_research / organic_research are agent-runtime MCP tools, NOT callable from deployed
// server code, and the seo-* fallbacks are the same. So the live KeywordProvider is wired with
// an EMPTY live-source chain → it degrades to the zero-cost deterministic baseline. No new
// SEMRUSH_API_KEY keyword surface is introduced here (option (b)); when a seat + G5 land, a
// follow-up wires the live sources (and must snapshot the universe for hash stability).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { route } from "@/lib/intel/router";
import { gatewayGenerate } from "@/lib/intel/gateway";
import { resolveEnabledProviders, makeRouterLogger } from "@/lib/intel/server";
import { monthToDateSpendUsd } from "@/lib/intel/budget-reader";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { runSitemapPipeline } from "./pipeline";
import {
  makeKeywordProvider,
  makeContentGapProvider,
  makeClusterRefiner,
  type StructuredCompletion,
} from "./providers";
import { persistSitemapPackage, type PersistedSitemap } from "./persistence";
import {
  makeCheckpointGate,
  supabaseCheckpointStore,
  type CheckpointStore,
  type GateStop,
} from "./checkpoint";
import { shopBriefSchema, type ShopBrief, type SitemapPackage } from "./types";

const DEFAULT_SPEND_CAP_USD = 200;

/** The shop columns the brief is built from (a subset of the shops projection). */
const SHOP_COLUMNS = "id, name, url, address_locality, address_region";

type ShopRow = {
  id: string;
  name: string | null;
  url: string | null;
  address_locality: string | null;
  address_region: string | null;
};

/** Build the ShopBrief that drives the run from a shop row + its competitor names. */
export function buildShopBrief(shop: ShopRow, competitorNames: string[]): ShopBrief {
  const locations =
    shop.address_locality && shop.address_region
      ? [{ city: shop.address_locality, state: shop.address_region, primary: true }]
      : [];
  return shopBriefSchema.parse({
    shopId: shop.id,
    businessName: shop.name?.trim() || "Body Shop",
    domain: shop.url?.trim() || null,
    // BSM is auto-body / collision-repair native: the 8-persona collision vertical applies.
    vertical: "collision_repair",
    services: [],
    locations,
    competitors: competitorNames,
  });
}

/**
 * Build a `StructuredCompletion` from the intel multi-LLM router. Returns the validated
 * object, or null when the call can't be served (no enabled provider pre-G5, spend cap hit,
 * all candidates failed) — so the providers degrade to empty enrichment, never throw.
 */
export function makeRouterCompletion(opts: {
  service: SupabaseClient;
  shopId: string;
  userId?: string | null;
  spendCapUsd: number;
}): StructuredCompletion {
  return async <T>(args: { system: string; prompt: string; schema: z.ZodType<T> }): Promise<T | null> => {
    try {
      const result = await route(
        "reasoning",
        { system: args.system, prompt: args.prompt, schema: args.schema as unknown },
        {
          generate: gatewayGenerate,
          enabledProviders: resolveEnabledProviders(),
          logCall: makeRouterLogger({ shopId: opts.shopId, userId: opts.userId ?? null }),
          spendCapUsd: opts.spendCapUsd,
          monthToDateSpendUsd: () => monthToDateSpendUsd(opts.service),
        },
      );
      const parsed = args.schema.safeParse(result.output);
      return parsed.success ? parsed.data : null;
    } catch {
      // NoEnabledProviderError / AllCandidatesFailedError / SpendCapExceededError → degrade.
      return null;
    }
  };
}

export type SitemapRunOutcome =
  | { status: "complete"; package: SitemapPackage; persisted: PersistedSitemap }
  | { status: "awaiting_approval"; stop: GateStop }
  | { status: "changes_requested"; stop: GateStop }
  | { status: "no_shop" };

export type RunSitemapOptions = {
  service: SupabaseClient;
  shopId: string;
  userId?: string | null;
  now?: string;
  spendCapUsd?: number;
  /** Injected for tests; defaults to the supabase-backed approval queue. */
  checkpointStore?: CheckpointStore;
};

/**
 * Run the gated sitemap pipeline for one shop. Service-role client (RLS bypassed) — gate the
 * CALLER on superadmin. Returns `complete` (package persisted + audited), `awaiting_approval`
 * (a gate is queued for sign-off), `changes_requested` (a human asked for changes), or
 * `no_shop`. Every terminal outcome writes an audit row attributing the run to the actor.
 */
export async function runSitemap(opts: RunSitemapOptions): Promise<SitemapRunOutcome> {
  const { service, shopId } = opts;
  const generatedAt = opts.now ?? new Date().toISOString();
  const spendCapUsd = opts.spendCapUsd ?? DEFAULT_SPEND_CAP_USD;

  const { data: shop, error: shopErr } = await service
    .from("shops")
    .select(SHOP_COLUMNS)
    .eq("id", shopId)
    .maybeSingle();
  if (shopErr) throw new Error(`runSitemap: shop read failed: ${shopErr.message}`);
  if (!shop) return { status: "no_shop" };

  const { data: compRows, error: compErr } = await service
    .from("competitors")
    .select("name")
    .eq("shop_id", shopId);
  if (compErr) throw new Error(`runSitemap: competitors read failed: ${compErr.message}`);
  const competitorNames = [
    ...new Set(
      ((compRows ?? []) as { name: string | null }[])
        .map((r) => r.name?.trim())
        .filter((n): n is string => !!n),
    ),
  ];

  const brief = buildShopBrief(shop as ShopRow, competitorNames);

  const complete = makeRouterCompletion({ service, shopId, userId: opts.userId, spendCapUsd });
  const store = opts.checkpointStore ?? supabaseCheckpointStore(service);
  const gate = makeCheckpointGate({
    store,
    shopId,
    requestedByProfileId: opts.userId ?? null,
    now: () => generatedAt,
  });

  const result = await runSitemapPipeline(brief, {
    generatedAt,
    // Live-source chain is empty pre-seat → deterministic baseline (see header note).
    keywordProvider: makeKeywordProvider([]),
    // No firecrawl/GSC crawl wired from server code yet → greenfield/no inventory.
    contentGapProvider: makeContentGapProvider({ complete }),
    clusterRefiner: makeClusterRefiner({ complete }),
    onCheckpoint: gate.handler,
  });

  if (result.status === "changes_requested") {
    const stop = gate.getStop();
    const outcome = stop?.kind === "rejected" ? "changes_requested" : "awaiting_approval";
    await audit(opts.userId, shopId, {
      outcome,
      phase: result.phase,
      contentHash: stop?.contentHash ?? null,
    });
    // `stop` is always set here (the engine only returns changes_requested from a gate).
    return stop?.kind === "rejected"
      ? { status: "changes_requested", stop }
      : { status: "awaiting_approval", stop: stop as GateStop };
  }

  const persisted = await persistSitemapPackage(service, shopId, result.package);
  await audit(opts.userId, shopId, {
    outcome: "complete",
    artifactId: persisted.id,
    pages: countPages(result.package.root),
  });
  return { status: "complete", package: result.package, persisted };
}

async function audit(
  userId: string | null | undefined,
  shopId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!userId) return; // a system/cron run with no actor can't write an attributable row
  await recordAuditEvent({
    actorProfileId: userId,
    action: "sitemap.run",
    targetShopId: shopId,
    payload: { shopId, ...payload },
  });
}

function countPages(node: { children: { children: unknown[] }[] }): number {
  return 1 + node.children.reduce((n, c) => n + countPages(c as typeof node), 0);
}

export { supabaseCheckpointStore };
