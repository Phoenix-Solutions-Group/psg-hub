// CCC Secure Share — Phase 3 connection fixtures (PSG-266).
// Sample per-shop connection views, one per state, for fixture-driven UI dev/tests until
// Phase 0/1 land live `ccc_accounts`. Times are fixed ISO strings (no Date.now) so relative-
// time rendering is deterministic when paired with FIXTURE_NOW.

import {
  CCC_ONE_EXPORT_SCOPE,
  type CccConnectionStatus,
  type CccConnectionView,
} from "@/lib/ccc/connection-state";

/** Reference "now" for relative-time rendering against the fixtures below. */
export const FIXTURE_NOW = new Date("2026-06-23T18:00:00Z");

export const CCC_CONNECTION_FIXTURES: Record<CccConnectionStatus, CccConnectionView> = {
  not_connected: {
    shopName: "Acme Collision",
    status: "not_connected",
    dataScope: CCC_ONE_EXPORT_SCOPE,
  },
  pending_review: {
    shopName: "Acme Collision",
    status: "pending_review",
    enabledAt: "2026-06-23T14:14:00Z",
    dataScope: CCC_ONE_EXPORT_SCOPE,
  },
  connected: {
    shopName: "Riverside Auto",
    status: "connected",
    lastEventLabel: "Workfile saved",
    lastEventAt: "2026-06-23T17:57:00Z", // 3 min before FIXTURE_NOW
    enabledAt: "2026-06-20T09:00:00Z",
    dataScope: CCC_ONE_EXPORT_SCOPE,
  },
  error: {
    shopName: "Westgate Collision",
    status: "error",
    errorReason: "auth_expired",
    lastEventAt: "2026-06-23T17:20:00Z",
    dataScope: CCC_ONE_EXPORT_SCOPE,
  },
  declined: {
    shopName: "Bob's Body",
    status: "declined",
    declinedReason: "Facility ID could not be matched to an active PSG shop.",
    dataScope: CCC_ONE_EXPORT_SCOPE,
  },
};
