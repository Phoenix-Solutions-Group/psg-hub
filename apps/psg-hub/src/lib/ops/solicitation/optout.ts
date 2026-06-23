// PSG-248 — opt-out classification + current-status evaluation (PURE).
//
// Two responsibilities, both DB-free and unit-testable:
//   1. classifyInboundSms — map an inbound SMS body to a STOP / START / HELP
//      intent using the carrier-standard keyword sets (TCPA / CTIA). The match is
//      case-insensitive and ignores surrounding punctuation/whitespace so "Stop.",
//      " STOP " and "stop" all opt the sender out.
//   2. currentOptOutState — given the append-only event log for one (channel,
//      contact), return the live status (latest event wins). The store is
//      append-only for compliance provability, so "is this contact opted out
//      right now?" is a fold over its history, not a mutable flag.

import type { OptOutEvent, OptOutState } from "./types";

/** Inbound SMS intents we act on. */
export type InboundSmsIntent = "stop" | "start" | "help";

// CTIA / carrier standard keywords. STOP family = opt-out, START family =
// re-subscribe, HELP family = info reply. Kept as exact single-word matches
// (after normalization) to avoid opting someone out for "please don't stop
// texting me deals" — only a lone keyword counts.
const STOP_KEYWORDS = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "optout",
  "revoke",
]);
const START_KEYWORDS = new Set(["start", "unstop", "yes"]);
const HELP_KEYWORDS = new Set(["help", "info"]);

/** Normalize an inbound body to a single lower-case keyword token, if it is one. */
function keywordOf(body: string | null | undefined): string {
  return (body ?? "")
    .trim()
    .toLowerCase()
    // Drop surrounding punctuation ("stop." → "stop") but keep it a single token.
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Classify an inbound SMS body. Returns the intent or null when the body is not a
 * recognized compliance keyword (an ordinary reply). Only a message that is a
 * single keyword (optionally punctuated) matches — multi-word messages are null.
 */
export function classifyInboundSms(
  body: string | null | undefined
): InboundSmsIntent | null {
  const raw = (body ?? "").trim();
  // Reject multi-word bodies up front: a keyword must stand alone to count.
  if (/\s/.test(raw)) return null;
  const kw = keywordOf(raw);
  if (kw === "") return null;
  if (STOP_KEYWORDS.has(kw)) return "stop";
  if (START_KEYWORDS.has(kw)) return "start";
  if (HELP_KEYWORDS.has(kw)) return "help";
  return null;
}

/**
 * Fold an append-only event log into the current opt-out status for one contact.
 * Latest event (by created_at, then array order as a stable tiebreak) wins. With
 * no events the contact has never opted out → "opted_in". A STOP after a START
 * re-suppresses; a START after a STOP re-subscribes (carrier-standard).
 */
export function currentOptOutState(
  events: readonly OptOutEvent[]
): OptOutState {
  let best: OptOutEvent | undefined;
  for (const e of events) {
    if (best === undefined) {
      best = e;
      continue;
    }
    const a = e.created_at ?? "";
    const b = best.created_at ?? "";
    // >= so a later array element with an equal/empty timestamp still wins,
    // matching "newest-first insert order" when timestamps are absent in tests.
    if (a >= b) best = e;
  }
  return best?.state ?? "opted_in";
}

/** Convenience: is this contact currently opted OUT? */
export function isOptedOut(events: readonly OptOutEvent[]): boolean {
  return currentOptOutState(events) === "opted_out";
}
