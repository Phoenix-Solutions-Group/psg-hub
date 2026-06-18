// v1.4 / PSG-28 — Operational Reports: the parameterized runner.
// Resolves a definition's rows for given params, choosing the live data path
// (real `run` against ctx.db) or the sample-data path (B1 ops tables not yet
// live, or no db in context). Pure orchestration — no IO of its own.

import type {
  ReportContext,
  ReportDefinition,
  ReportParams,
  ReportResult,
} from "./types";

/**
 * Execute a report. Uses the live `run()` only when the report's backing data
 * exists (`dataStatus === 'available'`) AND a db client is present; otherwise it
 * serves deterministic sample rows and flags the result `sample: true`.
 *
 * Live `run()` failures degrade to sample data rather than throwing, so a
 * single mis-wired report can never take down the whole reports surface; the
 * `sample` flag still tells the UI/export the rows are illustrative.
 */
export async function runReport(
  def: ReportDefinition,
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportResult> {
  const canRunLive = def.dataStatus === "available" && !!def.run && !!ctx.db;

  let rows = def.sampleRows(params);
  let sample = true;

  if (canRunLive) {
    try {
      rows = await def.run!(params, ctx);
      sample = false;
    } catch (err) {
      console.error(
        `[ops/reports] live run failed for "${def.slug}", serving sample:`,
        err instanceof Error ? err.message : err,
      );
      rows = def.sampleRows(params);
      sample = true;
    }
  }

  return {
    columns: def.columns,
    rows,
    totals: null,
    sample,
    generatedAt: ctx.generatedAt,
  };
}
