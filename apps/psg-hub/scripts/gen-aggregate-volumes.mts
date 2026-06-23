// W0 / PSG-249 — regenerate docs/ops/mail/priors/aggregate-volumes.md from the
// committed aggregate ledger. If the gitignored 2021-09-07 per-recipient batch is
// present, also append the AC1 reconciliation block (envelope artifacts vs ledger).
//
// Run: pnpm --filter psg-hub exec tsx scripts/gen-aggregate-volumes.mts [ISO_DATE]
// `computedAt` is passed in (no clock in the pure renderer) and defaults to the
// date below so regeneration is reproducible.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseEnvelopeFilename,
  parseEnvelopeMarkdown,
} from "../src/lib/ops/mail/parse-production-batch";
import {
  aggregatePieceVolumes,
  findMailingByProductionDate,
  foldVariantsToBase,
  parseProductionCountsLedger,
  reconcilePieceCounts,
  renderAggregateVolumes,
} from "../src/lib/ops/mail/production-counts-ledger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const computedAt = process.argv[2] ?? "2026-06-23";

const ledgerPath = path.join(
  repoRoot,
  "docs/ops/mail/source/production-counts-ledger.full.csv",
);
const mailings = parseProductionCountsLedger(readFileSync(ledgerPath, "utf8"));
const agg = aggregatePieceVolumes(mailings);

const batchDir = path.join(
  repoRoot,
  "docs/psg/production-center/production-files-sample/2021-09-07",
);
let reconciliation;
if (existsSync(batchDir)) {
  const raw: Record<string, number> = {};
  for (const f of readdirSync(batchDir)) {
    const meta = parseEnvelopeFilename(f);
    if (!meta || meta.pieceVariant !== "envelope") continue;
    const n = parseEnvelopeMarkdown(readFileSync(path.join(batchDir, f), "utf8")).length;
    raw[meta.pieceCode] = (raw[meta.pieceCode] ?? 0) + n;
  }
  const row = findMailingByProductionDate(mailings, "2021-09-07");
  if (row) reconciliation = reconcilePieceCounts(foldVariantsToBase(raw), row);
}

const doc = renderAggregateVolumes(
  agg,
  {
    computedAt,
    sourceLabel:
      "Production Counts_PSG + The Mail House (docs/ops/mail/source/production-counts-ledger.full.csv)",
  },
  reconciliation,
);

const outPath = path.join(repoRoot, "docs/ops/mail/priors/aggregate-volumes.md");
writeFileSync(outPath, `${doc}\n`);
console.log(
  `wrote ${path.relative(repoRoot, outPath)} — ${agg.totalMailings} mailings, ${agg.totalPieces} pieces` +
    (reconciliation ? ` (+ AC1 reconciliation, Δ=${reconciliation.totalDelta})` : " (batch absent → no AC1 block)"),
);
