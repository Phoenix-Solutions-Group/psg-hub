// W0 / PSG-249 — tests for the aggregate send-ledger ingestion + reconciliation.
//
// Three layers:
//   1. Synthetic CSV — pins parser/aggregate/reconcile semantics, always in CI.
//   2. The committed full ledger (docs/ops/mail/source/production-counts-ledger.full.csv,
//      counts only / PII-free) — proves the real source ingests (AC3 aggregate).
//   3. The real 2021-09-07 per-recipient batch (gitignored PII; on-disk only) —
//      reconciles envelope artifacts against the matching ledger row (AC1). Skips
//      when the operator data is absent.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseEnvelopeFilename,
  parseEnvelopeMarkdown,
} from "../parse-production-batch";
import {
  aggregatePieceVolumes,
  findMailingByProductionDate,
  foldVariantsToBase,
  LEDGER_PIECE_CODES,
  parseCsvRows,
  parseProductionCountsLedger,
  reconcilePieceCounts,
  renderAggregateVolumes,
} from "../production-counts-ledger";

// Two-row header + two mailings. Commas inside a quoted header are intentional
// (mirrors "07. Thank You, Warranty & Survey" in the real source).
const SYNTH_CSV = [
  'Production Date,Printed Date,,Mailed Date,,01. Survey Only,04. Thank You With Warranty ONLY,,,"07. Thank You, Warranty & Survey",,,,10. 3 Month,,T. Total Loss,',
  ",,,,,Survey,Letter,Warranty,Envelope,Letter,Warranty,Envelope,Survey,Letter,Envelope,Letter,Envelope",
  "08/12/21,08/10/21,0,08/16/21,2,5,100,100,100,200,200,200,200,50,50,1,1",
  "01/05/23,,,,,0,40,40,40,80,80,80,80,20,20,0,0",
  "06/23/26,,,,,0,0,0,0,0,0,0,0,0,0,0,0", // all-zero placeholder → skipped
].join("\n");

describe("parseCsvRows", () => {
  it("honors quoted fields with embedded commas", () => {
    const rows = parseCsvRows('a,"b,c",d\n1,2,3');
    expect(rows[0]).toEqual(["a", "b,c", "d"]);
    expect(rows[1]).toEqual(["1", "2", "3"]);
  });

  it("handles doubled-quote escapes", () => {
    expect(parseCsvRows('"he said ""hi""",x')[0]).toEqual(['he said "hi"', "x"]);
  });
});

describe("parseProductionCountsLedger (synthetic)", () => {
  const mailings = parseProductionCountsLedger(SYNTH_CSV);

  it("skips the all-zero placeholder row", () => {
    expect(mailings).toHaveLength(2);
    expect(mailings.map((m) => m.productionDate)).toEqual(["2021-08-12", "2023-01-05"]);
  });

  it("maps header columns to piece counts (max over components)", () => {
    const m = mailings[0];
    expect(m.pieceCounts).toEqual({ "01": 5, "04": 100, "07": 200, "10": 50, T: 1 });
    expect(m.total).toBe(356);
  });

  it("reads dates by label and tolerates a blank mailed date", () => {
    expect(mailings[0].mailedDate).toBe("2021-08-16");
    expect(mailings[0].printedDate).toBe("2021-08-10");
    expect(mailings[1].mailedDate).toBeNull();
  });

  it("returns [] for a too-short input", () => {
    expect(parseProductionCountsLedger("a,b\n1,2")).toEqual([]);
  });
});

describe("aggregatePieceVolumes (synthetic)", () => {
  const agg = aggregatePieceVolumes(parseProductionCountsLedger(SYNTH_CSV));

  it("sums per piece and per year", () => {
    expect(agg.byPiece["04"]).toBe(140);
    expect(agg.byPieceYear["04"]).toEqual({ "2021": 100, "2023": 40 });
    expect(agg.byYear).toEqual({ "2021": 356, "2023": 140 });
  });

  it("computes total pieces, mailings count and span", () => {
    expect(agg.totalPieces).toBe(496);
    expect(agg.totalMailings).toBe(2);
    expect(agg.dateRange).toEqual({ start: "2021-08-12", end: "2023-01-05" });
  });

  it("piece shares sum to 1", () => {
    const sum = LEDGER_PIECE_CODES.reduce((s, c) => s + (agg.pieceShare[c] ?? 0), 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe("foldVariantsToBase + reconcilePieceCounts", () => {
  it("folds 'b' alternates into the base code", () => {
    expect(foldVariantsToBase({ "04": 1, "04b": 153, "10": 388, "10b": 71, t: 1 })).toEqual({
      "04": 154,
      "10": 459,
      T: 1,
    });
  });

  it("flags an exact match and a per-piece delta", () => {
    const [m] = parseProductionCountsLedger(SYNTH_CSV);
    const exact = reconcilePieceCounts({ "04": 100, "07": 200, "10": 50, "01": 5, T: 1 }, m);
    expect(exact.matched).toBe(true);
    expect(exact.totalDelta).toBe(0);

    const short = reconcilePieceCounts({ "04": 99, "07": 200, "10": 50, "01": 5, T: 1 }, m);
    expect(short.matched).toBe(false);
    expect(short.perPiece.find((p) => p.piece === "04")?.delta).toBe(-1);
    expect(short.totalDelta).toBe(-1);
  });
});

describe("renderAggregateVolumes", () => {
  it("renders mix + by-year tables and an AC1 reconciliation block", () => {
    const mailings = parseProductionCountsLedger(SYNTH_CSV);
    const agg = aggregatePieceVolumes(mailings);
    const recon = reconcilePieceCounts({ "04": 100, "07": 200, "10": 50, "01": 5, T: 1 }, mailings[0]);
    const doc = renderAggregateVolumes(agg, { computedAt: "2026-06-23", sourceLabel: "synthetic" }, recon);
    expect(doc).toContain("# Direct-mail aggregate volume priors");
    expect(doc).toContain("## Piece mix (volume prior)");
    expect(doc).toContain("## Volume by year");
    expect(doc).toContain("## AC1 reconciliation");
  });
});

// ── The committed full ledger (counts only; always present in CI) ─────────────
const FULL_LEDGER = path.resolve(
  __dirname,
  "../../../../../../../docs/ops/mail/source/production-counts-ledger.full.csv",
);

describe.skipIf(!existsSync(FULL_LEDGER))("real aggregate ledger (committed)", () => {
  const mailings = parseProductionCountsLedger(readFileSync(FULL_LEDGER, "utf8"));

  it("ingests the full Mail-House-era series", () => {
    expect(mailings.length).toBeGreaterThan(450);
    expect(mailings[0].productionDate).toBe("2021-08-10");
    const agg = aggregatePieceVolumes(mailings);
    // Real totals locked from the source (715,177 pieces across the program).
    expect(agg.totalPieces).toBe(715177);
    expect(agg.byPiece["07"]).toBe(193958);
    expect(agg.byPiece["14"]).toBe(184042);
    expect(agg.dateRange.start).toBe("2021-08-10");
  });

  it("carries the 2021-09-07 reconciliation target row", () => {
    const m = findMailingByProductionDate(mailings, "2021-09-07");
    expect(m).not.toBeNull();
    expect(m?.pieceCounts).toEqual({
      "04": 154,
      "07": 246,
      "10": 459,
      "12": 11,
      "13": 2,
      "14": 527,
      "15": 316,
      "16": 64,
      T: 1,
    });
    expect(m?.total).toBe(1780);
  });
});

// ── AC1: real per-recipient batch reconciled vs the ledger row ────────────────
const SAMPLE_DIR = path.resolve(
  __dirname,
  "../../../../../../../docs/psg/production-center/production-files-sample/2021-09-07",
);
const hasSample = existsSync(SAMPLE_DIR) && existsSync(FULL_LEDGER);

describe.skipIf(!hasSample)("AC1 reconciliation — 2021-09-07 batch vs ledger", () => {
  it("reconciles every piece exactly except the letter-only 04 (no envelope artifact)", () => {
    // Count recipients per piece from the envelope artifacts (PSG-223 parser),
    // folding 'b' A/B alternates into their base as the ledger records them.
    const raw: Record<string, number> = {};
    for (const f of readdirSync(SAMPLE_DIR)) {
      const meta = parseEnvelopeFilename(f);
      if (!meta || meta.pieceVariant !== "envelope") continue;
      const n = parseEnvelopeMarkdown(readFileSync(path.join(SAMPLE_DIR, f), "utf8")).length;
      raw[meta.pieceCode] = (raw[meta.pieceCode] ?? 0) + n;
    }
    const observed = foldVariantsToBase(raw);

    const mailings = parseProductionCountsLedger(readFileSync(FULL_LEDGER, "utf8"));
    const ledgerRow = findMailingByProductionDate(mailings, "2021-09-07");
    expect(ledgerRow).not.toBeNull();

    const report = reconcilePieceCounts(observed, ledgerRow!);

    // 8 pieces match exactly; only 04 is short by 1 — its envelope artifact is
    // absent from the sample batch (only its letter is present). That single
    // letter-only recipient is the entire gap between 1779 parsed and 1780 ledger.
    const mismatches = report.perPiece.filter((p) => p.delta !== 0);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ piece: "04", observed: 153, ledger: 154, delta: -1 });

    expect(report.observedTotal).toBe(1779); // PSG-223 raw envelope recipients
    expect(report.ledgerTotal).toBe(1780);
    expect(report.totalDelta).toBe(-1);
  });
});
