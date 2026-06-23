/**
 * Seed-test path for the template gate (PSG-217 / PSG-115b).
 *
 * Lets ops send a single real proof piece through the Lob adapter end-to-end
 * BEFORE a template is approved — but only ever in Lob TEST mode (a `test_*` API
 * key, which Lob processes for free and never actually mails). The guard below
 * is the hard safety: a `live_*` key is refused outright so a seed test can never
 * incur per-piece spend or mail a real piece (live spend stays behind gate G4).
 *
 * Pure — no I/O. The route supplies the env key + addressing.
 */

import type { MailAddress } from "./types";

/** Raised when a seed test is attempted with a non-test Lob key (→ HTTP 403). */
export class LiveLobKeyError extends Error {
  constructor() {
    super(
      "Seed test refused: LOB_API_KEY is a live key. Seed tests run in Lob test mode only " +
        "(set a test_* key); live mailing stays behind gate G4."
    );
    this.name = "LiveLobKeyError";
  }
}

/** True only for Lob test-mode keys (`test_*`). */
export function isLobTestKey(key: string | undefined | null): boolean {
  return typeof key === "string" && key.startsWith("test_");
}

/**
 * Assert the configured Lob key is a test key, else throw `LiveLobKeyError`. A
 * missing key throws too (caught upstream as "missing key") — never falls open.
 */
export function assertLobTestMode(key: string | undefined | null): void {
  if (!isLobTestKey(key)) throw new LiveLobKeyError();
}

/**
 * A default deliverable seed recipient for test-mode pieces. Lob test mode does
 * not deliver, so this is a clearly-labelled placeholder; the route accepts an
 * override for the "1–2 live seed addresses" a human watches in the Lob test
 * dashboard.
 */
export const DEFAULT_SEED_ADDRESS: MailAddress = {
  name: "PSG Seed Test",
  addressLine1: "210 King St",
  city: "San Francisco",
  state: "CA",
  zip: "94107",
  country: "US",
};

/** The from-address stamped on a seed-test piece. */
export const SEED_FROM_ADDRESS: MailAddress = {
  name: "Phoenix Solutions Group",
  addressLine1: "1 Market St",
  city: "San Francisco",
  state: "CA",
  zip: "94105",
  country: "US",
};
