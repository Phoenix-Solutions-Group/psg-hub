// BSM Phase 1 / PSG-776 — Web-surface delivery: public surface.
//
// Barrel + the two seams the web-surface build is decomposed around:
//   • assembleServicePage()      — PSG-776 (Ravi): render a published
//                                  service_page into the live artifact.
//   • checkConversionStructure() — PSG-773: the C2 "Call + Estimate" gate,
//                                  wired into the assembly step for
//                                  service_page ONLY. Seeded here as a correct
//                                  reference over the typed ConversionBlock;
//                                  PSG-773 wires it into the pipeline and adds
//                                  adversarial coverage.
//
// See docs/adr/psg-776-web-surface-delivery.md for the architecture decision.

import type { Violation } from "@/lib/claim-integrity";
import type { AssembleInput, ConversionBlock, WebSurfaceArtifact } from "./types";

export * from "./types";

/**
 * Assemble a published `service_page` content item into the live web artifact.
 *
 * CONTRACT (what the gate + route rely on):
 *  - MUST place at least one real `tel:` call action in the `"hero"` section
 *    (reachable in the first screen), sourced from `shop.telephone`.
 *  - MUST include an estimate action wired to a live per-shop lead endpoint.
 *  - MUST repeat the primary call-to-action at least once further down the page
 *    (`conversion.primaryCtaOccurrences >= 2`).
 *  - MUST only surface facts present in `facts` (verified-facts record); any
 *    honesty-sensitive claim absent from the record is omitted, never invented.
 *  - Returns a fully-populated `WebSurfaceArtifact` (meta + sections + the
 *    machine-checkable `conversion` block + rendered `html`).
 *
 * The Tedesco staged reference (`apps/psg-hub/staging/tedesco-home/index.html`)
 * is the canonical visual/structure template to derive this from.
 *
 * TODO(PSG-776, Ravi): implement. Left as a loud stub so nothing ships a page
 * assembled by a placeholder.
 */
export function assembleServicePage(input: AssembleInput): WebSurfaceArtifact {
  throw new Error(
    `assembleServicePage not yet implemented (PSG-776) — item ${input.item.id}`
  );
}

/**
 * C2 conversion-structure gate (BSM Content-Quality Standard v1, check C2).
 *
 * Given an assembled artifact's `conversion` block, return the C2 violations.
 * An empty array means the page carries a present, early, repeated primary
 * action plus a real estimate action — i.e. no live page goes out missing a
 * phone button. Non-empty ⇒ the assembly step must REJECT before serving.
 *
 * This is a correct reference over the typed contract. PSG-773 owns wiring it
 * into the assembly pipeline (service_page only) and expanding adversarial
 * coverage; it is safe to call directly from tests today.
 */
export function checkConversionStructure(
  conversion: ConversionBlock
): Violation[] {
  const violations: Violation[] = [];

  const callActions = conversion.callActions ?? [];
  const estimateActions = conversion.estimateActions ?? [];

  // A real tap-to-call action must exist at all.
  const realCallActions = callActions.filter(
    (c) => typeof c.tel === "string" && c.tel.trim().length > 0
  );
  if (realCallActions.length === 0) {
    violations.push({
      code: "missing_call_action",
      message:
        "No working tap-to-call (tel:) action on the page — a live page must never ship without a phone button.",
    });
  } else if (!realCallActions.some((c) => c.placement === "hero")) {
    // ...and one must be reachable in the first screen (the hero).
    violations.push({
      code: "call_action_not_early",
      message:
        "A tap-to-call action exists but none is in the hero (first screen) — the phone button must be reachable without scrolling.",
    });
  }

  // A "get a free estimate" action must exist and point somewhere real.
  const realEstimateActions = estimateActions.filter(
    (e) => typeof e.href === "string" && e.href.trim().length > 0 && !!e.leadEndpoint
  );
  if (realEstimateActions.length === 0) {
    violations.push({
      code: "missing_estimate_action",
      message:
        'No live "get a free estimate" action wired to a lead endpoint — the estimate path must not be a dead stub.',
    });
  }

  // The primary action must be repeated as the reader scrolls (not one-and-done).
  if ((conversion.primaryCtaOccurrences ?? 0) < 2) {
    violations.push({
      code: "conversion_action_not_repeated",
      message:
        "The primary call-to-action appears only once — it must be repeated further down the page as the reader scrolls.",
    });
  }

  return violations;
}
