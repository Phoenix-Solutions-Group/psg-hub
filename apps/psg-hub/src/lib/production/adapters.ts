import "server-only";
import { createLobAdapter, type LobAdapterOptions } from "./lob";
import { createInHouseAdapter, type InHouseAdapterOptions } from "./inhouse";
import type { MailAdapter, MailVendor } from "./types";

/**
 * Vendor → adapter factory (v1.3 dual adapter, PLANNING.md Decision 53). Given the
 * vendor chosen by `selectVendor` (src/lib/production/select-vendor.ts), build the
 * concrete `MailAdapter` to submit through. This is the one place that knows which
 * class backs each vendor; the rest of the hub stays vendor-agnostic.
 */

export interface MailAdapterOptions {
  lob?: LobAdapterOptions;
  inhouse?: InHouseAdapterOptions;
}

export function createMailAdapter(
  vendor: MailVendor,
  options: MailAdapterOptions = {}
): MailAdapter {
  switch (vendor) {
    case "lob":
      return createLobAdapter(options.lob);
    case "inhouse":
      return createInHouseAdapter(options.inhouse);
  }
}
