// PSG-261 / CCC Secure Share Phase 1B — BMS estimate XML parser.
//
// Stage 1 of the domain core: turn raw CIECA BMS estimate XML into a navigable
// tree (./xml.ts) and assert it actually *is* an estimate document before the
// mapper (./mapper.ts) reads canonical fields out of it. Pure, no I/O.

import { parseXml, find, type XmlNode } from "./xml";

export class BmsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BmsParseError";
  }
}

// Recognised BMS estimate document roots / signature elements. The CIECA BMS
// transaction set wraps an estimate in a request/response envelope whose root
// varies by version (e.g. VehicleDamageEstimateAddRq); we also accept a bare
// <VehicleDamageEstimate>. The signature elements below distinguish a genuine
// estimate document from arbitrary XML so we fail loudly on a wrong upload.
const ESTIMATE_SIGNATURE_ELEMENTS = [
  "VehicleDamageEstimate",
  "EstimateInfo",
  "DamageLineInfo",
  "RepairTotalsInfo",
];

/**
 * Parse BMS estimate XML into a validated element tree. Throws
 * {@link BmsParseError} when the bytes are not a recognisable BMS estimate
 * document (so a mis-routed RO list or empty payload never silently yields a
 * blank estimate).
 */
export function parseBmsEstimateXml(xml: string): XmlNode {
  if (!xml || !xml.trim()) throw new BmsParseError("Empty BMS document");
  const root = parseXml(xml);
  const looksLikeEstimate = ESTIMATE_SIGNATURE_ELEMENTS.some((name) => find(root, name));
  if (!looksLikeEstimate) {
    throw new BmsParseError(
      "This XML is not a recognisable CIECA BMS estimate document (no estimate, " +
        "damage-line, or totals elements found).",
    );
  }
  return root;
}
