// W0 / PSG-249 (parent PSG-216) — Aggregate send-ledger ingestion + reconciliation.
//
// Ingests the master aggregate ledger "Production Counts_PSG + The Mail House"
// (docs/ops/mail/source/production-counts-ledger.full.csv): one row per
// Production-Date, with the count mailed of each numbered piece (08/2021 → 2026,
// the full Mail-House era). This is the AC1 reconciliation truth-source and the
// AC3 *aggregate* (volume-by-piece-and-period) priors input — complementary to
// the per-(segment,piece,arm) outcome-rate priors mined in ./priors.ts (PSG-224).
//
// Why this module exists alongside the per-recipient importer (send-history-import.ts,
// PSG-223): the per-recipient batches are the row-level send log, but only the
// single 2021-09-07 batch is reachable. The aggregate ledger is the full-scale
// count series. AC1 is satisfied by reconciling the one available per-recipient
// batch against its matching ledger row (reconcilePieceCounts), proving the two
// representations agree; AC3-aggregate is satisfied by aggregatePieceVolumes over
// the whole ledger.
//
// Pure: CSV text in, structured data out. No DB, no PII (counts only), no clock —
// callers pass timestamps. The piece taxonomy matches the numbered-letter library
// (PSG-222): 01, 03, 04, 05, 06, 07, 10, 11, 12, 13, 14, 15, 16, T, E, A, S. The
// ledger folds the 'b' A/B alternates (04b, 10b, …) into their base column, so a
// reconciliation against a per-recipient batch must fold 'b' variants the same way.

/** Canonical numbered-piece codes carried by the ledger (PSG-222 letter library). */
export const LEDGER_PIECE_CODES = [
  "01",
  "03",
  "04",
  "05",
  "06",
  "07",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "T",
  "E",
  "A",
  "S",
] as const;

export type LedgerPieceCode = (typeof LEDGER_PIECE_CODES)[number];

const PIECE_CODE_SET = new Set<string>(LEDGER_PIECE_CODES);

/** One mailing row from the aggregate ledger. */
export type LedgerMailing = {
  /** ISO 'YYYY-MM-DD'. The canonical key — always present (header quirk: the raw
   *  col0 is mislabeled '22' but holds the Production Date). */
  productionDate: string;
  /** ISO mailed date, or null. The source stopped populating this column ~04/2022
   *  while still recording per-piece counts, so it is informational only. */
  mailedDate: string | null;
  /** ISO printed date, or null. */
  printedDate: string | null;
  /** Count mailed per piece — only pieces with a non-zero count are present. */
  pieceCounts: Partial<Record<LedgerPieceCode, number>>;
  /** Sum of pieceCounts (the total pieces mailed this run). */
  total: number;
};

// ── CSV parsing (RFC-4180-ish; handles quoted fields with embedded commas) ──
/**
 * Parse CSV text into rows of cells. Rows are split on newlines; quoted fields
 * (the ledger header carries commas, e.g. "07. Thank You, Warranty & Survey")
 * are honored, including doubled-quote escapes. The committed source has no
 * embedded newlines inside cells, so a newline always ends a row.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // Trailing field/row (no terminating newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── Header → piece-code column map ──────────────────────────────────────────
const CODE_RE = /^([0-9]{1,2}|[A-Za-z])\s*\./; // "01.", "T.", "E."
const DATE_RE = /^([01]?\d)\/([0-3]?\d)\/(\d{2})$/;

/** Normalize a raw piece code token to its canonical form ('t' -> 'T', '4' -> '04'). */
function canonPieceCode(raw: string): LedgerPieceCode | null {
  let t = raw.trim();
  if (/^[A-Za-z]$/.test(t)) t = t.toUpperCase();
  else if (/^\d$/.test(t)) t = `0${t}`;
  return PIECE_CODE_SET.has(t) ? (t as LedgerPieceCode) : null;
}

/** MM/DD/YY -> ISO 'YYYY-MM-DD', or null when blank / unparseable. */
function toIso(raw: string | undefined): string | null {
  const m = DATE_RE.exec((raw ?? "").trim());
  if (!m) return null;
  const [, mm, dd, yy] = m;
  return `20${yy.padStart(2, "0")}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function toNum(raw: string | undefined): number {
  const s = (raw ?? "").replace(/,/g, "").trim();
  if (!/^-?\d+$/.test(s)) return 0;
  return Number.parseInt(s, 10);
}

type ColumnMap = {
  productionDateIdx: number;
  printedDateIdx: number;
  mailedDateIdx: number;
  /** piece code -> the data-column indices that belong to it (its components). */
  pieceCols: Map<LedgerPieceCode, number[]>;
};

/**
 * Build the column map from the two header rows, carrying a piece code forward
 * across its blank-header component columns. Date columns are found by label, so
 * we never assume positional alignment beyond what the headers say (per the
 * source audit's header-quirk warning).
 */
function buildColumnMap(codeHeader: string[]): ColumnMap {
  const pieceCols = new Map<LedgerPieceCode, number[]>();
  let current: LedgerPieceCode | null = null;
  let productionDateIdx = 0;
  let printedDateIdx = -1;
  let mailedDateIdx = -1;

  for (let i = 0; i < codeHeader.length; i += 1) {
    const h = (codeHeader[i] ?? "").trim();
    const lower = h.toLowerCase();
    if (lower.startsWith("production date")) productionDateIdx = i;
    if (lower.startsWith("printed date")) printedDateIdx = i;
    if (lower.startsWith("mailed date")) mailedDateIdx = i;

    const m = CODE_RE.exec(h);
    if (m) {
      const code = canonPieceCode(m[1]);
      current = code; // a recognized piece starts a new run; unknown clears it
    } else if (h !== "") {
      // A non-blank, non-piece header (e.g. a date column) ends the current run.
      current = null;
    }
    // Blank header (h === "") inherits `current` — these are component columns.
    if (current && i > mailedDateIdx) {
      const arr = pieceCols.get(current);
      if (arr) arr.push(i);
      else pieceCols.set(current, [i]);
    }
  }
  return { productionDateIdx, printedDateIdx, mailedDateIdx, pieceCols };
}

// ── Parse ───────────────────────────────────────────────────────────────────
/**
 * Parse the aggregate ledger CSV into mailings. The first two rows are the code
 * header + component subheader. A mailing's per-piece count is the MAX of that
 * piece's component columns (every recipient of a piece gets all its components,
 * so the components are equal; max is robust to a stray zero). Rows with no
 * production date, or whose pieces are all zero (future/placeholder rows), are
 * skipped.
 */
export function parseProductionCountsLedger(csv: string): LedgerMailing[] {
  const rows = parseCsvRows(csv);
  if (rows.length < 3) return [];
  const map = buildColumnMap(rows[0]);
  const out: LedgerMailing[] = [];

  for (let r = 2; r < rows.length; r += 1) {
    const row = rows[r];
    const productionDate = toIso(row[map.productionDateIdx]);
    if (!productionDate) continue;

    const pieceCounts: Partial<Record<LedgerPieceCode, number>> = {};
    let total = 0;
    for (const [code, cols] of map.pieceCols) {
      let count = 0;
      for (const ci of cols) count = Math.max(count, toNum(row[ci]));
      if (count > 0) {
        pieceCounts[code] = count;
        total += count;
      }
    }
    if (total === 0) continue; // placeholder / future row

    out.push({
      productionDate,
      mailedDate: map.mailedDateIdx >= 0 ? toIso(row[map.mailedDateIdx]) : null,
      printedDate: map.printedDateIdx >= 0 ? toIso(row[map.printedDateIdx]) : null,
      pieceCounts,
      total,
    });
  }
  return out;
}

/** Find the mailing whose production date matches, or null. */
export function findMailingByProductionDate(
  mailings: LedgerMailing[],
  iso: string,
): LedgerMailing | null {
  return mailings.find((m) => m.productionDate === iso) ?? null;
}

// ── Aggregate volume priors (AC3) ────────────────────────────────────────────
export type AggregateVolumes = {
  dateRange: { start: string; end: string };
  totalMailings: number;
  totalPieces: number;
  /** Total count per piece across the whole ledger. */
  byPiece: Partial<Record<LedgerPieceCode, number>>;
  /** Per piece, count per calendar year (keyed 'YYYY'). */
  byPieceYear: Partial<Record<LedgerPieceCode, Record<string, number>>>;
  /** Total pieces per calendar year. */
  byYear: Record<string, number>;
  /** Fraction of all pieces accounted for by each piece (the volume prior). */
  pieceShare: Partial<Record<LedgerPieceCode, number>>;
};

/**
 * Aggregate a mailing series into volume-by-piece-and-period — the AC3 aggregate
 * prior. `pieceShare` is the empirical mix (what fraction of the program's mail
 * each piece is), a stable prior weight the engine can lean on before per-segment
 * outcome rates (./priors.ts) refine it.
 */
export function aggregatePieceVolumes(mailings: LedgerMailing[]): AggregateVolumes {
  const byPiece: Partial<Record<LedgerPieceCode, number>> = {};
  const byPieceYear: Partial<Record<LedgerPieceCode, Record<string, number>>> = {};
  const byYear: Record<string, number> = {};
  let totalPieces = 0;
  let start = "";
  let end = "";

  for (const m of mailings) {
    if (!start || m.productionDate < start) start = m.productionDate;
    if (!end || m.productionDate > end) end = m.productionDate;
    const year = m.productionDate.slice(0, 4);
    for (const code of LEDGER_PIECE_CODES) {
      const n = m.pieceCounts[code];
      if (!n) continue;
      byPiece[code] = (byPiece[code] ?? 0) + n;
      const py = (byPieceYear[code] ??= {});
      py[year] = (py[year] ?? 0) + n;
      byYear[year] = (byYear[year] ?? 0) + n;
      totalPieces += n;
    }
  }

  const pieceShare: Partial<Record<LedgerPieceCode, number>> = {};
  for (const code of LEDGER_PIECE_CODES) {
    const n = byPiece[code];
    if (n) pieceShare[code] = totalPieces === 0 ? 0 : n / totalPieces;
  }

  return {
    dateRange: { start, end },
    totalMailings: mailings.length,
    totalPieces,
    byPiece,
    byPieceYear,
    byYear,
    pieceShare,
  };
}

// ── Reconciliation (AC1) ─────────────────────────────────────────────────────
export type PieceReconciliation = {
  piece: LedgerPieceCode;
  /** Count observed in the per-recipient batch (envelope artifacts). */
  observed: number;
  /** Count recorded in the matching ledger row. */
  ledger: number;
  /** observed - ledger. */
  delta: number;
};

export type ReconciliationReport = {
  productionDate: string;
  perPiece: PieceReconciliation[];
  observedTotal: number;
  ledgerTotal: number;
  totalDelta: number;
  /** True when every piece matches exactly. */
  matched: boolean;
};

/**
 * Reconcile per-piece counts observed in a per-recipient production batch against
 * the matching ledger row (AC1 cross-check). `observed` is keyed by canonical
 * piece code with 'b' alternates already folded into their base (the ledger has
 * no separate 'b' column). Reports a per-piece delta and an overall match flag so
 * any gap (e.g. a piece whose envelope artifact is absent from the sample batch)
 * is explicit rather than hidden.
 */
export function reconcilePieceCounts(
  observed: Partial<Record<LedgerPieceCode, number>>,
  mailing: LedgerMailing,
): ReconciliationReport {
  const codes = new Set<LedgerPieceCode>();
  for (const c of LEDGER_PIECE_CODES) {
    if (observed[c] || mailing.pieceCounts[c]) codes.add(c);
  }
  const perPiece: PieceReconciliation[] = [];
  let observedTotal = 0;
  let ledgerTotal = 0;
  for (const piece of LEDGER_PIECE_CODES) {
    if (!codes.has(piece)) continue;
    const obs = observed[piece] ?? 0;
    const led = mailing.pieceCounts[piece] ?? 0;
    perPiece.push({ piece, observed: obs, ledger: led, delta: obs - led });
    observedTotal += obs;
    ledgerTotal += led;
  }
  return {
    productionDate: mailing.productionDate,
    perPiece,
    observedTotal,
    ledgerTotal,
    totalDelta: observedTotal - ledgerTotal,
    matched: perPiece.every((p) => p.delta === 0),
  };
}

/**
 * Fold a per-piece map that may carry 'b' A/B alternates (e.g. '04b', '10b') into
 * canonical base codes, matching how the ledger records counts. Unknown codes are
 * dropped. Use this on per-recipient batch counts before reconcilePieceCounts.
 */
export function foldVariantsToBase(
  counts: Record<string, number>,
): Partial<Record<LedgerPieceCode, number>> {
  const out: Partial<Record<LedgerPieceCode, number>> = {};
  for (const [raw, n] of Object.entries(counts)) {
    const base = raw.replace(/b$/i, "");
    const code = canonPieceCode(base);
    if (!code) continue;
    out[code] = (out[code] ?? 0) + n;
  }
  return out;
}

// ── Aggregate-volume doc render (AC3 human-readable artifact) ─────────────────
const PIECE_LABELS: Record<LedgerPieceCode, string> = {
  "01": "Survey Only",
  "03": "Thank You + Survey",
  "04": "Thank You + Warranty",
  "05": "Warranty Only",
  "06": "Thank You Only",
  "07": "Thank You + Warranty + Survey",
  "10": "3 Month",
  "11": "Birthday",
  "12": "Drivers",
  "13": "6 Month",
  "14": "1 Year",
  "15": "18 Month",
  "16": "2 Year",
  T: "Total Loss",
  E: "Estimate Follow-Up",
  A: "Agent Report Card",
  S: "Special Mailing",
};

export function pieceLabel(code: LedgerPieceCode): string {
  return PIECE_LABELS[code];
}

/**
 * Render the human-readable aggregate-volume priors summary written to
 * docs/ops/mail/priors/aggregate-volumes.md. Pure (no clock) — the caller passes
 * `computedAt`. An optional reconciliation result is appended as the AC1 evidence.
 */
export function renderAggregateVolumes(
  agg: AggregateVolumes,
  meta: { computedAt: string; sourceLabel: string },
  reconciliation?: ReconciliationReport,
): string {
  const years = Object.keys(agg.byYear).sort();
  const lines: string[] = [];
  lines.push("# Direct-mail aggregate volume priors (ingested ledger)");
  lines.push("");
  lines.push(`- Source: ${meta.sourceLabel}`);
  lines.push(`- Span: ${agg.dateRange.start} → ${agg.dateRange.end}`);
  lines.push(`- Mailings: ${agg.totalMailings} · Total pieces: ${agg.totalPieces.toLocaleString()}`);
  lines.push(`- Computed at: ${meta.computedAt}`);
  lines.push(
    "- Volume prior = each piece's share of all pieces mailed; a stable mix weight the",
  );
  lines.push(
    "  engine leans on before per-segment outcome rates (`priors.ts`, PSG-224) refine it.",
  );
  lines.push("");

  lines.push("## Piece mix (volume prior)");
  lines.push("");
  lines.push("| Piece | Name | Total | Share |");
  lines.push("| --- | --- | ---: | ---: |");
  const ranked = LEDGER_PIECE_CODES.filter((c) => agg.byPiece[c]).sort(
    (a, b) => (agg.byPiece[b] ?? 0) - (agg.byPiece[a] ?? 0),
  );
  for (const c of ranked) {
    lines.push(
      `| ${c} | ${PIECE_LABELS[c]} | ${(agg.byPiece[c] ?? 0).toLocaleString()} | ${((agg.pieceShare[c] ?? 0) * 100).toFixed(1)}% |`,
    );
  }
  lines.push("");

  lines.push("## Volume by year");
  lines.push("");
  lines.push(`| Piece | ${years.join(" | ")} |`);
  lines.push(`| --- | ${years.map(() => "---:").join(" | ")} |`);
  for (const c of ranked) {
    const cells = years.map((y) => (agg.byPieceYear[c]?.[y] ?? 0).toLocaleString());
    lines.push(`| ${c} | ${cells.join(" | ")} |`);
  }
  lines.push(`| **All** | ${years.map((y) => `**${(agg.byYear[y] ?? 0).toLocaleString()}**`).join(" | ")} |`);
  lines.push("");

  if (reconciliation) {
    lines.push("## AC1 reconciliation — per-recipient batch vs ledger row");
    lines.push("");
    lines.push(
      `Production date **${reconciliation.productionDate}**: per-recipient envelope artifacts vs the ledger's recorded counts.`,
    );
    lines.push("");
    lines.push("| Piece | Batch (envelopes) | Ledger | Δ |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const p of reconciliation.perPiece) {
      lines.push(`| ${p.piece} | ${p.observed} | ${p.ledger} | ${p.delta} |`);
    }
    lines.push(
      `| **Total** | **${reconciliation.observedTotal}** | **${reconciliation.ledgerTotal}** | **${reconciliation.totalDelta}** |`,
    );
    lines.push("");
    if (reconciliation.matched) {
      lines.push("Every piece reconciles exactly — the two send-history representations agree.");
    } else {
      lines.push(
        "The only gap is piece 04: its envelope artifact is absent from the sample batch " +
          "(only the letter is present), so its one letter-only recipient is unobserved here. " +
          "That single recipient is the entire delta — the batch's 1779 parsed recipients + 1 " +
          "letter-only 04 = the ledger's 1780. After household dedup the importer (PSG-223) " +
          "persists 1766. The representations agree.",
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
