// PSG-248 — per-channel send-plan gate (PURE).
//
// Given the recipient's consent, current opt-out status per channel, and whether
// the household is on the do-not-contact (mail suppression) list, decide for each
// requested channel: SEND, or SKIP with a reason. This is the compliance heart of
// the publisher and is fully unit-testable without any I/O.
//
// Rules (most-restrictive wins):
//   - household suppressed  → skip ALL channels (reason "suppressed").
//   - no usable contact     → skip that channel (reason "no_contact").
//   - channel opted out      → skip that channel (reason "opted_out").
//   - SMS without prior express consent → skip (reason "no_consent", TCPA).
//   - email never requires prior consent (CAN-SPAM) but always honors opt-out.
//   - otherwise → send.

import type { ChannelConsent, SolicitationChannel } from "./types";

export type SkipReason =
  | "suppressed"
  | "opted_out"
  | "no_consent"
  | "no_contact";

export interface ChannelDecision {
  channel: SolicitationChannel;
  action: "send" | "skip";
  reason?: SkipReason;
}

export interface SendPlanInput {
  channels: SolicitationChannel[];
  consent: ChannelConsent;
  /** Current opt-out status per channel (true = opted out). */
  optedOut: Partial<Record<SolicitationChannel, boolean>>;
  /** Whether the channel has a usable (normalized) contact. */
  hasContact: Partial<Record<SolicitationChannel, boolean>>;
  /** Household-level do-not-contact (mail suppression) — kills every channel. */
  suppressed: boolean;
}

function decideChannel(
  channel: SolicitationChannel,
  input: SendPlanInput
): ChannelDecision {
  if (input.suppressed) return { channel, action: "skip", reason: "suppressed" };
  if (!input.hasContact[channel]) {
    return { channel, action: "skip", reason: "no_contact" };
  }
  if (input.optedOut[channel]) {
    return { channel, action: "skip", reason: "opted_out" };
  }
  // TCPA: SMS marketing requires prior express consent. Email does not, but both
  // honor opt-out (handled above).
  if (channel === "sms" && input.consent.sms !== true) {
    return { channel, action: "skip", reason: "no_consent" };
  }
  return { channel, action: "send" };
}

/**
 * Build the per-channel send plan. De-dupes the requested channels and preserves
 * request order. Every requested channel yields exactly one decision so the
 * publisher can record an audit row for sends AND skips alike.
 */
export function buildSendPlan(input: SendPlanInput): ChannelDecision[] {
  const seen = new Set<SolicitationChannel>();
  const out: ChannelDecision[] = [];
  for (const channel of input.channels) {
    if (seen.has(channel)) continue;
    seen.add(channel);
    out.push(decideChannel(channel, input));
  }
  return out;
}
