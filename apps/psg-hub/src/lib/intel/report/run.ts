// v1.6 / 17-B (PSG-177b) — Production entry point for the competitor intelligence report.
// The single server-only orchestrator that turns a shopId into a rendered report. It wires the
// pure assembler (report-data.ts) to the live, metered seams: it reads the shop's persisted
// `competitors` + `competitor_scores` via the service client, runs the (G5-gated) grounded
// research step, then the grounded narrative writer — both threaded with the live month-to-date
// spend cap from budget-reader.ts so the $200 ceiling is enforced against real ledger spend.
// Every metered failure degrades to the pending-activation notice inside the assembler, so this
// never throws on a provider/cap outage; it only throws on a DB read error (fail-closed).
//
// SEQUENCING (the "assemble twice" option from the plan): the research + narrative steps need the
// already-ranked top-N (the same list the report shows), so we assemble once with no narrator to
// get `summary` + `rankedCompetitors`, run research on THAT, then assemble again with the narrator
// wired (cheap + pure — no extra IO). This reuses the assembler's exact top-N slice rather than
// re-deriving a NarrativeInput here, so the grounded prose can never drift from the rendered table.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToCompetitor } from "../competitor/sync";
import type { Competitor, CompetitorScore } from "../competitor/types";
import { monthToDateSpendUsd } from "../budget-reader";
import { assembleCompetitorReport, type NarrativeInput } from "./report-data";
import { renderCompetitorReportHtml } from "./render";
import { makeNarrativeGenerator } from "./server";
import { makeGroundedResearcher } from "./research";
import type { CompetitorReport } from "./types";

const DEFAULT_SPEND_CAP_USD = 200;

/** The `competitor_scores` columns this report needs (mirror of sync.ts `scoreToRow`). */
type CompetitorScoreRow = {
  competitor_id: string;
  shop_id: string;
  threat_score: number | null;
  proximity_score: number | null;
  presence_score: number | null;
  consolidator_weight: number | null;
  rank: number | null;
  rationale: string | null;
};

/** Pure row → domain mapper, the inverse of sync.ts `scoreToRow`. */
export function rowToScore(row: CompetitorScoreRow): CompetitorScore {
  return {
    competitorId: row.competitor_id,
    shopId: row.shop_id,
    threatScore: Number(row.threat_score ?? 0),
    proximityScore: Number(row.proximity_score ?? 0),
    presenceScore: Number(row.presence_score ?? 0),
    consolidatorWeight: Number(row.consolidator_weight ?? 1),
    rank: Number(row.rank ?? 0),
    rationale: row.rationale ?? "",
  };
}

/** The columns `rowToCompetitor` consumes (same projection sync.ts reads). */
const COMPETITOR_COLUMNS =
  "id, shop_id, name, type, consolidator_group, latitude, longitude, distance_miles, rating, review_count, website, source";
const SCORE_COLUMNS =
  "competitor_id, shop_id, threat_score, proximity_score, presence_score, consolidator_weight, rank, rationale";

/**
 * Run the competitor intelligence report for one shop, end to end, and return the assembled
 * payload plus its rendered HTML. Service-role client (RLS bypassed) — gate the CALLER on
 * superadmin/ops access. `spendCapUsd` defaults to $200; `now` is injected for deterministic
 * stamping. When the shop has no scored competitors the metered research/narrative steps are
 * skipped entirely (no vendor spend on an empty set) and the report assembles with the
 * pending-activation notice; the caller can detect this via `report.summary.totalCompetitors`.
 */
export async function runCompetitorReport(opts: {
  service: SupabaseClient;
  shopId: string;
  userId?: string | null;
  now?: string;
  spendCapUsd?: number;
}): Promise<{ report: CompetitorReport; html: string }> {
  const { service, shopId } = opts;
  const generatedAt = opts.now ?? new Date().toISOString();
  const spendCapUsd = opts.spendCapUsd ?? DEFAULT_SPEND_CAP_USD;

  const { data: compRows, error: compErr } = await service
    .from("competitors")
    .select(COMPETITOR_COLUMNS)
    .eq("shop_id", shopId);
  if (compErr) {
    throw new Error(`runCompetitorReport: competitors read failed: ${compErr.message}`);
  }

  const { data: scoreRows, error: scoreErr } = await service
    .from("competitor_scores")
    .select(SCORE_COLUMNS)
    .eq("shop_id", shopId);
  if (scoreErr) {
    throw new Error(`runCompetitorReport: competitor_scores read failed: ${scoreErr.message}`);
  }

  const competitors: Competitor[] = ((compRows ?? []) as Parameters<typeof rowToCompetitor>[0][]).map(
    rowToCompetitor,
  );
  const scores: CompetitorScore[] = ((scoreRows ?? []) as CompetitorScoreRow[]).map(rowToScore);

  // No scored competitors → nothing to ground. Assemble the (empty) deterministic report with
  // the pending notice and spend nothing; the route turns totalCompetitors===0 into a 404.
  if (scores.length === 0) {
    const report = await assembleCompetitorReport(competitors, scores, { generatedAt });
    return { report, html: renderCompetitorReportHtml(report) };
  }

  const mtd = () => monthToDateSpendUsd(service);

  // Pass 1: assemble with no narrator to get the deterministic summary + top-N list to ground on.
  const base = await assembleCompetitorReport(competitors, scores, { generatedAt });
  const researchInput: NarrativeInput = {
    shopId: base.shopId,
    summary: base.summary,
    topCompetitors: base.rankedCompetitors,
  };

  const research = makeGroundedResearcher({ shopId, userId: opts.userId, spendCapUsd, monthToDateSpendUsd: mtd });
  const researchNotes = (await research(researchInput))?.signals ?? undefined;

  const narrate = makeNarrativeGenerator({
    shopId,
    userId: opts.userId,
    spendCapUsd,
    monthToDateSpendUsd: mtd,
    researchNotes,
  });

  // Pass 2: re-assemble (cheap + pure) with the narrator wired so the prose grounds in the same numbers.
  const report = await assembleCompetitorReport(competitors, scores, { generatedAt, narrate });
  return { report, html: renderCompetitorReportHtml(report) };
}
