// CCC Secure Share — Phase 3 connection-state contract (pure).
// PSG-266 (child 1/3 of PSG-256). Spec: docs/ops/ccc/phase3-onboarding-consent-ux.md.
//
// This is the single source of truth the UI renders against (spec §2 state machine +
// §5 column contract). It is intentionally pure & data-only — no React, no I/O — so the
// state→presentation mapping is unit-testable as a matrix and Phase-3 child 3 can bind the
// same descriptors to live `ccc_accounts` rows without a rewrite. The components in
// ccc-connection-card.tsx / ccc-data-scope-panel.tsx are thin renderers over these values.

// ── State machine (spec §2) ────────────────────────────────────────────────
// The canonical per-shop status that drives every surface. Phase 1 (PSG-252) exposes this
// as `ccc_accounts.connection_status`; the UI never writes connected/error (ingest/health do).
export type CccConnectionStatus =
  | "not_connected"
  | "pending_review"
  | "connected"
  | "error"
  | "declined";

export const CCC_CONNECTION_STATUSES: readonly CccConnectionStatus[] = [
  "not_connected",
  "pending_review",
  "connected",
  "error",
  "declined",
] as const;

// The shop-side CTAs surface A can show. (The PSG-staff CTAs — Approve/Decline/Revoke — live
// on surface B, built by Ravi in child 2; this card is the shop-facing surface, spec §1 row A.)
export type CtaKey =
  | "get_steps"
  | "cancel_request"
  | "disconnect"
  | "view_scope"
  | "reconnect"
  | "request_again";

export const CTA_LABELS: Record<CtaKey, string> = {
  get_steps: "Get connection steps",
  cancel_request: "Cancel request",
  disconnect: "Disconnect",
  // "What we share" (not "View scope") so the connected/error CTA speaks the same plain
  // voice as the not_connected "What we'll receive ▸" affordance (designer P2, PSG-275).
  view_scope: "What we share",
  reconnect: "Reconnect",
  request_again: "Request again",
};

// Badge variants are constrained to the existing ui/badge.tsx variant set so the card matches
// the rest of the ops shell (see access-audit-viewer.tsx / competitor-intel.tsx usage).
export type StatusBadgeVariant = "secondary" | "warning" | "success" | "destructive";

export type StatePresentation = {
  status: CccConnectionStatus;
  /** Human status label rendered in the badge (spec §2 / §4 A″). */
  label: string;
  badgeVariant: StatusBadgeVariant;
  /** Small status glyph from the §4 A″ wireframe. */
  glyph: string;
  /** One-line plain-language meaning shown under the title. */
  summary: string;
  /** Ordered shop-side CTAs to render for this state (spec §2 "Primary CTA" + §4 A″). */
  ctas: CtaKey[];
};

// State → presentation mapping, EXACTLY per the spec §2 table + §4 A″ wireframe.
// not_connected → "Get connection steps"; pending_review → waiting + cancel; connected →
// view scope + disconnect; error → reconnect + view scope; declined → reason + request again.
export const CONNECTION_PRESENTATION: Record<CccConnectionStatus, StatePresentation> = {
  not_connected: {
    status: "not_connected",
    label: "Not connected",
    badgeVariant: "secondary",
    glyph: "○",
    summary: "Live estimate & RO feed from CCC ONE — no weekly CSV.",
    ctas: ["get_steps"],
  },
  pending_review: {
    status: "pending_review",
    label: "Waiting on PSG",
    badgeVariant: "warning",
    glyph: "⏳",
    summary: "Enabled in CCC. Our team approves within 1 business day.",
    ctas: ["cancel_request"],
  },
  connected: {
    status: "connected",
    label: "Connected",
    badgeVariant: "success",
    glyph: "✓",
    // "repair orders", not "events" — shop owners think in jobs/ROs, not system events
    // (designer P2, PSG-275). "Workfile saved" in the last-event line keeps CCC's own term.
    summary: "Approved — now receiving completed repair orders from CCC ONE.",
    ctas: ["view_scope", "disconnect"],
  },
  error: {
    status: "error",
    label: "Connection error",
    badgeVariant: "destructive",
    glyph: "⚠",
    summary: "We stopped receiving repair orders from CCC ONE.",
    ctas: ["reconnect", "view_scope"],
  },
  declined: {
    status: "declined",
    label: "Declined",
    // Neutral, not destructive(red): a declined request is a recoverable PSG business
    // decision ("Request again"), not a system failure like `error` — red reads punitive
    // and conflates the two (designer P3, PSG-275). Spec §2 doesn't pin a color here.
    badgeVariant: "secondary",
    glyph: "⊘",
    summary: "PSG declined this connection request.",
    ctas: ["request_again"],
  },
};

// ── Error hint derivation (spec §3.3 / §5: machine reason → human hint) ──────
// Phase 2 ingest / Phase 4 health write a machine `error_reason`; the UI derives the
// shop-facing hint. Unknown reasons fall back to a generic, still-actionable line.
const ERROR_HINTS: Record<string, string> = {
  auth_expired:
    "CCC authorization expired — re-enable Secure Share in CCC ONE to restore the feed.",
  sync_failed:
    "The last sync from CCC ONE failed. Reconnect to restore the feed.",
  revoked_by_ccc:
    "CCC ONE revoked access for this shop. Re-enable Secure Share to reconnect.",
};

export function errorHint(machineReason: string | null | undefined): string {
  if (machineReason && machineReason in ERROR_HINTS) return ERROR_HINTS[machineReason];
  return "We stopped receiving data from CCC ONE. Reconnect to restore the feed.";
}

// ── Time formatting (pure; `now` injected for deterministic tests) ──────────
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now" / "3 min ago" / "2 hr ago" / "Jun 23" — pure, deterministic given `now`. */
export function formatRelative(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now.getTime() - then;
  if (delta < MIN) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MIN)} min ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} hr ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The "Last event: Workfile saved · 3 min ago" line (spec §2 / §4 A″ connected card).
 * Returns null when there is no event yet (e.g. just-approved, nothing ingested), so the
 * card can omit the line rather than render a half-empty "Last event: · …".
 */
export function formatLastEvent(
  view: Pick<CccConnectionView, "lastEventLabel" | "lastEventAt">,
  now: Date,
): string | null {
  const { lastEventLabel, lastEventAt } = view;
  if (!lastEventAt && !lastEventLabel) return null;
  const rel = lastEventAt ? formatRelative(lastEventAt, now) : "";
  if (lastEventLabel && rel) return `${lastEventLabel} · ${rel}`;
  return lastEventLabel || rel || null;
}

// ── Data-scope / consent panel (spec §4 C, surface C) ───────────────────────
// DATA-DRIVEN: the panel renders whatever `data_scope` it is handed (Phase 0 fixes the real
// grant and Phase 1 seeds it as `ccc_accounts.data_scope` jsonb). The fixture below is the
// documented CCC ONE export scope — NOT a hardcoded panel.
export type CccDataScopeField = {
  label: string;
  /** Why we receive it, e.g. "to send mail" — rendered as a muted parenthetical. */
  note?: string;
  /** Optional fields ("if present" / "recommended") get a softer treatment. */
  optional?: boolean;
};

export type CccDataScope = {
  /** Plain-language headline of what is / isn't shared. */
  summary: string;
  /** ✓ fields BSM receives. */
  received: CccDataScopeField[];
  /** ✗ categories BSM never receives. */
  excluded: string[];
  /** Trust line about encryption + disconnect. */
  assurance?: string;
};

// Fixture: the documented CCC ONE export scope (docs/psg/ccc-guide/ccc-export-guide-psg-001.md
// + spec §4 C). Used until Phase 0/1 seed the real `data_scope`. The component takes the scope
// as a prop, so swapping this for a live row is a one-line change in child 3.
export const CCC_ONE_EXPORT_SCOPE: CccDataScope = {
  summary:
    "Only completed, delivered repair orders. We do NOT receive open estimates, totaled vehicles, or your financial/accounting data.",
  received: [
    { label: "Customer name & mailing address", note: "to send mail" },
    { label: "Vehicle year / make / model", note: "personalize the piece" },
    { label: "RO number & repair in/out dates", note: "timing & dedup" },
    { label: "Repair $ amount", note: "segment & suppress" },
    { label: "Insurance company / pay type", note: "optional, if present", optional: true },
    { label: "Referral source / agent", note: "optional, recommended", optional: true },
  ],
  excluded: [
    "open estimates",
    "payment card / banking data",
    "employee records",
    "any data outside the scope above",
  ],
  assurance:
    "Data is encrypted in transit and at rest. You can disconnect at any time; that stops new data immediately.",
};

// Connection step list (spec §4 A′). The exact CCC menu path is ⚠ PHASE-0 FIRM-UP, so the
// first step carries an explicit placeholder rather than an invented menu path.
export const CCC_CONNECTION_STEPS: readonly string[] = [
  "Open CCC ONE → Configure → [exact menu path confirmed in Phase 0]",
  'Find "Secure Share" / partner apps',
  'Search for "Phoenix Solutions Group / BSM"',
  "Click Enable and approve the data scope shown below",
] as const;

// ── The view model the card binds to (subset of spec §5 `ccc_accounts` columns) ──
export type CccConnectionView = {
  shopName: string;
  status: CccConnectionStatus;
  /** ISO timestamptz of the last ingested event (Phase 2). */
  lastEventAt?: string | null;
  /** "Workfile saved" etc (Phase 2). */
  lastEventLabel?: string | null;
  /** ISO timestamptz the shop enabled BSM in CCC (handshake) — "Enabled in CCC on…". */
  enabledAt?: string | null;
  /** PSG-supplied reason when status === "declined". */
  declinedReason?: string | null;
  /** Machine error reason when status === "error" (hint derived via errorHint). */
  errorReason?: string | null;
  /** The approved scope to render in panel C (data-driven). */
  dataScope: CccDataScope;
};
