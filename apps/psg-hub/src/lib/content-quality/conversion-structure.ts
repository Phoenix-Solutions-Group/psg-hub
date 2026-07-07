// BSM Content-Quality Standard v1 — C2 conversion-structure check (PSG-752).
//
// C2 ("One conversion job, present and reachable") is a Tier-0 HARD gate: a shop
// page must carry a real tap-to-call (`tel:`) action and a "get a free estimate"
// action, both reachable early, with the primary action repeated as the reader
// scrolls (PSG-746 §Tier-0 / §4 encoding guide). This module is the structural
// check on a Content Writer draft that enforces it.
//
// SCOPE: C2 is about the *shop page* — the `service_page` content type in the BSM
// engine. A `blog_post` (an article) and a `meta_description` (a SERP snippet)
// are not the shop's conversion page and are out of C2 scope; this check returns
// no violations for them. (The 3 Phase-0 legacy service_page fixtures are copy
// blocks that predate this standard and carry no tel: link — see PSG-752 for the
// interpretation note that a shop-page draft going live must carry the tel: link
// in the page it is assembled into. This check evaluates the draft it is given.)
//
// Pure functions, node-testable. No I/O.

import type { GeneratedAsset } from "@/lib/agent-engine";
import type { Violation } from "@/lib/claim-integrity";

/**
 * A real tap-to-call action: a `tel:` scheme followed by a plausible phone
 * number (markdown `[Call …](tel:+15551234567)` or a bare `tel:` link). We
 * require digits after the scheme so a stray "tel:" token is not counted.
 */
const TEL_LINK_RE = /tel:\s*\+?[\d][\d\-().\s]{5,}\d/i;

/** A "get a free estimate" style conversion action. */
const ESTIMATE_ACTION_RE =
  /\b(?:free estimate|get (?:a|an|your) estimate|request (?:a |an |your )?estimate|estimate request|schedule (?:a |an )?estimate|start (?:a |your )?estimate|get (?:a |an )?(?:free )?quote|request (?:a |your )?quote)\b/i;

/**
 * How much of the rendered body counts as "the first screen" for the early-CTA
 * test. A proxy for above-the-fold on mobile: the greater of the first 600
 * characters or the first 25% of the body (so a short page passes when the CTA is
 * anywhere in it, and a long page must place the call action up top).
 */
function firstScreenCutoff(bodyLength: number): number {
  return Math.max(600, Math.floor(bodyLength * 0.25));
}

/** Count non-overlapping matches of a pattern in text. */
function countMatches(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const matches = text.match(g);
  return matches ? matches.length : 0;
}

/**
 * Run the C2 conversion-structure check against a Content Writer draft. Returns
 * HARD-FAIL violations for a `service_page` that is missing a tel: action, has
 * its tel: action buried below the first screen, is missing an estimate action,
 * or never repeats its primary conversion action. Returns `[]` (not applicable)
 * for non-`service_page` content types.
 */
export function checkConversionStructure(asset: GeneratedAsset): Violation[] {
  if (asset.contentType !== "service_page") return [];

  const body = asset.body ?? "";
  const violations: Violation[] = [];

  // 1. A real tel: tap-to-call action must exist.
  const telMatch = body.match(TEL_LINK_RE);
  if (!telMatch) {
    violations.push({
      code: "missing_call_action",
      message:
        "Shop page has no real tap-to-call action. A `tel:` link with a phone number must be present so a stressed person can call in one tap (C2).",
    });
  } else {
    // 2. …and it must be reachable in the first screen.
    const idx = body.search(TEL_LINK_RE);
    if (idx > firstScreenCutoff(body.length)) {
      violations.push({
        code: "call_action_not_early",
        message:
          "The tap-to-call action is buried below the first screen. A `tel:` link must be reachable without scrolling on mobile (C2).",
        evidence: telMatch[0].trim(),
      });
    }
  }

  // 3. A "get a free estimate" action must exist.
  const hasEstimate = ESTIMATE_ACTION_RE.test(body);
  if (!hasEstimate) {
    violations.push({
      code: "missing_estimate_action",
      message:
        "Shop page has no clear 'get a free estimate' action above the fold. An estimate action must be present (C2).",
    });
  }

  // 4. The primary conversion action must repeat as the reader scrolls.
  const conversionOccurrences = countMatches(body, TEL_LINK_RE) + countMatches(body, ESTIMATE_ACTION_RE);
  if (conversionOccurrences < 2) {
    violations.push({
      code: "conversion_action_not_repeated",
      message:
        "The primary conversion action is not repeated as the reader scrolls. Keep a way to call or request an estimate in reach at every scroll depth (C2).",
    });
  }

  return violations;
}
