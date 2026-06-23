// W0 / PSG-224 (PSG-115e) — mine send-history × outcomes → trigger + A/B priors.
// Spec §5 (docs/specs/002-mail-send-history-w0/spec.md).
//
// This is the PURE miner core. It takes already-resolved send records (from
// mail_send_history, PSG-216a) and outcome records (normalized from the
// repair-customer + survey exports — see outcome-sources.ts) and produces one
// prior per (segment, piece base, A/B arm):
//
//   outcome_rate = (# sends that produced a positive outcome in the window)
//                / (# sends)
//
// A "positive outcome" is repeat OR referral OR a returned survey OR a subsequent
// RO, observed on a matched outcome record whose date falls inside
// [sent_date, sent_date + windowDays]. Matching is by ro_number first, then by
// recipient_hash, then by household_key (the same PII-minimized keys the send was
// logged under — see ../mail/household.ts, PSG-221).
//
// A/B arms: PSG's real numbered-letter set ships base/alternate pairs ('04'/'04b',
// '10'/'10b'). Those alternates ARE the empirical A/B arms the 30-year history
// gives us, so arm 'A' = base piece, arm 'B' = its lettered alternate. This lets
// the engine ask "for this segment + trigger, did '04' or '04b' convert better?".
//
// No DB, no PII, no clock here — all impure concerns (loading rows, hashing raw
// PII, writing the table + doc) live in callers so this stays unit-testable. The
// real run is gated on PSG-216a importing mail_send_history rows.

export type ABVariant = "A" | "B";

/**
 * One send event from mail_send_history (PSG-216a), already resolved to its
 * segment attributes (carried from the linked RO/customer at import time) and
 * PII-minimized join keys. `pieceCode` is the RAW code as logged ('04', '04b',
 * '07', 't', 'b'); the miner splits the A/B arm off it.
 */
export type SendRecord = {
  pieceCode: string;
  /** ISO date (YYYY-MM-DD) the piece was sent. */
  sentDate: string;
  roNumber?: string | null;
  recipientHash?: string | null;
  householdKey?: string | null;
  // Segment dimensions (RO/customer-side, resolved at import). All optional;
  // missing → 'unknown' in the segment key.
  payType?: string | null;
  region?: string | null; // 2-letter state code
  /** Whether the mailed customer was already a repeat customer at send time. */
  repeatCustomer?: boolean | null;
};

/**
 * One outcome observation, normalized from the repair-customer / survey exports.
 * Carries whichever join keys are resolvable plus the outcome flags.
 */
export type OutcomeRecord = {
  roNumber?: string | null;
  recipientHash?: string | null;
  householdKey?: string | null;
  /** ISO date the outcome was observed (RC_Date_Out / S_CreationDate). */
  outcomeDate: string;
  repeat: boolean;
  referral: boolean;
  surveyReturned: boolean;
  /** A subsequent RO dollar amount, when the outcome row represents new work. */
  subsequentRo?: boolean | null;
};

export type PriorRow = {
  segmentKey: string;
  /** Base piece code (the 'b' alternate is folded into abVariant). */
  pieceCode: string;
  trigger: string;
  abVariant: ABVariant;
  nSent: number;
  nOutcome: number;
  outcomeRate: number;
};

export type MineOptions = {
  /**
   * Outcome must land within this many days AFTER the send to count. Default 180
   * (the follow-up program's ~6-month horizon).
   */
  windowDays?: number;
  /** Include the repeat-customer dimension in the segment key. Default true. */
  segmentByRepeat?: boolean;
};

const DEFAULT_WINDOW_DAYS = 180;

// ── Pay-type bucketing ───────────────────────────────────────────────────
// The raw export pay types are messy free text ("Ins Pay (Which Party Unknown)",
// "Third Party Pay", "Claimant (Other Insurance)", ...). Collapse to a small,
// stable set so segments are dense enough to mine.
export function normalizePayType(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim();
  if (s === "") return "unknown";
  if (s.includes("claimant") || s.includes("ins")) return "Ins";
  if (s.includes("third party")) return "ThirdParty";
  if (s.includes("customer") || s.includes("self") || s.includes("owner")) return "Customer";
  return "Other";
}

// ── A/B arm + piece base ───────────────────────────────────────────────────
/**
 * Split a raw piece code into its base + A/B arm. A trailing lowercase 'b' on a
 * non-empty stem marks the alternate arm:
 *   '04'  -> { base: '04', arm: 'A' }
 *   '04b' -> { base: '04', arm: 'B' }
 *   '10b' -> { base: '10', arm: 'B' }
 *   't'   -> { base: 't',  arm: 'A' }
 *   'b'   -> { base: 'b',  arm: 'A' }   (birthday/seasonal — the 'b' is the stem)
 */
export function splitPiece(pieceCode: string): { base: string; arm: ABVariant } {
  const code = (pieceCode ?? "").trim();
  const m = /^(.+?)b$/i.exec(code);
  if (m && m[1] !== "") return { base: m[1], arm: "B" };
  return { base: code, arm: "A" };
}

// ── Piece → trigger ────────────────────────────────────────────────────────
// Grounded in spec §4 / the Master Follow-Up Program. The authoritative catalog
// is the numbered-letter library (PSG-216c); this is the miner's internal map so
// priors carry a trigger without a hard dependency on that artifact.
const PIECE_TRIGGER: Record<string, string> = {
  t: "total_loss_thank_you",
  "04": "warranty_letter",
  "07": "survey_followup_warranty",
  "10": "followup_sequence",
  "12": "followup_sequence",
  "13": "followup_sequence",
  "14": "followup_sequence",
  "15": "followup_sequence",
  "16": "followup_sequence",
  b: "birthday_seasonal",
};

export function pieceTrigger(base: string): string {
  return PIECE_TRIGGER[base] ?? "unknown";
}

// ── Segment key ──────────────────────────────────────────────────────────
export function segmentKey(send: SendRecord, opts?: MineOptions): string {
  const includeRepeat = opts?.segmentByRepeat ?? true;
  const parts = [`paytype=${normalizePayType(send.payType)}`];
  if (includeRepeat && send.repeatCustomer !== undefined && send.repeatCustomer !== null) {
    parts.push(`repeat=${send.repeatCustomer ? "Y" : "N"}`);
  }
  const region = (send.region ?? "").toUpperCase().trim() || "unknown";
  parts.push(`region=${region}`);
  return parts.join("|");
}

// ── Outcome matching ──────────────────────────────────────────────────────
function isPositive(o: OutcomeRecord): boolean {
  return Boolean(o.repeat || o.referral || o.surveyReturned || o.subsequentRo);
}

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

type OutcomeIndex = {
  byRo: Map<string, OutcomeRecord[]>;
  byRecipient: Map<string, OutcomeRecord[]>;
  byHousehold: Map<string, OutcomeRecord[]>;
};

function buildIndex(outcomes: OutcomeRecord[]): OutcomeIndex {
  const idx: OutcomeIndex = { byRo: new Map(), byRecipient: new Map(), byHousehold: new Map() };
  const push = (m: Map<string, OutcomeRecord[]>, k: string | null | undefined, v: OutcomeRecord) => {
    const key = (k ?? "").trim();
    if (key === "") return;
    const arr = m.get(key);
    if (arr) arr.push(v);
    else m.set(key, [v]);
  };
  for (const o of outcomes) {
    push(idx.byRo, o.roNumber, o);
    push(idx.byRecipient, o.recipientHash, o);
    push(idx.byHousehold, o.householdKey, o);
  }
  return idx;
}

/**
 * Find the outcome that matches a send, preferring the strongest key (ro_number),
 * falling back to recipient_hash then household_key, and requiring the outcome to
 * fall inside [sentDate, sentDate + windowDays]. Returns the matched outcome (the
 * earliest positive one if any positive exists, else the earliest in-window) or
 * null. A positive in-window outcome is what counts toward n_outcome.
 */
export function matchOutcome(
  send: SendRecord,
  idx: OutcomeIndex,
  windowDays: number
): OutcomeRecord | null {
  const candidateLists = [
    idx.byRo.get((send.roNumber ?? "").trim()),
    idx.byRecipient.get((send.recipientHash ?? "").trim()),
    idx.byHousehold.get((send.householdKey ?? "").trim()),
  ];
  const candidates = candidateLists.find((l) => l && l.length > 0);
  if (!candidates) return null;
  const inWindow = candidates.filter((o) => {
    const d = dayDiff(send.sentDate, o.outcomeDate);
    return !Number.isNaN(d) && d >= 0 && d <= windowDays;
  });
  if (inWindow.length === 0) return null;
  const positives = inWindow.filter(isPositive);
  const pool = positives.length > 0 ? positives : inWindow;
  return pool.reduce((earliest, o) =>
    dayDiff(send.sentDate, o.outcomeDate) < dayDiff(send.sentDate, earliest.outcomeDate) ? o : earliest
  );
}

// ── Mine ──────────────────────────────────────────────────────────────────
/**
 * Mine priors from sends × outcomes. Pure: deterministic for a given input,
 * sorted output (by segment, piece, arm) for stable docs/diffs.
 */
export function mineSendPriors(
  sends: SendRecord[],
  outcomes: OutcomeRecord[],
  opts?: MineOptions
): PriorRow[] {
  const windowDays = opts?.windowDays ?? DEFAULT_WINDOW_DAYS;
  const idx = buildIndex(outcomes);
  const cells = new Map<string, { row: Omit<PriorRow, "outcomeRate">; }>();

  for (const send of sends) {
    const seg = segmentKey(send, opts);
    const { base, arm } = splitPiece(send.pieceCode);
    const cellKey = `${seg} ${base} ${arm}`;
    let cell = cells.get(cellKey);
    if (!cell) {
      cell = {
        row: {
          segmentKey: seg,
          pieceCode: base,
          trigger: pieceTrigger(base),
          abVariant: arm,
          nSent: 0,
          nOutcome: 0,
        },
      };
      cells.set(cellKey, cell);
    }
    cell.row.nSent += 1;
    const matched = matchOutcome(send, idx, windowDays);
    if (matched && isPositive(matched)) cell.row.nOutcome += 1;
  }

  const rows: PriorRow[] = [...cells.values()].map((c) => ({
    ...c.row,
    outcomeRate: c.row.nSent === 0 ? 0 : c.row.nOutcome / c.row.nSent,
  }));

  rows.sort(
    (a, b) =>
      a.segmentKey.localeCompare(b.segmentKey) ||
      a.pieceCode.localeCompare(b.pieceCode) ||
      a.abVariant.localeCompare(b.abVariant)
  );
  return rows;
}

// ── Doc summary ────────────────────────────────────────────────────────────
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Render the human-readable priors summary written to docs/ops/mail/priors/.
 * Pure (no clock) — the caller passes `computedAt`/`windowDays` so the doc is
 * reproducible. Groups by trigger → segment, lists each piece's A/B arms, and
 * flags the better arm + lift where both arms exist.
 */
export function renderPriorsSummary(
  rows: PriorRow[],
  meta: { computedAt: string; windowDays: number; sourceLabel: string }
): string {
  const lines: string[] = [];
  lines.push("# Direct-mail trigger + A/B priors (mined)");
  lines.push("");
  lines.push(`- Source: ${meta.sourceLabel}`);
  lines.push(`- Outcome window: ${meta.windowDays} days after send`);
  lines.push(`- Computed at: ${meta.computedAt}`);
  lines.push(
    "- Outcome = repeat OR referral OR returned survey OR subsequent RO inside the window."
  );
  lines.push("");
  if (rows.length === 0) {
    lines.push("_No priors — no send-history rows mined yet (gated on PSG-216a import)._");
    lines.push("");
    return lines.join("\n");
  }

  const byTrigger = new Map<string, PriorRow[]>();
  for (const r of rows) {
    const arr = byTrigger.get(r.trigger);
    if (arr) arr.push(r);
    else byTrigger.set(r.trigger, [r]);
  }

  for (const trigger of [...byTrigger.keys()].sort()) {
    lines.push(`## Trigger: ${trigger}`);
    lines.push("");
    lines.push("| Segment | Piece | Arm | Sent | Outcomes | Rate |");
    lines.push("| --- | --- | --- | ---: | ---: | ---: |");
    const group = byTrigger.get(trigger)!;
    for (const r of group) {
      lines.push(
        `| ${r.segmentKey} | ${r.pieceCode} | ${r.abVariant} | ${r.nSent} | ${r.nOutcome} | ${pct(r.outcomeRate)} |`
      );
    }
    lines.push("");

    // A/B verdicts where both arms of a (segment, piece) exist.
    const pairs = new Map<string, { A?: PriorRow; B?: PriorRow }>();
    for (const r of group) {
      const k = `${r.segmentKey}::${r.pieceCode}`;
      const p = pairs.get(k) ?? {};
      p[r.abVariant] = r;
      pairs.set(k, p);
    }
    const verdicts: string[] = [];
    for (const [k, p] of pairs) {
      if (p.A && p.B) {
        const [seg, piece] = k.split("::");
        const winner = p.A.outcomeRate >= p.B.outcomeRate ? "A" : "B";
        const lift = Math.abs(p.A.outcomeRate - p.B.outcomeRate);
        verdicts.push(
          `- **${seg} / ${piece}**: arm **${winner}** wins (${pct(p.A.outcomeRate)} A vs ${pct(p.B.outcomeRate)} B, ${pct(lift)} lift).`
        );
      }
    }
    if (verdicts.length > 0) {
      lines.push("**A/B verdicts:**");
      lines.push(...verdicts);
      lines.push("");
    }
  }
  return lines.join("\n");
}
