// PSG-248 / Wave 2 (G-c) — Proactive review solicitation (SMS + email).
//
// Public types for the solicitation module. The flow is:
//   1. an agent drafts a solicitation (draft.ts) and enqueues it through the
//      generic approval queue (PSG-245) as action_type "review_solicitation";
//   2. a role-gated human approves it;
//   3. ON APPROVE ONLY, the registered solicitation Publisher (publisher.ts)
//      re-checks consent + opt-out + suppression per channel, sends over the
//      consenting channels, and writes one immutable send-audit row per channel.
//
// Compliance posture:
//   - SMS marketing requires prior express consent (TCPA) — the publisher refuses
//     to send SMS without a recorded consent flag in the payload.
//   - Email honors opt-out + carries a one-click unsubscribe link and the sender's
//     physical postal address (CAN-SPAM).
//   - STOP (inbound SMS) and unsubscribe (email link) are honored before any send.
//   - PII-min: contacts are matched on a salted HMAC, never stored in the clear.

/** The two channels a solicitation can go out over. */
export const SOLICITATION_CHANNELS = ["email", "sms"] as const;
export type SolicitationChannel = (typeof SOLICITATION_CHANNELS)[number];

/** The approval-queue action_type this module publishes through. */
export const SOLICITATION_ACTION_TYPE = "review_solicitation";

/** What kind of consent event this is (the mechanism, not the resulting state). */
export type OptOutReason =
  | "sms_stop"
  | "sms_start"
  | "email_unsubscribe"
  | "manual";

/** Opt-out / opt-in state — append-only events; current status = latest event. */
export type OptOutState = "opted_out" | "opted_in";

/** One immutable opt-out/opt-in event (mirrors solicitation_opt_outs columns). */
export interface OptOutEvent {
  channel: SolicitationChannel;
  /** Salted HMAC of the normalized contact (em_… / ph_…). Never raw PII. */
  contact_hash: string;
  state: OptOutState;
  reason: OptOutReason;
  /** Provenance: "sms_webhook" | "unsubscribe_link" | "manual" | …. */
  source: string;
  /** Stable idempotency key (provider message id / token) — UNIQUE in the table. */
  event_ref: string;
  /** ISO timestamp (injected for deterministic tests). */
  created_at?: string;
}

/** Recorded consent for a channel (captured at draft time, re-checked at send). */
export interface ChannelConsent {
  /** Prior express consent to receive SMS at this number (TCPA). */
  sms?: boolean;
  /** The recipient is a contactable email address (CAN-SPAM honors opt-out). */
  email?: boolean;
  /** Where/when consent was captured — provenance for the compliance trail. */
  source?: string;
  capturedAt?: string;
}

/** The rendered solicitation copy per channel (built by draft.ts). */
export interface SolicitationDraft {
  email?: { subject: string; text: string; html: string };
  sms?: { body: string };
}

/**
 * The approval_queue payload for a review_solicitation action. Stored at enqueue
 * time; consumed by the publisher on approve. Contacts are carried in the clear
 * here (server-only payload, never exposed to the client) so the publisher can
 * actually send; only the opt-out match keys are hashed at rest.
 */
export interface SolicitationPayload {
  shopId: string;
  shopName: string;
  /** Channels the draft targets (subset of SOLICITATION_CHANNELS). */
  channels: SolicitationChannel[];
  recipient: {
    firstName?: string | null;
    email?: string | null;
    /** Phone in any format; normalized to E.164 before send/opt-out match. */
    phone?: string | null;
    /**
     * Optional household dedup key (../mail/household.ts). When present, the
     * publisher honors the shared mail do-not-contact list (opt_out / deceased)
     * so a customer who opted out of direct mail is not solicited by email/SMS.
     */
    householdKey?: string | null;
  };
  consent: ChannelConsent;
  draft: SolicitationDraft;
  /** Optional company scoping for the opt-out / send rows. */
  companyId?: string | null;
}
